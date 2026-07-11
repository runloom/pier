import {
  emptyTaskRunsSnapshot,
  type TaskRunControlEntry,
  type TaskRunsSnapshot,
} from "@shared/contracts/tasks.ts";
import { create } from "zustand";

interface TaskRunsState {
  apply(snapshot: TaskRunsSnapshot): void;
  error: string | null;
  initialized: boolean;
  snapshot: TaskRunsSnapshot;
}

export const useTaskRunsStore = create<TaskRunsState>((set, get) => ({
  apply: (snapshot) => {
    if (snapshot.version < get().snapshot.version) {
      return;
    }
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
