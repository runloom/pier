import { showAppAlert, showAppConfirm } from "@/stores/app-dialog.store.ts";
import {
  type ApplyOutcome,
  normalizeConfirmation,
  type PlanConfirmationView,
  type SkillsUiDraft,
  useProjectSkillsStore,
} from "@/stores/project-skills.store.ts";
import { skillsErrorMessage } from "./skills-error-copy.ts";
import {
  isPlanHardBlockIssue,
  issueLabel,
  type Translate,
} from "./skills-shared.tsx";

let commitInFlight = false;

function noticeAfterSuccessfulApply(draft: SkillsUiDraft): void {
  const store = useProjectSkillsStore.getState();
  const tokens = draft.importTokens ?? [];
  if (tokens.length > 0) {
    const first = tokens[0];
    const candidate = first ? store.candidatesByToken[first] : undefined;
    const importKinds = new Set([
      "local-import",
      "project-discovery-import",
      "template",
    ]);
    if (candidate && importKinds.has(candidate.sourceKind)) {
      const name = candidate.name || candidate.skillId || "";
      if (name) {
        store.setRecentImportNotice({ name });
      }
    }
  }
  const enablementChanged =
    Object.keys(draft.enabledBySkillId ?? {}).length > 0;
  const deleted = (draft.deleteSkillIds?.length ?? 0) > 0;
  const deliveryOnly = !(enablementChanged || deleted) && tokens.length === 0;
  if (enablementChanged || deleted || tokens.length > 0 || deliveryOnly) {
    store.setSessionRefreshHint(true);
  }
}

/**
 * Product-facing commit primitive: one user action, one transient intent,
 * one plan/confirmation/apply chain. The draft remains an IPC carrier only;
 * it is never exposed as a user-visible pending change set.
 */
export async function commitSkillsIntent(args: {
  draft: SkillsUiDraft;
  t: Translate;
}): Promise<ApplyOutcome> {
  const store = useProjectSkillsStore.getState();
  if (
    commitInFlight ||
    store.planPending ||
    store.applyPending ||
    store.writesFrozen
  ) {
    return "failed";
  }

  commitInFlight = true;
  try {
    store.setDraft(args.draft);
    const plan = await useProjectSkillsStore.getState().planDraft();
    if (!plan) {
      useProjectSkillsStore.getState().setDraft(null);
      await showAppAlert({
        title: args.t("settings.skills.actionFailed"),
        body: args.t("settings.skills.actionFailedBody"),
      });
      return "failed";
    }
    if (!plan.applicable) {
      const lines = plan.blockingIssues
        .filter((issue) => isPlanHardBlockIssue(issue.code))
        .map((issue) => issueLabel(issue, args.t))
        .join("\n");
      useProjectSkillsStore.getState().setDraft(null);
      useProjectSkillsStore.setState({ errorMessage: "action-blocked" });
      await showAppAlert({
        title: args.t("settings.skills.actionBlockedTitle"),
        body: lines || args.t("settings.skills.actionBlockedBody"),
      });
      return "failed";
    }

    const collected = await collectAcknowledgements({
      requirements: plan.confirmationRequirements,
      t: args.t,
    });
    if (!collected.ok) {
      useProjectSkillsStore.getState().setDraft(null);
      return "cancelled";
    }
    const result = await useProjectSkillsStore
      .getState()
      .apply(crypto.randomUUID(), collected.acknowledgements);
    if (result?.status === "converged") {
      const latest = useProjectSkillsStore.getState();
      if (latest.projectRef) {
        await latest.loadSnapshot(latest.projectRef);
      }
      latest.setDraft(null);
      noticeAfterSuccessfulApply(args.draft);
      return "converged";
    }
    if (result?.status === "degraded") {
      const latest = useProjectSkillsStore.getState();
      if (latest.projectRef) {
        await latest.loadSnapshot(latest.projectRef);
      }
      latest.setDraft(null);
      noticeAfterSuccessfulApply(args.draft);
      // Project list shows an in-page Retry banner; skill detail does not.
      // Skip for deletes — caller navigates back to the list banner.
      const deleting = (args.draft.deleteSkillIds?.length ?? 0) > 0;
      if (latest.mode.kind === "skill-detail" && !deleting) {
        await showAppAlert({
          title: args.t("settings.skills.projectionIncomplete"),
          body: args.t("settings.skills.projectionIncompleteBody"),
        });
      }
      return "degraded";
    }
    if (result?.status === "indeterminate") {
      return "indeterminate";
    }

    const message = useProjectSkillsStore.getState().errorMessage;
    useProjectSkillsStore.getState().setDraft(null);
    await showAppAlert({
      title: args.t("settings.skills.actionFailed"),
      body: skillsErrorMessage(
        message,
        args.t,
        "settings.skills.actionFailedBody"
      ),
    });
    return "failed";
  } finally {
    commitInFlight = false;
  }
}

/**
 * Retry after a degraded apply: repair plan → confirmations → repair.
 */
export async function runRepair(t: Translate): Promise<void> {
  const store = useProjectSkillsStore.getState();
  if (!(store.projectRef && store.observedRevision)) {
    return;
  }
  try {
    const plan = (await window.pier.projectSkills.repairPlan(
      store.projectRef,
      store.observedRevision
    )) as {
      repairPlanDigest?: string;
      confirmationRequirements?: unknown[];
    } | null;
    if (!plan?.repairPlanDigest) {
      throw new Error("repair plan unavailable");
    }
    const requirements = (plan.confirmationRequirements ?? [])
      .map((req) => normalizeConfirmation(req))
      .filter((req): req is PlanConfirmationView => req !== null);
    const collected = await collectAcknowledgements({
      requirements,
      t,
    });
    if (!collected.ok) {
      return;
    }
    const result = (await window.pier.projectSkills.repair({
      projectRef: store.projectRef,
      observedRevision: store.observedRevision,
      operationId: crypto.randomUUID(),
      repairPlanDigest: plan.repairPlanDigest,
      acknowledgements: collected.acknowledgements,
    })) as { status?: string; operationId?: string } | null;
    if (result?.status === "converged") {
      useProjectSkillsStore.setState({ lastApplyOutcome: "converged" });
      const latest = useProjectSkillsStore.getState();
      if (latest.projectRef) {
        await latest.loadSnapshot(latest.projectRef);
      }
      return;
    }
    if (result?.status === "indeterminate" && result.operationId) {
      useProjectSkillsStore.setState({
        writesFrozen: true,
        pendingOperationId: result.operationId,
      });
      return;
    }
    await showAppAlert({
      title: t("settings.skills.repairFailed"),
      body: t("settings.skills.repairFailedBody"),
    });
  } catch (error) {
    await showAppAlert({
      title: t("settings.skills.repairFailed"),
      body: skillsErrorMessage(error, t, "settings.skills.actionFailedBody"),
    });
  }
}

/**
 * Sequential per-requirement destructive confirmations (design v8 §7.7):
 * every acknowledgement corresponds to a confirmation the user actually saw,
 * showing the precise target path / digest. Never rubber-stamp in bulk.
 */
export async function collectAcknowledgements(args: {
  requirements: readonly PlanConfirmationView[];
  t: Translate;
}): Promise<
  | {
      ok: true;
      acknowledgements: Array<{
        requirementId: string;
        nonce: string;
        expectedActualTreeDigest?: string;
      }>;
    }
  | { ok: false }
> {
  const acknowledgements: Array<{
    requirementId: string;
    nonce: string;
    expectedActualTreeDigest?: string;
  }> = [];
  for (const requirement of args.requirements) {
    const ack = () => {
      acknowledgements.push({
        requirementId: requirement.id,
        nonce: crypto.randomUUID(),
        ...(requirement.expectedActualTreeDigest === undefined
          ? {}
          : { expectedActualTreeDigest: requirement.expectedActualTreeDigest }),
      });
    };
    let confirmed = false;
    if (requirement.kind === "git-projection-delete") {
      confirmed = await showAppConfirm({
        body: args.t("settings.skills.confirmGitDeleteBody"),
        confirmLabel: args.t("settings.skills.confirmDeleteAction"),
        intent: "destructive",
        size: "default",
        title: args.t("settings.skills.confirmGitDeleteTitle", {
          target: requirement.relativeTarget ?? "",
        }),
      });
    } else if (requirement.kind === "content-delete") {
      confirmed = await showAppConfirm({
        body: args.t("settings.skills.confirmContentDeleteBody", {
          skill: requirement.skillId ?? "",
        }),
        confirmLabel: args.t("settings.skills.confirmDeleteAction"),
        intent: "destructive",
        size: "default",
        title: args.t("settings.skills.confirmContentDeleteTitle", {
          skill: requirement.skillId ?? "",
        }),
      });
    } else {
      confirmed = await showAppConfirm({
        body: args.t("settings.skills.actionDangerConfirmBody"),
        intent: "destructive",
        size: "default",
        title: args.t("settings.skills.actionDangerConfirmTitle"),
      });
    }
    if (!confirmed) {
      return { ok: false };
    }
    ack();
  }
  return { ok: true, acknowledgements };
}
