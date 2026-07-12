import type { MruState } from "@shared/contracts/command-palette-mru.ts";
import type { WindowInfo } from "@shared/contracts/events.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import type { ProjectPreferencesPatch } from "@shared/contracts/preferences-patch.ts";
import type { ResolvedTerminalLaunchOptions } from "@shared/contracts/terminal-launch.ts";
import type {
  TerminalStatusBarItemOverridePatch,
  TerminalStatusBarOverridePatches,
  TerminalStatusBarPrefs,
} from "@shared/contracts/terminal-status-bar.ts";
import type { WindowCreateOptions } from "@shared/contracts/window.ts";
import type { AgentDetectionService } from "../services/agents/agent-detection-service.ts";
import type { AgentUsageService } from "../services/agents/agent-usage-service.ts";
import type { AiService } from "../services/ai/ai-service.ts";
import type { AppUpdateService } from "../services/app-updates/app-update-service.ts";
import type { FileDraftsService } from "../services/file-drafts-service.ts";
import type { FileService } from "../services/file-service.ts";
import type { FileWatchService } from "../services/file-watch-service.ts";
import type { GitService } from "../services/git-service.ts";
import type { GitWatchService } from "../services/git-watch-service.ts";
import type { LocalEnvironmentService } from "../services/local-environments-service.ts";
import type { ManagedPluginInstallService } from "../services/managed-plugins/install-service.ts";
import type { PluginService } from "../services/plugin-service.ts";
import type { PluginSettingsService } from "../services/plugin-settings-service.ts";
import type { ProcessEnvironmentService } from "../services/process-environment-service.ts";
import type { RendererCommandService } from "../services/renderer-command-service.ts";
import type { TaskService } from "../services/tasks/task-service.ts";
import type { UsageDataService } from "../services/usage-data/usage-data-service.ts";
import type { WorktreeService } from "../services/worktree-service.ts";
import type { SecretsStore } from "../state/secrets-store.ts";
import type { PluginDisableTransitionCoordinator } from "./plugin-disable-transition.ts";

export interface PierCoreServices {
  agentDetection: AgentDetectionService;
  agentUsage: AgentUsageService;
  ai: AiService;
  appUpdates: AppUpdateService;
  commandPaletteMru: {
    clear(): Promise<MruState>;
    read(): Promise<MruState>;
    recordUse(actionId: string): Promise<void>;
  };
  fileDrafts?: FileDraftsService;
  files?: FileService;
  fileWatch?: FileWatchService;
  git: GitService;
  gitWatch: GitWatchService;
  localEnvironments: LocalEnvironmentService;
  managedPlugins: ManagedPluginInstallService;
  panelContexts: {
    listRecent(): Promise<PanelContext[]>;
    recordRecent(context: PanelContext): Promise<void>;
    resolveForPath(path: string): Promise<PanelContext>;
  };
  pluginDisableTransitions: PluginDisableTransitionCoordinator;
  pluginSettings: PluginSettingsService;
  plugins: PluginService;
  preferences: {
    read(): Promise<ProjectPreferences>;
    update(patch: ProjectPreferencesPatch): Promise<ProjectPreferences>;
  };
  processEnvironment: ProcessEnvironmentService;
  rendererCommand: RendererCommandService;
  secrets: SecretsStore;
  tasks: TaskService;
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
  terminalStatusBarPrefs: {
    applyOverrides(
      patches: TerminalStatusBarOverridePatches
    ): Promise<TerminalStatusBarPrefs>;
    getAll(): Promise<TerminalStatusBarPrefs>;
    resetItem(itemId: string): Promise<TerminalStatusBarPrefs>;
    setItemOverride(
      itemId: string,
      patch: TerminalStatusBarItemOverridePatch
    ): Promise<TerminalStatusBarPrefs>;
  };
  usageData: UsageDataService;
  window: {
    close(windowId: string): Promise<"closed" | "not-found" | "veto">;
    create(options?: WindowCreateOptions): Promise<{
      recordId: string;
      windowId: string;
    }>;
    focus(windowId: string): void;
    flushOpenWindows(
      additionalCriticalFlush?: () => Promise<void>
    ): Promise<void>;
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
