import type { AgentKind, DetectAgentsResult } from "@shared/contracts/agent.ts";
import type { AgentSelectionResult } from "@shared/contracts/agent-usage.ts";
import type {
  AppQuitConfirmationRequest,
  AppQuitDecisionPayload,
} from "@shared/contracts/app-quit.ts";
import type { MruState } from "@shared/contracts/command-palette-mru.ts";
import type {
  MenuPopupOptions,
  MenuPopupResult,
  MenuTemplate,
} from "@shared/contracts/menu.ts";
import type {
  OpenSystemNotificationSettingsResult,
  SystemNotificationPermissionSnapshot,
  SystemNotificationRequest,
  SystemNotificationResult,
} from "@shared/contracts/notification.ts";
import type {
  PluginRegistryEntry,
  PluginRegistryListResult,
} from "@shared/contracts/plugin.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import type {
  RendererCommandEnvelope,
  RendererCommandResult,
} from "@shared/contracts/renderer-command.ts";
import type { RendererRuntimeFailureReport } from "@shared/contracts/renderer-runtime-failure.ts";
import type { WindowContext } from "@shared/contracts/window.ts";
import type { WindowLayoutPulse } from "@shared/contracts/window-layout.ts";

/** Preload API namespace interfaces, split from index.ts (file-size cap). */

export type PreferencesSnapshot = ProjectPreferences;

export interface PierPreferencesAPI {
  /**
   * 订阅 preferences 修改 — main 端 update 后会广播给所有 BrowserWindow,
   * 包括发起 update 的窗口. renderer store 负责对相同快照去重.
   */
  onChanged: (cb: (next: PreferencesSnapshot) => void) => () => void;
  read: () => Promise<PreferencesSnapshot>;
  update: (patch: Partial<PreferencesSnapshot>) => Promise<PreferencesSnapshot>;
}

export interface PierAgentsAPI {
  detect: () => Promise<DetectAgentsResult>;
  prepareLaunch: (agentId: AgentKind) => Promise<{ launchId: string | null }>;
  prepareLaunchFromSpec: (spec: {
    agentId: AgentKind;
    command?: string;
    cwd?: string;
  }) => Promise<{ launchId: string | null }>;
  refresh: () => Promise<DetectAgentsResult>;
  selection: () => Promise<AgentSelectionResult>;
}

export interface PierNotificationsAPI {
  getPermissionStatus: () => Promise<SystemNotificationPermissionSnapshot>;
  onAttentionSoundPlay: (
    cb: (payload: { soundId: string }) => void
  ) => () => void;
  onPermissionChanged: (
    cb: (snapshot: SystemNotificationPermissionSnapshot) => void
  ) => () => void;
  openSystemSettings: () => Promise<OpenSystemNotificationSettingsResult>;
  sendTest: () => Promise<SystemNotificationResult>;
  system: (
    request: SystemNotificationRequest
  ) => Promise<SystemNotificationResult>;
}

export interface PierThemeAPI {
  setNativeChrome: (
    resolved: "light" | "dark",
    chromeColor?: string
  ) => Promise<void>;
}

export interface PierWorkspaceAPI {
  clearLayout: (recordId: string) => Promise<void>;
  loadLayout: (recordId: string) => Promise<unknown | null>;
  onNewTerminalRequest: (cb: () => void) => () => void;
  saveLayout: (layout: unknown, recordId: string) => Promise<void>;
}

export interface PierRendererCommandAPI {
  onCommand: (cb: (envelope: RendererCommandEnvelope) => void) => () => void;
  resolve: (result: RendererCommandResult) => void;
}

export interface PierCommandPaletteMruAPI {
  clear: () => Promise<MruState>;
  /** 订阅 changed 广播, 返回解绑函数 */
  onChange: (handler: (state: MruState) => void) => () => void;
  read: () => Promise<MruState>;
  recordUse: (actionId: string) => void;
}

export interface PierCommandPaletteAPI {
  onToggleRequest: (cb: () => void) => () => void;
}

export interface PierAppQuitAPI {
  decide: (decision: AppQuitDecisionPayload) => Promise<void>;
  onRequested: (
    cb: (request: AppQuitConfirmationRequest) => void
  ) => () => void;
}

export interface PierPluginsAPI {
  disable: (id: string) => Promise<PluginRegistryEntry>;
  enable: (id: string) => Promise<PluginRegistryEntry>;
  inspect: (id: string) => Promise<PluginRegistryEntry>;
  list: () => Promise<PluginRegistryListResult>;
  /**
   * 订阅插件 registry 变更 — main 在 setEnabled / registry refresh 后
   * 广播最新快照给所有 BrowserWindow, 包括发起变更的窗口.
   */
  onChanged: (cb: (snapshot: PluginRegistryListResult) => void) => () => void;
}

export type { PierAiAPI } from "./ai-api.ts";
export type { PierFilesAPI } from "./file-api.ts";
export type { PierFileQueryAPI } from "./file-query-api.ts";
export type { PierFileSaveTargetAPI } from "./file-save-target-api.ts";
export type { PierGitAPI } from "./git-api.ts";
export type { PierPluginSettingsAPI } from "./plugin-settings-api.ts";
export type { PierTerminalStatusBarPrefsAPI } from "./terminal-status-bar-api.ts";
export type { PierWorktreesAPI } from "./worktree-api.ts";

/**
 * Keyboard chord forward: swift NSEvent monitor 捕获 Cmd+key → main IPC →
 * 这里 dispatch 到 renderer 侧的 listener (shell-keybindings).
 */
export interface PierKeybindingAPI {
  onForward: (
    cb: (chord: { modifierFlags: number; chars: string }) => void
  ) => () => void;
  onModifierState: (
    cb: (state: { modifierFlags: number }) => void
  ) => () => void;
}

export interface PierMenuAPI {
  popup: (
    template: MenuTemplate,
    options?: MenuPopupOptions
  ) => Promise<MenuPopupResult>;
}

export interface PierClipboardAPI {
  writeText: (text: string) => Promise<void>;
}

export interface PierSettingsAPI {
  onOpenRequest: (cb: () => void) => () => void;
}

/** window 子命名空间 — 窗口生命周期与布局事件. */
export interface PierWindowNsAPI {
  closeCurrent: () => Promise<void>;
  getContext: () => Promise<WindowContext>;
  onLayoutPulse: (cb: (pulse: WindowLayoutPulse) => void) => () => void;
  readyToShow: () => void;
  /** Soft-reload current WebContents (error recovery). Prefer over app.relaunch. */
  reload: () => Promise<void>;
  reportRuntimeFailure: (failure: RendererRuntimeFailureReport) => void;
}

/** env 子命名空间 — 运行时环境信息. */
export interface PierEnvAPI {
  platform: NodeJS.Platform;
}
