import type {
  TaskBackgroundSnapshot,
  TaskListResult,
  TaskRunSnapshot,
  TaskRunsSnapshot,
  TaskSpawnMode,
  TaskSpawnResult,
  TaskStopResult,
} from "@shared/contracts/tasks.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";
import { invokePierCommand, subscribeIpc } from "./ipc-envelope.ts";

export interface PierTasksAPI {
  backgroundSnapshot: () => Promise<TaskBackgroundSnapshot>;
  cancel: (args: { runId: string }) => Promise<TaskRunSnapshot>;
  list: (args: { projectRootPath: string }) => Promise<TaskListResult>;
  onRunsChanged: (cb: (snapshot: TaskRunsSnapshot) => void) => () => void;
  /** Bridge renderer task diagnostics into main diagnostics JSONL. */
  reportDiagnostic: (args: {
    ctx?: Record<string, unknown>;
    msg: string;
    scope: string;
  }) => void;
  runsSnapshot: () => Promise<TaskRunsSnapshot>;
  spawn: (args: {
    focus?: boolean;
    forceRestart?: boolean;
    inputs?: Record<string, string>;
    mode?: TaskSpawnMode;
    placement?:
      | "active-tab"
      | "split-right"
      | "split-below"
      | "split-left"
      | "split-above";
    projectRootPath: string;
    skipMissingDependencies?: boolean;
    targetGroupId?: string;
    terminalPanelId?: string;
    taskId: string;
  }) => Promise<TaskSpawnResult>;
  status: (args: { runId: string }) => Promise<TaskRunSnapshot>;
  stop: (args: { force?: boolean; runId: string }) => Promise<TaskStopResult>;
}

export const tasksApi: PierTasksAPI = {
  backgroundSnapshot: () =>
    invokePierCommand<TaskBackgroundSnapshot>({
      type: "run.backgroundSnapshot",
    }),
  cancel: (args) =>
    invokePierCommand<TaskRunSnapshot>({
      runId: args.runId,
      type: "run.cancel",
    }),
  reportDiagnostic: (args) => {
    ipcRenderer.send(PIER.TASK_RUNTIME_DIAGNOSTIC, args);
  },
  list: (args) =>
    invokePierCommand<TaskListResult>({
      projectRootPath: args.projectRootPath,
      type: "run.list",
    }),
  onRunsChanged: (cb) => subscribeIpc(PIER_BROADCAST.TASKS_RUNS_CHANGED, cb),
  runsSnapshot: () =>
    invokePierCommand<TaskRunsSnapshot>({ type: "run.runsSnapshot" }),
  spawn: (args) =>
    invokePierCommand<TaskSpawnResult>({
      ...(args.focus === undefined ? {} : { focus: args.focus }),
      ...(args.forceRestart === undefined
        ? {}
        : { forceRestart: args.forceRestart }),
      ...(args.inputs ? { inputs: args.inputs } : {}),
      ...(args.mode ? { mode: args.mode } : {}),
      ...(args.placement ? { placement: args.placement } : {}),
      projectRootPath: args.projectRootPath,
      ...(args.skipMissingDependencies === undefined
        ? {}
        : { skipMissingDependencies: args.skipMissingDependencies }),
      ...(args.targetGroupId ? { targetGroupId: args.targetGroupId } : {}),
      ...(args.terminalPanelId
        ? { terminalPanelId: args.terminalPanelId }
        : {}),
      taskId: args.taskId,
      type: "run.spawn",
    }),
  status: (args) =>
    invokePierCommand<TaskRunSnapshot>({
      runId: args.runId,
      type: "run.status",
    }),
  stop: (args) =>
    invokePierCommand<TaskStopResult>({
      ...(args.force === undefined ? {} : { force: args.force }),
      runId: args.runId,
      type: "run.stop",
    }),
};
