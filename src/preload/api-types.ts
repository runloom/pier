import type { AgentSelectionResult } from "@shared/contracts/agent/usage.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
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
  PluginRegistryEntry,
  PluginRegistryListResult,
} from "@shared/contracts/plugin.ts";
import type {
  ProjectPreferences,
  ThemePreference,
} from "@shared/contracts/preferences.ts";
import type {
  RendererCommandEnvelope,
  RendererCommandResult,
} from "@shared/contracts/renderer-command.ts";
import type { ThemeSystemAppearancePayload } from "@shared/contracts/theme/system-appearance.ts";

/** Preload API namespace interfaces, split from index.ts (file-size cap). */

export type { PierNotificationsAPI } from "./notifications-api.ts";
export type { PierWindowNsAPI } from "./window-api.ts";

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

export type { ShellEnvironmentHostStatus } from "@shared/contracts/terminal/shell-environment.ts";

export interface PierShellEnvironmentAPI {
  refresh: () => Promise<
    import("@shared/contracts/terminal/shell-environment.ts").ShellEnvironmentHostStatus
  >;
  status: () => Promise<
    import("@shared/contracts/terminal/shell-environment.ts").ShellEnvironmentHostStatus
  >;
}

export interface PierAgentsLifecycleAPI {
  /** Cancel in-flight install/update for this agent. */
  cancel: (agentId: AgentKind) => Promise<boolean>;
  /** Subscribe to live install/update progress; returns unsubscribe. */
  onProgress: (
    cb: (
      progress: import("@shared/contracts/agent/lifecycle.ts").AgentLifecycleProgress
    ) => void
  ) => () => void;
  run: (
    agentId: AgentKind,
    action: import("@shared/contracts/agent/lifecycle.ts").AgentLifecycleAction
  ) => Promise<
    import("@shared/contracts/agent/lifecycle.ts").AgentLifecycleActionResult
  >;
  runMany: (
    agentIds: AgentKind[],
    action: import("@shared/contracts/agent/lifecycle.ts").AgentLifecycleAction
  ) => Promise<
    import("@shared/contracts/agent/lifecycle.ts").AgentLifecycleActionResult[]
  >;
}

export interface PierAgentsAPI {
  lifecycle: PierAgentsLifecycleAPI;
  prepareLaunch: (agentId: AgentKind) => Promise<{ launchId: string | null }>;
  prepareLaunchFromSpec: (spec: {
    agentId: AgentKind;
    command?: string;
    cwd?: string;
    resumeSessionId?: string;
  }) => Promise<{ launchId: string | null }>;
  selection: () => Promise<AgentSelectionResult>;
}

export interface ThemeVisualPreviewPayload {
  stylePresetId: string;
  theme: string;
}

export interface PierThemeAPI {
  /** 订阅 OS / nativeTheme 外观变化（偏好为跟随系统时重解主题）。 */
  onSystemAppearance: (
    cb: (payload: ThemeSystemAppearancePayload) => void
  ) => () => void;
  /** 订阅其它窗发起的 ephemeral 主题预览。 */
  onVisualPreview: (
    cb: (payload: ThemeVisualPreviewPayload) => void
  ) => () => void;
  /**
   * 命令面板 hover 预览：广播视觉态到其它窗（不落盘）。
   * 本窗已由 applyThemeVisual 本地应用；main 排除 sender。
   */
  previewVisual: (payload: ThemeVisualPreviewPayload) => Promise<void>;
  /**
   * 同步 Electron `nativeTheme.themeSource` 与窗口兜底底色。
   * 第一参必须是偏好（含 `system`），禁止传已解析的 light/dark，
   * 否则会锁死 Chromium `prefers-color-scheme`，系统主题切换不再到达 renderer。
   */
  setNativeChrome: (
    themeSource: ThemePreference,
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
  onMenuCommand: (cb: (commandId: string) => void) => () => void;
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
export type { PierMemoryAPI } from "./memory/api.ts";
export type { PierPanelsAPI, PierPanelsListSnapshot } from "./panels-api.ts";
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
  /**
   * Force text-only system pasteboard (no image) until matching end.
   * Used when injecting text into agent TUIs that probe clipboard images on paste.
   */
  beginImageSuppress: () => Promise<void>;
  endImageSuppress: () => Promise<void>;
  writeText: (text: string) => Promise<void>;
}

export interface SettingsOpenRequest {
  section?: string;
}

export interface PierSettingsAPI {
  onOpenRequest: (cb: (payload?: SettingsOpenRequest) => void) => () => void;
}

/** env 子命名空间 — 运行时环境信息. */
export interface PierEnvAPI {
  platform: NodeJS.Platform;
}
