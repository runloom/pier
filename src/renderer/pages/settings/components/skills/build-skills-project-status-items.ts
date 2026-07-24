import type {
  StatusStackItem,
  StatusStackTone,
} from "@pier/ui/status-stack.tsx";
import { skillsErrorMessage } from "./skills-error-copy.ts";
import type { Translate } from "./skills-shared.tsx";

export interface SkillsProjectGitState {
  relativeTarget: string;
  state: string;
}

export function buildSkillsProjectStatusItems(input: {
  errorMessage: string | null;
  lastApplyOutcome: "converged" | "degraded" | null;
  loadStatus: "idle" | "loading" | "ready" | "error";
  onCopyGitIgnore: () => void;
  onDismissSessionRefresh: () => void;
  onReload: () => void;
  onRepair: () => void;
  onRetryOperation: () => void;
  reloadRequired: boolean;
  riskyGitStates: readonly SkillsProjectGitState[];
  sessionRefreshHint: boolean;
  t: Translate;
  writesDisabled: boolean;
  writesFrozen: boolean;
}): StatusStackItem[] {
  const {
    errorMessage,
    lastApplyOutcome,
    loadStatus,
    onCopyGitIgnore,
    onDismissSessionRefresh,
    onReload,
    onRepair,
    onRetryOperation,
    reloadRequired,
    riskyGitStates,
    sessionRefreshHint,
    t,
    writesDisabled,
    writesFrozen,
  } = input;

  const items: StatusStackItem[] = [];

  if (reloadRequired || writesFrozen || errorMessage) {
    let tone: StatusStackTone = "destructive";
    let title = t("settings.skills.loadFailed");
    if (writesFrozen) {
      tone = "default";
      title = t("settings.skills.applyIndeterminate");
    } else if (reloadRequired) {
      tone = "warning";
      title = t("settings.skills.reloadRequired");
    }

    let description: string | undefined = errorMessage
      ? skillsErrorMessage(
          errorMessage,
          t,
          loadStatus === "error"
            ? "settings.skills.loadFailedBody"
            : "settings.skills.actionFailedBody"
        )
      : t("settings.skills.reloadRequiredHint");
    if (writesFrozen) {
      description = undefined;
    } else if (errorMessage === "operation-not-applied") {
      description = t("settings.skills.operationNotApplied");
    }

    let action: StatusStackItem["action"];
    if (writesFrozen) {
      action = undefined;
    } else if (errorMessage === "operation-not-applied") {
      action = {
        label: t("settings.skills.retry"),
        onClick: onRetryOperation,
      };
    } else {
      action = {
        label: t("settings.skills.reload"),
        onClick: onReload,
      };
    }

    items.push({
      id: "skills-banner",
      tone,
      title,
      ...(description === undefined ? {} : { description }),
      ...(action === undefined ? {} : { action }),
    });
  }

  if (lastApplyOutcome === "degraded") {
    items.push({
      id: "skills-degraded",
      tone: "warning",
      title: t("settings.skills.projectionIncomplete"),
      description: t("settings.skills.projectionIncompleteBody"),
      action: {
        label: t("settings.skills.retry"),
        onClick: onRepair,
        disabled: writesDisabled,
      },
    });
  }

  if (riskyGitStates.length > 0) {
    const lines = riskyGitStates.map(
      (entry) =>
        `${entry.relativeTarget} · ${t(`settings.skills.gitState.${entry.state}`)}`
    );
    items.push({
      id: "skills-git",
      tone: "warning",
      title: t("settings.skills.gitStatusTitle"),
      description: `${lines.join("\n")}\n${t("settings.skills.gitIgnoreHint")}`,
      action: {
        label: t("settings.skills.copyGitIgnore"),
        onClick: onCopyGitIgnore,
      },
    });
  }

  if (sessionRefreshHint) {
    items.push({
      id: "skills-session-refresh",
      tone: "info",
      title: t("settings.skills.sessionRefreshTitle"),
      description: t("settings.skills.sessionRefreshBody"),
      dismissible: true,
      onDismiss: onDismissSessionRefresh,
    });
  }

  return items;
}
