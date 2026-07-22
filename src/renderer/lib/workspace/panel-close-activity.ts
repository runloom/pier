import type { QuitActivitySummary } from "@shared/contracts/app-quit.ts";
import type {
  ActivityStatus,
  ForegroundActivity,
  TaskActivity,
} from "@shared/contracts/foreground-activity.ts";
import {
  isActiveTaskRunNodeStatus,
  type TaskRunControlEntry,
  type TaskRunsSnapshot,
} from "@shared/contracts/tasks.ts";

function isActiveAgentStatus(status: ActivityStatus | undefined): boolean {
  return status === "processing" || status === "tool" || status === "waiting";
}

function summarizeActiveAgent(
  activity: ForegroundActivity
): QuitActivitySummary | null {
  if (activity.kind !== "agent") {
    return null;
  }
  if (!isActiveAgentStatus(activity.status)) {
    return null;
  }
  return {
    kind: "agent",
    label: activity.agentId,
    panelId: activity.panelId,
    windowId: activity.windowId,
  };
}

function summarizeForegroundTask(activity: TaskActivity): QuitActivitySummary {
  return {
    kind: "task",
    label: activity.label,
    panelId: activity.panelId,
    windowId: activity.windowId,
  };
}

function runTouchesPanel(run: TaskRunControlEntry, panelId: string): boolean {
  return (
    run.originPanelId === panelId ||
    Object.values(run.nodes).some((node) => node.panelId === panelId)
  );
}

function labelForRun(run: TaskRunControlEntry): string {
  const root = run.nodes[run.rootTaskId] ?? Object.values(run.nodes)[0];
  return root?.label ?? run.rootTaskId;
}

function windowIdForRun(
  run: TaskRunControlEntry,
  fallbackWindowId: string | undefined
): string | undefined {
  const root = run.nodes[run.rootTaskId] ?? Object.values(run.nodes)[0];
  return run.ownerWindowId ?? root?.windowId ?? fallbackWindowId;
}

/**
 * 关闭该 panel 时应停止的活跃 task run（pending / running / stopping）。
 * 含 terminal-tab 与从该 panel 发起的 background（originPanelId）。
 */
export function activeTaskRunsToStopForPanel(
  panelId: string,
  taskRuns: TaskRunsSnapshot
): TaskRunControlEntry[] {
  return Object.values(taskRuns.runs)
    .filter(
      (run) =>
        isActiveTaskRunNodeStatus(run.status) && runTouchesPanel(run, panelId)
    )
    .sort(
      (a, b) =>
        b.updatedAt - a.updatedAt ||
        b.startedAt - a.startedAt ||
        a.runId.localeCompare(b.runId)
    );
}

/**
 * 关闭某 terminal panel 前需要提示的危险活动：
 * - agent：processing / tool / waiting
 * - task：该 panel 上的 FA task，以及 TaskRuns 中关联的活跃 run
 * shell / idle / agent ready 不拦截。
 */
export function dangerousActivitySummariesForPanel(
  panelId: string,
  activities: Record<string, ForegroundActivity>,
  taskRuns: TaskRunsSnapshot
): QuitActivitySummary[] {
  const summaries: QuitActivitySummary[] = [];
  const seenTaskKeys = new Set<string>();
  const activity = activities[panelId];
  const fallbackWindowId = activity?.windowId;

  if (activity) {
    const agentSummary = summarizeActiveAgent(activity);
    if (agentSummary) {
      summaries.push(agentSummary);
    }
    if (activity.kind === "task") {
      seenTaskKeys.add(activity.runId);
      summaries.push(summarizeForegroundTask(activity));
    }
  }

  for (const run of activeTaskRunsToStopForPanel(panelId, taskRuns)) {
    if (seenTaskKeys.has(run.runId)) {
      continue;
    }
    const windowId = windowIdForRun(run, fallbackWindowId);
    if (!windowId) {
      continue;
    }
    seenTaskKeys.add(run.runId);
    summaries.push({
      kind: "task",
      label: labelForRun(run),
      panelId,
      windowId,
    });
  }

  return summaries;
}
