import { isActiveTaskRunNodeStatus } from "@shared/contracts/task-run-status.ts";
import {
  emptyTaskRunsSnapshot,
  type TaskRunControlEntry,
  type TaskRunsSnapshot,
} from "@shared/contracts/tasks.ts";
import { createLogger } from "@shared/logger.ts";
import { create } from "zustand";
import { reportTaskRuntimeDiagnostic } from "@/lib/tasks/report-runtime-diagnostic.ts";

const log = createLogger("task.runs.store");

interface TaskRunsState {
  apply(snapshot: TaskRunsSnapshot): void;
  error: string | null;
  initialized: boolean;
  snapshot: TaskRunsSnapshot;
}

export const useTaskRunsStore = create<TaskRunsState>((set, get) => ({
  apply: (snapshot) => {
    const prev = get().snapshot;
    if (snapshot.version < prev.version) {
      log.debug("TaskRuns apply skipped (stale version)", {
        incoming: snapshot.version,
        current: prev.version,
      });
      return;
    }
    const runSummaries = Object.values(snapshot.runs).map((run) => ({
      mode: run.mode,
      originPanelId: run.originPanelId,
      ownerWindowId: run.ownerWindowId,
      runId: run.runId,
      status: run.status,
    }));
    log.debug("TaskRuns apply", {
      runCount: runSummaries.length,
      runs: runSummaries,
      version: snapshot.version,
    });
    reportTaskRuntimeDiagnostic("task.runs.store", "TaskRuns apply", {
      runCount: runSummaries.length,
      runs: runSummaries,
      version: snapshot.version,
    });
    set({ error: null, initialized: true, snapshot });
  },
  error: null,
  initialized: false,
  snapshot: emptyTaskRunsSnapshot(),
}));

let unsubscribeTaskRuns: (() => void) | null = null;

export async function initTaskRunsStore(): Promise<void> {
  unsubscribeTaskRuns?.();
  try {
    const apply = useTaskRunsStore.getState().apply;
    unsubscribeTaskRuns = window.pier.tasks.onRunsChanged(apply);
    apply(await window.pier.tasks.runsSnapshot());
  } catch (error) {
    useTaskRunsStore.setState({
      error: error instanceof Error ? error.message : String(error),
      initialized: true,
    });
  }
}

export function taskRunsOwnedByPanel(
  snapshot: TaskRunsSnapshot,
  panelId: string
): TaskRunControlEntry[] {
  return Object.values(snapshot.runs)
    .filter((run) =>
      Object.values(run.nodes).some((node) => node.panelId === panelId)
    )
    .sort(
      (a, b) =>
        b.updatedAt - a.updatedAt ||
        b.startedAt - a.startedAt ||
        a.runId.localeCompare(b.runId)
    );
}

/** RC / 动作作用域：包含从该 panel 发起的 background run（originPanelId）。 */
export function taskRunsForPanel(
  snapshot: TaskRunsSnapshot,
  panelId: string
): TaskRunControlEntry[] {
  return Object.values(snapshot.runs)
    .filter(
      (run) =>
        run.originPanelId === panelId ||
        Object.values(run.nodes).some((node) => node.panelId === panelId)
    )
    .sort(
      (a, b) =>
        b.updatedAt - a.updatedAt ||
        b.startedAt - a.startedAt ||
        a.runId.localeCompare(b.runId)
    );
}

/**
 * Tab 活跃任务蓝点：RC 作用域内是否仍有任一活跃 run
 * （pending / running / stopping）。
 *
 * 与 `shouldPresentRun` 活跃分支同源：active 不看 dismiss，故
 * `panelHasActiveTaskRun` ⇒ 任务运行条必须 mount（禁止有点无条）。
 * 终态 RC linger 不点此蓝点（「在跑」≠「结果条」）。
 *
 * 与 taskRunsForPanel 同作用域；O(n) 短路扫描。
 */
export function panelHasActiveTaskRun(
  snapshot: TaskRunsSnapshot,
  panelId: string
): boolean {
  for (const run of Object.values(snapshot.runs)) {
    if (!isActiveTaskRunNodeStatus(run.status)) {
      continue;
    }
    if (
      run.originPanelId === panelId ||
      Object.values(run.nodes).some((node) => node.panelId === panelId)
    ) {
      return true;
    }
  }
  return false;
}
