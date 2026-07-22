import type { QuitActivitySummary } from "@shared/contracts/app-quit.ts";
import type { TFunction } from "i18next";
import i18next from "i18next";
import { stopTaskRun } from "@/lib/actions/task-run-operations.ts";
import {
  activeTaskRunsToStopForPanel,
  dangerousActivitySummariesForPanel,
} from "@/lib/workspace/panel-close-activity.ts";
import { registerPanelCloseGuard } from "@/lib/workspace/panel-close-guards.ts";
import { showAppConfirm } from "@/stores/app-dialog.store.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { useTaskRunsStore } from "@/stores/task-runs.store.ts";

const MAX_VISIBLE_ACTIVITY_NAMES = 3;
const MAX_ACTIVITY_NAME_LENGTH = 72;

function truncateActivityName(name: string): string {
  if (name.length <= MAX_ACTIVITY_NAME_LENGTH) {
    return name;
  }
  return `${name.slice(0, MAX_ACTIVITY_NAME_LENGTH - 1)}…`;
}

function formatActivityName(
  t: TFunction,
  summary: QuitActivitySummary
): string {
  const label =
    summary.kind === "shell" && !summary.commandLine
      ? t("dialog.appQuit.shellFallback")
      : summary.label;
  return truncateActivityName(
    t("dialog.appQuit.activityName", {
      kind: t(`dialog.appQuit.activityKind.${summary.kind}`),
      label,
    })
  );
}

function formatActivityList(
  t: TFunction,
  summaries: readonly QuitActivitySummary[]
): string {
  const visibleSummaries = summaries.slice(0, MAX_VISIBLE_ACTIVITY_NAMES);
  const activities = visibleSummaries
    .map((summary) => formatActivityName(t, summary))
    .join(t("dialog.appQuit.activitySeparator"));
  const hiddenCount = summaries.length - visibleSummaries.length;
  if (hiddenCount <= 0) {
    return activities;
  }
  return t("dialog.appQuit.activityListWithOverflow", {
    activities,
    count: hiddenCount,
  });
}

function formatPanelCloseBody(
  t: TFunction,
  summaries: readonly QuitActivitySummary[]
): string {
  const firstSummary = summaries[0];
  if (summaries.length === 1 && firstSummary) {
    return t("dialog.panelClose.singleActivityDetail", {
      activity: formatActivityName(t, firstSummary),
    });
  }
  return t("dialog.panelClose.multipleActivityDetail", {
    activities: formatActivityList(t, summaries),
  });
}

export function registerTerminalPanelCloseGuard(): () => void {
  return registerPanelCloseGuard("terminal", async ({ panelId }) => {
    const taskRuns = useTaskRunsStore.getState().snapshot;
    const summaries = dangerousActivitySummariesForPanel(
      panelId,
      useForegroundActivityStore.getState().activities,
      taskRuns
    );
    if (summaries.length === 0) {
      return true;
    }

    const t = i18next.t.bind(i18next);
    const confirmed = await showAppConfirm({
      body: formatPanelCloseBody(t, summaries),
      cancelLabel: t("dialog.panelClose.cancel"),
      confirmLabel: t("dialog.panelClose.close"),
      intent: "destructive",
      size: "sm",
      title: t("dialog.panelClose.title"),
    });
    if (!confirmed) {
      return false;
    }

    // 用户已确认「关闭会终止」；优雅 stop，不再二次 force 确认。
    const runsToStop = activeTaskRunsToStopForPanel(panelId, taskRuns);
    for (const run of runsToStop) {
      await stopTaskRun(run, false);
    }
    return true;
  });
}
