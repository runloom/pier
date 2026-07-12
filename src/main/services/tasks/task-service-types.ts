import type {
  TaskBackgroundSnapshot,
  TaskLaunchPlan,
  TaskListResult,
  TaskOutputUpdate,
  TaskRecentEntry,
  TaskRecentState,
  TaskRunSnapshot,
  TaskRunsSnapshot,
  TaskSpawnPreparation,
  TaskStopResult,
} from "@shared/contracts/tasks.ts";
import type { ProcessEnvironmentService } from "../process-environment-service.ts";
import type { SpawnBackgroundTask } from "./task-background-runner.ts";
import type {
  TaskRunCoordinatorStartResult,
  TaskRunTerminalOpenResult,
} from "./task-run-coordinator.ts";

export interface TaskSpawnRequest {
  forceRestart?: boolean | undefined;
  inputs?: Record<string, string> | undefined;
  projectRootPath: string;
  taskId: string;
}

export interface TaskStartedRecord {
  panelId: string;
  projectRootPath: string;
  taskId: string;
  windowId?: string | undefined;
}

export interface TaskTerminalProcessController {
  forceStop(
    panelId: string,
    windowId?: string | undefined
  ): { message?: string | undefined; ok: boolean };
  interrupt(
    panelId: string,
    windowId?: string | undefined
  ): { message?: string | undefined; ok: boolean };
}

export interface TaskActivityCallbacks {
  onFinished(
    panelId: string,
    windowId: string | undefined,
    args: {
      runId: string;
      status: "success" | "failure" | "cancelled";
      exitCode?: number;
    }
  ): void;
  onLaunched(
    panelId: string,
    windowId: string | undefined,
    task: { taskId: string; label: string; runId: string }
  ): void;
}

export interface CreateTaskServiceOptions {
  homeDir?: string;
  now?: () => number;
  onTaskActivity?: TaskActivityCallbacks;
  onTaskOutputChanged?:
    | ((update: TaskOutputUpdate, windowId?: string) => void)
    | undefined;
  onTaskRunsChanged?: ((snapshot: TaskRunsSnapshot) => void) | undefined;
  processEnvironment?: ProcessEnvironmentService;
  readRecentState?: () => Promise<TaskRecentState>;
  recentLimit?: number;
  spawnBackgroundTask?: SpawnBackgroundTask;
  writeRecentState?: (state: TaskRecentState) => Promise<void>;
}

export interface TaskService {
  backgroundSnapshot(): TaskBackgroundSnapshot;
  bindTerminalProcessController(
    controller: TaskTerminalProcessController | null
  ): void;
  cancelRun(runId: string): TaskRunSnapshot | null;
  completePanel(
    panelId: string,
    exitCode: number,
    windowId?: string | undefined,
    expectedRunId?: string | undefined
  ): Promise<TaskRunSnapshot | null>;
  dispose(): void;
  isStopRequested(panelId: string, windowId?: string | undefined): boolean;
  list(args: { projectRootPath: string }): Promise<TaskListResult>;
  markPanelClosed(panelId: string, windowId?: string | undefined): void;
  output(runId: string, taskId: string): TaskOutputUpdate | null;
  prepareSpawn(args: TaskSpawnRequest): Promise<TaskSpawnPreparation>;
  recentTasks(): readonly TaskRecentEntry[];
  recordRecent(launch: TaskLaunchPlan): Promise<void>;
  recordStarted(record: TaskStartedRecord): void;
  runsSnapshot(windowId?: string | undefined): TaskRunsSnapshot;
  startBackgroundRun(args: {
    clientEnv?: Record<string, string> | undefined;
    launches: readonly TaskLaunchPlan[];
    originPanelId?: string | undefined;
    projectRootPath: string;
    rootTaskId: string;
    windowId?: string | undefined;
  }): Promise<TaskRunCoordinatorStartResult>;
  startRun(args: {
    launches: readonly TaskLaunchPlan[];
    openTerminal(
      launch: TaskLaunchPlan,
      runId: string
    ): Promise<TaskRunTerminalOpenResult>;
    projectRootPath: string;
    rootTaskId: string;
    windowId?: string | undefined;
  }): Promise<TaskRunCoordinatorStartResult>;
  statusRun(runId: string): TaskRunSnapshot | null;
  stopRun(runId: string, force?: boolean): TaskStopResult | null;
  subscribeOutput(
    listener: (update: TaskOutputUpdate, windowId?: string) => void
  ): () => void;
  subscribeRuns(listener: (snapshot: TaskRunsSnapshot) => void): () => void;
}
