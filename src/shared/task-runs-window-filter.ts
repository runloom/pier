import type {
  TaskRunControlEntry,
  TaskRunsSnapshot,
} from "./contracts/tasks.ts";

/**
 * Per-window TaskRuns visibility (broadcast + runsSnapshot filter).
 *
 * - With windowId: only runs whose ownerWindowId matches.
 * - Missing ownerWindowId: **invisible to every window** (silent drop footgun).
 *   Spawn paths must set ownerWindowId (IPC injects windowId; openNode backfills).
 */
export function taskRunVisibleToWindow(
  run: Pick<TaskRunControlEntry, "ownerWindowId">,
  windowId: string | null | undefined
): boolean {
  if (!windowId) {
    return false;
  }
  return run.ownerWindowId === windowId;
}

export function filterTaskRunsSnapshotForWindow(
  snapshot: TaskRunsSnapshot,
  windowId: string | null | undefined
): TaskRunsSnapshot {
  if (!windowId) {
    return { runs: {}, version: snapshot.version };
  }
  return {
    runs: Object.fromEntries(
      Object.entries(snapshot.runs).filter(([, run]) =>
        taskRunVisibleToWindow(run, windowId)
      )
    ),
    version: snapshot.version,
  };
}
