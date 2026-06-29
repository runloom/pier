import type { MruState } from "@shared/contracts/command-palette-mru.ts";
import type { ProjectPreferencesPatch } from "@shared/contracts/commands.ts";
import type { WindowInfo } from "@shared/contracts/events.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import type {
  TaskLaunchPlan,
  TaskListResult,
  TaskRecentEntry,
  TaskRunSnapshot,
  TaskSpawnPreparation,
} from "@shared/contracts/tasks.ts";
import type { ResolvedTerminalLaunchOptions } from "@shared/contracts/terminal-launch.ts";
import type { WindowCreateOptions } from "@shared/contracts/window.ts";
import type { PluginService } from "../services/plugin-service.ts";
import type { ProcessEnvironmentService } from "../services/process-environment-service.ts";
import type { RendererCommandService } from "../services/renderer-command-service.ts";
import type { WorktreeService } from "../services/worktree-service.ts";

export interface PierCoreServices {
  commandPaletteMru: {
    clear(): Promise<MruState>;
    read(): Promise<MruState>;
    recordUse(actionId: string): Promise<void>;
  };
  panelContexts: {
    listRecent(): Promise<PanelContext[]>;
    recordRecent(context: PanelContext): Promise<void>;
    resolveForPath(path: string): Promise<PanelContext>;
  };
  plugins: PluginService;
  preferences: {
    read(): Promise<ProjectPreferences>;
    update(patch: ProjectPreferencesPatch): Promise<ProjectPreferences>;
  };
  processEnvironment: ProcessEnvironmentService;
  rendererCommand: RendererCommandService;
  tasks: {
    cancelRun(runId: string): TaskRunSnapshot | null;
    completePanel(
      panelId: string,
      exitCode: number,
      windowId?: string | undefined
    ): Promise<TaskRunSnapshot | null>;
    list(args: { projectRoot: string }): Promise<TaskListResult>;
    markPanelClosed(panelId: string, windowId?: string | undefined): void;
    prepareSpawn(args: {
      inputs?: Record<string, string> | undefined;
      projectRoot: string;
      taskId: string;
    }): Promise<TaskSpawnPreparation>;
    recentTasks(): readonly TaskRecentEntry[];
    recordStarted(record: {
      panelId: string;
      projectRoot: string;
      taskId: string;
      windowId?: string | undefined;
    }): void;
    startRun(args: {
      launches: readonly TaskLaunchPlan[];
      openTerminal(
        launch: TaskLaunchPlan,
        runId: string
      ): Promise<{ panelId: string; windowId?: string | undefined }>;
      projectRoot: string;
      rootTaskId: string;
    }): Promise<{
      panelIds: string[];
      primaryPanelId?: string | undefined;
      runId: string;
      snapshot: TaskRunSnapshot;
    }>;
    statusRun(runId: string): TaskRunSnapshot | null;
  };
  terminalLaunches: {
    consume(
      launchId: string
    ):
      | Promise<ResolvedTerminalLaunchOptions | null>
      | ResolvedTerminalLaunchOptions
      | null;
    discard(launchId: string): Promise<void> | void;
    read(
      launchId: string
    ):
      | Promise<ResolvedTerminalLaunchOptions | null>
      | ResolvedTerminalLaunchOptions
      | null;
    register(launch: ResolvedTerminalLaunchOptions): Promise<string> | string;
    sweepExpired?(): Promise<number> | number;
  };
  terminalProfiles: {
    delete(profileId: string): Promise<boolean>;
    list(): Promise<Record<string, ResolvedTerminalLaunchOptions>>;
    read(profileId: string): Promise<ResolvedTerminalLaunchOptions | null>;
    resolve(
      profileId: string
    ):
      | Promise<ResolvedTerminalLaunchOptions | null>
      | ResolvedTerminalLaunchOptions
      | null;
    upsert(
      profileId: string,
      profile: ResolvedTerminalLaunchOptions
    ): Promise<ResolvedTerminalLaunchOptions>;
  };
  window: {
    close(windowId: string): void;
    create(options?: WindowCreateOptions): Promise<{
      recordId: string;
      windowId: string;
    }>;
    focus(windowId: string): void;
    flushOpenWindows(): Promise<void>;
    flushWindow(windowId: string): Promise<void>;
    list(): WindowInfo[];
    restoreMostRecentClosed(): Promise<{
      recordId: string;
      windowId: string;
    } | null>;
    restoreOpenWindows(): Promise<
      Array<{ recordId: string; windowId: string }>
    >;
  };
  workspace: {
    clearLayout(recordId: string): Promise<void>;
    readLayout(recordId: string): Promise<unknown | null>;
    saveLayout(layout: unknown, recordId: string): Promise<void>;
  };
  worktrees: WorktreeService;
}
