import {
  committedTaskOutputRunId,
  type TaskOutputPanelParams,
  type TaskRunControlEntry,
  type TaskSpawnMode,
  taskOutputPanelParamsSchema,
} from "@shared/contracts/tasks.ts";
import { taskPanelMetadataFromParams } from "@/lib/workspace/task-panel-metadata.ts";
import { selectedTaskRunIdForPanel } from "@/stores/task-run-selection.store.ts";
import {
  taskRunsForPanel,
  useTaskRunsStore,
} from "@/stores/task-runs.store.ts";
import { useWorkspaceStore } from "@/stores/workspace.store.ts";
import type { ActionInvocation } from "./types.ts";

export interface TaskRunActionTarget {
  label: string;
  mode: TaskSpawnMode;
  panelId: string;
  projectRootPath: string;
  relaunchPanelId?: string;
  run?: TaskRunControlEntry;
  runId: string;
  taskId: string;
  taskOutput?: TaskOutputPanelParams;
}

function taskOutputMetadataFromParams(
  params: unknown
): TaskOutputPanelParams | undefined {
  if (!params || typeof params !== "object" || !("taskOutput" in params)) {
    return;
  }
  const parsed = taskOutputPanelParamsSchema.safeParse(params.taskOutput);
  return parsed.success ? parsed.data : undefined;
}

export function isTaskRunPanelParams(params: unknown): boolean {
  return Boolean(
    taskPanelMetadataFromParams(params) ?? taskOutputMetadataFromParams(params)
  );
}

function preferredPanelRun(
  runs: readonly TaskRunControlEntry[]
): TaskRunControlEntry | undefined {
  return (
    runs.find((run) =>
      ["pending", "running", "stopping"].includes(run.status)
    ) ?? runs[0]
  );
}

function runsOwnedByPanel(
  runs: readonly TaskRunControlEntry[],
  panelId: string
): TaskRunControlEntry[] {
  return runs.filter((run) =>
    Object.values(run.nodes).some((node) => node.panelId === panelId)
  );
}

export function taskRunActionTargetFromRun(
  run: TaskRunControlEntry,
  panelId: string,
  label: string
): TaskRunActionTarget {
  const relaunchPanelId =
    Object.values(run.nodes).find((node) => node.panelId === panelId)
      ?.panelId ??
    run.nodes[run.rootTaskId]?.panelId ??
    Object.values(run.nodes).find((node) => node.panelId)?.panelId;
  return {
    label,
    mode: run.mode,
    panelId,
    projectRootPath: run.projectRootPath,
    ...(relaunchPanelId ? { relaunchPanelId } : {}),
    run,
    runId: run.runId,
    taskId: run.rootTaskId,
  };
}

/** 右键 action 必须优先使用 invocation 里的源面板，不能在菜单打开后漂到新 active panel。 */
export function resolveTaskRunActionTarget(
  invocation?: Pick<ActionInvocation, "sourcePanelId">
): TaskRunActionTarget | null {
  const api = useWorkspaceStore.getState().api;
  const sourcePanelId = invocation?.sourcePanelId;
  const panel = sourcePanelId
    ? api?.panels.find((candidate) => candidate.id === sourcePanelId)
    : api?.activePanel;
  if (panel?.view.contentComponent !== "terminal") {
    return null;
  }

  const snapshot = useTaskRunsStore.getState().snapshot;
  const task = taskPanelMetadataFromParams(panel.params);
  if (task) {
    const relatedRuns = taskRunsForPanel(snapshot, panel.id);
    const selectedRunId = selectedTaskRunIdForPanel(panel.id);
    const selectedRun = selectedRunId
      ? relatedRuns.find((candidate) => candidate.runId === selectedRunId)
      : undefined;
    // 任务面板的动作属于实际占用该 panel 的 run。originPanelId 只表示某个
    // 后台任务从这里发起，不能抢占任务 tab 自身的默认目标；如果浮层已显式
    // 选中某个 run，右键菜单必须复用同一选择。
    const ownedRuns = runsOwnedByPanel(relatedRuns, panel.id);
    const run =
      selectedRun ??
      preferredPanelRun(
        ownedRuns.filter((candidate) =>
          ["pending", "running", "stopping"].includes(candidate.status)
        )
      );
    if (run) {
      return taskRunActionTargetFromRun(run, panel.id, task.label);
    }
    return {
      label: task.label,
      mode: "terminal-tab",
      panelId: panel.id,
      projectRootPath: task.projectRootPath,
      runId: panel.id,
      taskId: task.taskId,
    };
  }

  const output = taskOutputMetadataFromParams(panel.params);
  if (!output) {
    return null;
  }
  const selectedRunId = committedTaskOutputRunId(output);
  const run = snapshot.runs[selectedRunId];
  if (!run) {
    if (!("projectRootPath" in output)) {
      return null;
    }
    return {
      label: output.label,
      mode: "background",
      panelId: panel.id,
      projectRootPath: output.projectRootPath,
      runId: selectedRunId,
      taskId: output.taskId,
      taskOutput: output,
    };
  }
  return {
    ...taskRunActionTargetFromRun(run, panel.id, output.label),
    taskOutput: output,
  };
}

/** restart 去重键：有 run 用 runId，无 run 用 panel 作用域，避免与真实 runId 冲突。 */
export function restartOperationKey(target: TaskRunActionTarget): string {
  return target.run ? `run:${target.run.runId}` : `panel:${target.panelId}`;
}
