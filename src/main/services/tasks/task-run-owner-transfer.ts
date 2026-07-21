/** Move running task-run panel ownership across Pier windows. */

import { panelNodeKey, type TaskRunState } from "./task-run-state.ts";

export function moveRunningOwnerWindow(input: {
  panelId: string;
  panelToRunNode: Map<string, { runId: string; taskId: string }>;
  runs: Map<string, TaskRunState>;
  sourceWindowId: string;
  targetWindowId: string;
  touch: (run: TaskRunState) => void;
}): void {
  const {
    panelId,
    panelToRunNode,
    runs,
    sourceWindowId,
    targetWindowId,
    touch,
  } = input;
  if (
    panelId.trim().length === 0 ||
    sourceWindowId.trim().length === 0 ||
    targetWindowId.trim().length === 0 ||
    sourceWindowId === targetWindowId
  ) {
    return;
  }
  const ref = panelToRunNode.get(panelNodeKey(panelId, sourceWindowId));
  if (!ref) {
    return;
  }
  const run = runs.get(ref.runId);
  const node = run ? run.nodes.get(ref.taskId) : undefined;
  if (!(run && node)) {
    return;
  }
  panelToRunNode.delete(panelNodeKey(panelId, sourceWindowId));
  node.windowId = targetWindowId;
  run.ownerWindowId = targetWindowId;
  // originPanelId stays stable across window moves.
  panelToRunNode.set(panelNodeKey(panelId, targetWindowId), {
    runId: ref.runId,
    taskId: ref.taskId,
  });
  touch(run);
}
