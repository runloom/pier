import type { MruState } from "@shared/contracts/command-palette-mru.ts";
import type { WindowInfo } from "@shared/contracts/events.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import type { ProjectPreferencesPatch } from "@shared/contracts/preferences-patch.ts";
import type { ResolvedTerminalLaunchOptions } from "@shared/contracts/terminal/launch.ts";
import type {
  TerminalStatusBarItemOverridePatch,
  TerminalStatusBarOverridePatches,
  TerminalStatusBarPrefs,
} from "@shared/contracts/terminal/status-bar.ts";
import type { WindowCreateOptions } from "@shared/contracts/window.ts";
import type { AgentMcpCatalogService } from "../services/agent-mcp-catalog/service.ts";
import type { AgentRulesService } from "../services/agent-rules/service.ts";
import type { AgentRuntimeIndexService } from "../services/agent-runtime-index/index.ts";
import type { AgentDetectionService } from "../services/agents/detection-service.ts";
import type { AgentUsageService } from "../services/agents/usage-service.ts";
import type { AiService } from "../services/ai/service.ts";
import type { AppUpdateService } from "../services/app-updates/service.ts";
import type { CommentsService } from "../services/comments/service.ts";
import type { FileDraftsService } from "../services/files/drafts-service.ts";
import type { FileService } from "../services/files/service.ts";
import type { FileWatchService } from "../services/files/watch-service.ts";
import type { GitService } from "../services/git/service.ts";
import type { GitWatchService } from "../services/git/watch/service.ts";
import type { WorktreeService } from "../services/git/worktree/service.ts";
import type { GitReviewService } from "../services/git-review/service.ts";
import type { LiveModulesService } from "../services/live-modules/service.ts";
import type { LocalEnvironmentService } from "../services/local-environments-service.ts";
import type { ManagedPluginInstallService } from "../services/managed-plugins/install-service.ts";
import type { PanelContextResolutionControl } from "../services/panel-context-resolver.ts";
import type { PanelTransferService } from "../services/panel-transfer/types.ts";
import type { PierHomeService } from "../services/pier-home/service.ts";
import type { PluginService } from "../services/plugin-service.ts";
import type { PluginSettingsService } from "../services/plugin-settings-service.ts";
import type { ProcessEnvironmentService } from "../services/process-environment-service.ts";
import type { ManagedAgentLaunchGate } from "../services/project-skills/launch-gate/index.ts";
import type { PierBindingsChannel } from "../services/project-skills/pier-bindings/index.ts";
import type { ProjectSkillsService } from "../services/project-skills/service.ts";
import type { SystemSkillsChannel } from "../services/project-skills/system-skills/index.ts";
import type { RendererCommandService } from "../services/renderer-command-service.ts";
import type { TaskService } from "../services/tasks/service.ts";
import type { UsageDataService } from "../services/usage-data/service.ts";
import type { WindowTransitionLease } from "../services/window-service.ts";
import type { SecretsStore } from "../state/secrets-store.ts";
import type { WindowBounds } from "../windows/manager.ts";
import type { PluginDisableTransitionCoordinator } from "./plugin-disable-transition.ts";

export interface PierCoreServices {
  agentDetection: AgentDetectionService;
  agentLaunchGate?: ManagedAgentLaunchGate;
  /** Agent CLI install/update lifecycle (settings). Optional for tests. */
  agentLifecycle?: import("../services/agents/lifecycle/service.ts").AgentLifecycleService;
  agentMcpCatalog?: AgentMcpCatalogService;
  agentRules?: AgentRulesService;
  agentRuntimeIndex: AgentRuntimeIndexService;
  agentUsage: AgentUsageService;
  ai: AiService;
  appUpdates: AppUpdateService;
  commandPaletteMru: {
    clear(): Promise<MruState>;
    read(): Promise<MruState>;
    recordUse(actionId: string): Promise<void>;
  };
  comments: CommentsService;
  /**
   * local-control 注册后注入：与 CLI control.snapshot/watch 共享 revision 高水位。
   * 未注册时 app.snapshot 降级为临时 service（仍可用，revision 从 1 起）。
   */
  controlBootId?: string;
  /** E11：RuntimeControl 摘要投影（local-control 注册时注入）。 */
  controlRuntimes?: {
    listRuntimeSummaries(): Array<{
      bootId: string;
      runtimeId: string;
      generation: number;
      agentId: string;
      panelId: string;
      windowId: string;
      fact: string;
      closed: boolean;
      worktreeKey?: string | undefined;
      cwd?: string | undefined;
    }>;
  };
  controlSnapshot?: import("../services/control-snapshot/service.ts").ControlSnapshotService;
  fileDrafts?: FileDraftsService;
  files?: FileService;
  fileWatch?: FileWatchService;
  /**
   * FA 快照源（W5-S4 control.snapshot activity 全貌）。可选；缺省回退 Runtime Index。
   */
  foregroundActivity?: {
    snapshot(): import("@shared/contracts/foreground-activity.ts").ForegroundActivityBroadcast;
  };
  git: GitService;
  gitReview: GitReviewService;
  gitWatch: GitWatchService;
  liveModules?: LiveModulesService;
  localEnvironments: LocalEnvironmentService;
  managedPlugins: ManagedPluginInstallService;
  /**
   * 消息中心命令面（W5）。测试注入；生产缺省走 getNotificationCenterService()。
   * 写路径仅 markRead / markAllRead；禁止由此写 FA / Runtime Index。
   */
  notificationCenter?: import("./commands/notifications.ts").NotificationCenterCommandFacade;
  panelContexts: {
    listRecent(): Promise<PanelContext[]>;
    recordRecent(context: PanelContext): Promise<void>;
    resolveForPath(
      path: string,
      control?: PanelContextResolutionControl
    ): Promise<PanelContext>;
  };
  panelTransfer?: PanelTransferService;
  pierBindings?: PierBindingsChannel;
  pierHome?: PierHomeService;
  pluginDisableTransitions: PluginDisableTransitionCoordinator;
  pluginSettings: PluginSettingsService;
  plugins: PluginService;
  preferences: {
    read(): Promise<ProjectPreferences>;
    update(patch: ProjectPreferencesPatch): Promise<ProjectPreferences>;
  };
  processEnvironment: ProcessEnvironmentService;
  projectSkills?: ProjectSkillsService;
  rendererCommand: RendererCommandService;
  secrets: SecretsStore;
  /** Bundled Pier system skills (pier-canvas, …). Optional for tests. */
  systemSkills?: SystemSkillsChannel;
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
    closeAfterTransfer?(
      lease: WindowTransitionLease,
      windowId: string,
      transferId: string
    ): Promise<void>;
    create(options?: WindowCreateOptions): Promise<{
      recordId: string;
      windowId: string;
    }>;
    createForTransfer?(
      lease: WindowTransitionLease,
      input: {
        bounds: WindowBounds;
        transferId: string;
      }
    ): Promise<{
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
    runExclusive?<T>(
      operation: (lease: WindowTransitionLease) => Promise<T>
    ): Promise<T>;
  };
  workspace: {
    clearLayout(recordId: string): Promise<void>;
    readLayout(recordId: string): Promise<unknown | null>;
    saveLayout(layout: unknown, recordId: string): Promise<void>;
  };
  worktrees: WorktreeService;
}
