import { toast } from "sonner";
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

export function notifyRecentImportSuccess(name: string, t: Translate): void {
  // Capsule toast: title only (AGENTS — no toast description).
  toast.success(t("settings.skills.importAddedTitle", { name }));
}

const IMPORT_SOURCE_KINDS = new Set([
  "local-import",
  "project-discovery-import",
  "template",
]);

/** Capture import display name before apply clears candidatesByToken. */
export function resolveImportSuccessName(
  draft: SkillsUiDraft,
  candidatesByToken: Readonly<
    Record<string, { name?: string; skillId?: string; sourceKind?: string }>
  >
): string | null {
  const tokens = draft.importTokens ?? [];
  const first = tokens[0];
  if (!first) {
    return null;
  }
  const candidate = candidatesByToken[first];
  if (
    !(candidate?.sourceKind && IMPORT_SOURCE_KINDS.has(candidate.sourceKind))
  ) {
    return null;
  }
  const name = (candidate.name || candidate.skillId || "").trim();
  return name.length > 0 ? name : null;
}

function noticeAfterSuccessfulApply(
  draft: SkillsUiDraft,
  t: Translate,
  importName: string | null
): void {
  if (importName) {
    notifyRecentImportSuccess(importName, t);
  }
  const store = useProjectSkillsStore.getState();
  const tokens = draft.importTokens ?? [];
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
  /**
   * Skip per-requirement destructive confirmations when the user already
   * confirmed the outer action (blank add / folder import commit).
   */
  skipConfirmations?: boolean;
  /**
   * When true, do not show failure/busy/indeterminate alerts — caller owns
   * user-facing copy (e.g. create content follow-up).
   */
  suppressFailureAlerts?: boolean;
}): Promise<ApplyOutcome> {
  const store = useProjectSkillsStore.getState();
  if (
    commitInFlight ||
    store.planPending ||
    store.applyPending ||
    store.writesFrozen
  ) {
    if (!args.suppressFailureAlerts) {
      await showAppAlert({
        title: args.t("settings.skills.actionFailed"),
        body: args.t("settings.skills.launchOperationBusy"),
      });
    }
    return "failed";
  }

  commitInFlight = true;
  try {
    // Snapshot import label before apply/loadSnapshot clears candidatesByToken.
    const importName = resolveImportSuccessName(
      args.draft,
      store.candidatesByToken
    );
    store.setDraft(args.draft);
    const plan = await useProjectSkillsStore.getState().planDraft();
    if (!plan) {
      const message = useProjectSkillsStore.getState().errorMessage;
      useProjectSkillsStore.getState().setDraft(null);
      if (!args.suppressFailureAlerts) {
        const knownCodes = new Set([
          "action-blocked",
          "operation-not-applied",
          "plan-stale",
          "revision-conflict",
          "content-conflict",
        ]);
        const body =
          message && !knownCodes.has(message)
            ? message
            : skillsErrorMessage(
                message,
                args.t,
                "settings.skills.actionFailedBody"
              );
        await showAppAlert({
          title: args.t("settings.skills.actionFailed"),
          body,
        });
      }
      return "failed";
    }
    if (!plan.applicable) {
      const lines = plan.blockingIssues
        .filter((issue) => isPlanHardBlockIssue(issue.code))
        .map((issue) => issueLabel(issue, args.t))
        .join("\n");
      useProjectSkillsStore.getState().setDraft(null);
      useProjectSkillsStore.setState({ errorMessage: "action-blocked" });
      if (!args.suppressFailureAlerts) {
        await showAppAlert({
          title: args.t("settings.skills.actionBlockedTitle"),
          body: lines || args.t("settings.skills.actionBlockedBody"),
        });
      }
      return "failed";
    }

    const collected = args.skipConfirmations
      ? {
          ok: true as const,
          acknowledgements: plan.confirmationRequirements.map(
            (requirement) => ({
              requirementId: requirement.id,
              nonce: crypto.randomUUID(),
              ...(requirement.expectedActualTreeDigest === undefined
                ? {}
                : {
                    expectedActualTreeDigest:
                      requirement.expectedActualTreeDigest,
                  }),
            })
          ),
        }
      : await collectAcknowledgements({
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
        try {
          await latest.loadSnapshot(latest.projectRef, { quiet: true });
        } catch {
          // Apply already landed; refresh is best-effort.
        }
      }
      latest.setDraft(null);
      noticeAfterSuccessfulApply(args.draft, args.t, importName);
      return "converged";
    }
    if (result?.status === "degraded") {
      const latest = useProjectSkillsStore.getState();
      if (latest.projectRef) {
        try {
          await latest.loadSnapshot(latest.projectRef, { quiet: true });
        } catch {
          // Apply already landed; refresh is best-effort.
        }
      }
      latest.setDraft(null);
      noticeAfterSuccessfulApply(args.draft, args.t, importName);
      // Project list shows an in-page Retry banner; skill detail does not.
      // Skip for deletes — caller navigates back to the list banner.
      const deleting = (args.draft.deleteSkillIds?.length ?? 0) > 0;
      if (
        latest.mode.kind === "skill-detail" &&
        !deleting &&
        !args.suppressFailureAlerts
      ) {
        await showAppAlert({
          title: args.t("settings.skills.projectionIncomplete"),
          body: args.t("settings.skills.projectionIncompleteBody"),
        });
      }
      return "degraded";
    }
    if (result?.status === "indeterminate") {
      if (!args.suppressFailureAlerts) {
        await showAppAlert({
          title: args.t("settings.skills.applyIndeterminate"),
          body: args.t("settings.skills.operationNotApplied"),
        });
      }
      return "indeterminate";
    }

    const message = useProjectSkillsStore.getState().errorMessage;
    useProjectSkillsStore.getState().setDraft(null);
    if (!args.suppressFailureAlerts) {
      await showAppAlert({
        title: args.t("settings.skills.actionFailed"),
        body: skillsErrorMessage(
          message,
          args.t,
          "settings.skills.actionFailedBody"
        ),
      });
    }
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
        await latest.loadSnapshot(latest.projectRef, { quiet: true });
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
