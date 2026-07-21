import type { SkillsLaunchBlockedInfo } from "@shared/contracts/terminal.ts";
import type { TFunction } from "i18next";
import { openProjectsSettings } from "@/pages/settings/data/projects-settings-nav.ts";
import { showAppChoice, showAppConfirm } from "@/stores/app-dialog.store.ts";
import { useProjectSkillsStore } from "@/stores/project-skills.store.ts";

type Translate = TFunction;

function launchIssueLabel(
  issue: NonNullable<SkillsLaunchBlockedInfo["issues"]>[number],
  t: Translate
): string {
  switch (issue.code) {
    case "library-drift":
      return t("settings.skills.issueLibraryDrift", {
        skill: issue.skillId ?? "",
      });
    case "missing-source":
      return t("settings.skills.issueMissingSource", {
        skill: issue.skillId ?? "",
      });
    case "unmanaged-conflict":
      return t("settings.skills.issueUnmanagedConflict", {
        target: issue.relativeTarget ?? issue.skillId ?? "",
      });
    case "projection-missing":
    case "projection-stale":
      return t("settings.skills.launchIssueProjection", {
        skill: issue.skillId ?? "",
      });
    case "managed-target-modified":
      return t("settings.skills.launchIssueTargetModified", {
        target: issue.relativeTarget ?? issue.skillId ?? "",
      });
    case "duplicate-discovery":
      return t("settings.skills.launchIssueDuplicate");
    case "project-identity-changed":
      return t("settings.skills.issueIdentityChanged");
    case "invalid-skill":
      return t("settings.skills.issueInvalidManifest");
    case "ledger-corrupt":
      return t("settings.skills.issueLedgerCorrupt");
    case "recovery-record-corrupt":
    case "recovery-blocked":
      return t("settings.skills.issueRecoveryBlocked");
    case "operation-busy":
      return t("settings.skills.launchOperationBusy");
    default:
      return t("settings.skills.issueGeneric");
  }
}

export type LaunchBlockDecision =
  | { kind: "open-settings" }
  | { kind: "cancel" }
  | { kind: "degrade"; launchAttemptId: string };

/**
 * Launch-block choice flow (design v9 §7.8): confirm = open skill settings,
 * alt = launch anyway (only when degrade is allowed), cancel = cancel.
 * Denied policies (integrity / conflict / corrupt) drop “launch anyway”
 * entirely (two-button confirm — never two cancel buttons).
 */
export async function confirmSkillsLaunchBlock(args: {
  blocked: SkillsLaunchBlockedInfo;
  t: Translate;
}): Promise<LaunchBlockDecision> {
  const { blocked, t } = args;
  const body = blocked.issues
    ? blocked.issues.map((issue) => launchIssueLabel(issue, t)).join("\n")
    : t("settings.skills.launchBlockedBody");
  const denied = blocked.degradePolicySummary === "denied";

  if (denied) {
    const openSettings = await showAppConfirm({
      ...(body ? { body } : {}),
      cancelLabel: t("settings.skills.launchCancel"),
      confirmLabel: t("settings.skills.launchOpenSettings"),
      intent: "default",
      size: "default",
      title: t("settings.skills.launchBlockedTitle"),
    });
    return openSettings ? { kind: "open-settings" } : { kind: "cancel" };
  }

  const decision = await showAppChoice({
    altLabel: t("settings.skills.launchAnyway"),
    ...(body ? { body } : {}),
    cancelLabel: t("settings.skills.launchCancel"),
    confirmLabel: t("settings.skills.launchOpenSettings"),
    intent: "default",
    size: "default",
    title: t("settings.skills.launchBlockedTitle"),
  });

  if (decision === "confirm") {
    return { kind: "open-settings" };
  }
  if (decision === "alt") {
    return { kind: "degrade", launchAttemptId: blocked.launchAttemptId };
  }
  return { kind: "cancel" };
}

/**
 * Full renderer closure for a blocked terminal launch: choice dialog →
 * agent.launch.continue → retry authorization. Returns the attempt id to
 * carry as `skillsLaunchContinuation` on the retried terminal.create, or
 * null when the launch should not proceed.
 */
export async function resolveSkillsLaunchBlock(args: {
  blocked: SkillsLaunchBlockedInfo;
  t: Translate;
}): Promise<string | null> {
  const gateKey = (blocked: SkillsLaunchBlockedInfo): string =>
    JSON.stringify({
      degradePolicySummary: blocked.degradePolicySummary,
      issueSummary: blocked.issueSummary,
      launchAttemptId: blocked.launchAttemptId,
    });
  const seenGates = new Set<string>([gateKey(args.blocked)]);
  let blocked = args.blocked;

  // State may change during the main-process recheck. Re-present distinct
  // replacement gates, but never cycle forever on the same requirement.
  for (let replacementCount = 0; replacementCount < 8; replacementCount += 1) {
    const decision = await confirmSkillsLaunchBlock({ blocked, t: args.t });
    if (decision.kind === "open-settings") {
      await window.pier.projectSkills
        .launchContinue({
          launchAttemptId: blocked.launchAttemptId,
          decision: "open-settings",
        })
        .catch(() => undefined);
      if (blocked.projectRootPath) {
        useProjectSkillsStore
          .getState()
          .requestOpenProject(
            blocked.projectRootPath,
            blocked.focusIssueIds ?? []
          );
        openProjectsSettings({
          tab: "skills",
          projectRootPath: blocked.projectRootPath,
        });
      } else {
        openProjectsSettings({ tab: "skills" });
      }
      return null;
    }
    if (decision.kind === "cancel") {
      await window.pier.projectSkills
        .launchContinue({
          launchAttemptId: blocked.launchAttemptId,
          decision: "cancel",
        })
        .catch(() => undefined);
      return null;
    }

    const result = await window.pier.projectSkills
      .launchContinue({
        launchAttemptId: blocked.launchAttemptId,
        decision: "degrade",
      })
      .catch(() => null);

    if (result?.status === "ready") {
      return blocked.launchAttemptId;
    }
    if (result?.status !== "rejected" || result.gate?.status !== "blocked") {
      return null;
    }
    const replacement: SkillsLaunchBlockedInfo = {
      ...result.gate,
      ...(result.gate.issues
        ? { focusIssueIds: result.gate.issues.map((issue) => issue.id) }
        : {}),
    };
    const replacementKey = gateKey(replacement);
    if (seenGates.has(replacementKey)) {
      await window.pier.projectSkills
        .launchContinue({
          launchAttemptId: blocked.launchAttemptId,
          decision: "cancel",
        })
        .catch(() => undefined);
      return null;
    }
    seenGates.add(replacementKey);
    blocked = replacement;
  }

  await window.pier.projectSkills
    .launchContinue({
      launchAttemptId: blocked.launchAttemptId,
      decision: "cancel",
    })
    .catch(() => undefined);
  return null;
}
