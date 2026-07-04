import type { AgentKind, DetectAgentsResult } from "@shared/contracts/agent.ts";
import type { MruState } from "@shared/contracts/command-palette-mru.ts";
import type {
  MenuPopupOptions,
  MenuPopupResult,
  MenuTemplate,
} from "@shared/contracts/menu.ts";
import type {
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
import {
  RENDERER_COMMAND_CHANNEL,
  RENDERER_COMMAND_RESULT_CHANNEL,
} from "@shared/contracts/renderer-command-channels.ts";
import type {
  TaskListResult,
  TaskRunSnapshot,
  TaskSpawnResult,
} from "@shared/contracts/tasks.ts";
import type { TerminalAPI } from "@shared/contracts/terminal.ts";
import type {
  WindowContext,
  WindowCreateResult,
} from "@shared/contracts/window.ts";
import type { WindowLayoutPulse } from "@shared/contracts/window-layout.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { contextBridge, ipcRenderer } from "electron";
import { aiApi, type PierAiAPI } from "./ai-api.ts";
import { filesApi, type PierFilesAPI } from "./file-api.ts";
import {
  foregroundActivityApi,
  type PierForegroundActivityAPI,
} from "./foreground-activity-api.ts";
import { gitApi, type PierGitAPI } from "./git-api.ts";
import { invokePierCommand, subscribeIpc } from "./ipc-envelope.ts";
import {
  type PierPluginSettingsAPI,
  pluginSettingsApi,
} from "./plugin-settings-api.ts";
import { terminalApi } from "./terminal-api.ts";
import {
  type PierTerminalStatusBarPrefsAPI,
  terminalStatusBarPrefsApi,
} from "./terminal-status-bar-api.ts";
import { type PierWorktreesAPI, worktreesApi } from "./worktree-api.ts";

export interface WindowInfo {
  focused: boolean;
  id: string;
  recordId: string;
}

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
  refresh: () => Promise<DetectAgentsResult>;
}

export interface PierNotificationsAPI {
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

export interface PierSecretsAPI {
  delete(key: string): Promise<void>;
  get(key: string): Promise<string | null>;
  list(): Promise<string[]>;
  set(key: string, value: string): Promise<void>;
}

export interface PierSettingsAPI {
  onOpenRequest: (cb: () => void) => () => void;
}

export interface PierTasksAPI {
  cancel: (args: { runId: string }) => Promise<TaskRunSnapshot>;
  list: (args: { projectRootPath: string }) => Promise<TaskListResult>;
  spawn: (args: {
    focus?: boolean;
    inputs?: Record<string, string>;
    placement?:
      | "active-tab"
      | "split-right"
      | "split-below"
      | "split-left"
      | "split-above";
    projectRootPath: string;
    taskId: string;
  }) => Promise<TaskSpawnResult>;
  status: (args: { runId: string }) => Promise<TaskRunSnapshot>;
}

/** window 子命名空间 — 窗口生命周期与布局事件. */
export interface PierWindowNsAPI {
  closeCurrent: () => Promise<void>;
  getContext: () => Promise<WindowContext>;
  onLayoutPulse: (cb: (pulse: WindowLayoutPulse) => void) => () => void;
  readyToShow: () => void;
}

/** env 子命名空间 — 运行时环境信息. */
export interface PierEnvAPI {
  platform: NodeJS.Platform;
}

export interface PierWindowAPI {
  agents: PierAgentsAPI;
  ai: PierAiAPI;
  closeWindow: (windowId: string) => Promise<void>;
  commandPalette: PierCommandPaletteAPI;
  commandPaletteMru: PierCommandPaletteMruAPI;
  createWindow: () => Promise<WindowCreateResult>;
  env: PierEnvAPI;
  files: PierFilesAPI;
  focusWindow: (windowId: string) => Promise<void>;
  foregroundActivity: PierForegroundActivityAPI;
  git: PierGitAPI;
  keybinding: PierKeybindingAPI;
  listWindows: () => Promise<WindowInfo[]>;
  menu: PierMenuAPI;
  notifications: PierNotificationsAPI;
  pluginSettings: PierPluginSettingsAPI;
  plugins: PierPluginsAPI;
  preferences: PierPreferencesAPI;
  rendererCommand: PierRendererCommandAPI;
  secrets: PierSecretsAPI;
  settings: PierSettingsAPI;
  tasks: PierTasksAPI;
  terminal: TerminalAPI;
  terminalStatusBarPrefs: PierTerminalStatusBarPrefsAPI;
  theme: PierThemeAPI;
  window: PierWindowNsAPI;
  workspace: PierWorkspaceAPI;
  worktrees: PierWorktreesAPI;
}

const agentsApi: PierAgentsAPI = {
  detect: () => ipcRenderer.invoke("pier:agents:detect"),
  prepareLaunch: (agentId: AgentKind) =>
    ipcRenderer.invoke("pier:agents:prepareLaunch", agentId),
  refresh: () => ipcRenderer.invoke("pier:agents:refresh"),
};

const preferencesApi: PierPreferencesAPI = {
  onChanged: (cb) => subscribeIpc(PIER_BROADCAST.PREFERENCES_CHANGED, cb),
  read: () =>
    invokePierCommand<ProjectPreferences>({ type: "preferences.read" }),
  update: (patch) =>
    invokePierCommand<ProjectPreferences>({
      patch,
      type: "preferences.update",
    }),
};

const notificationsApi: PierNotificationsAPI = {
  system: (request) => ipcRenderer.invoke("pier:notification:system", request),
};

const themeApi: PierThemeAPI = {
  setNativeChrome: (resolved, chromeColor) =>
    ipcRenderer.invoke("pier:theme:set-native-chrome", resolved, chromeColor),
};

const workspaceApi: PierWorkspaceAPI = {
  clearLayout: (recordId) =>
    invokePierCommand<null>({ recordId, type: "workspace.layout.clear" }).then(
      () => undefined
    ),
  loadLayout: (recordId) =>
    invokePierCommand<unknown | null>({
      recordId,
      type: "workspace.layout.read",
    }),
  onNewTerminalRequest: (cb) =>
    subscribeIpc(PIER_BROADCAST.NEW_TERMINAL_REQUEST, cb),
  saveLayout: (layout, recordId) =>
    invokePierCommand<null>({
      layout,
      recordId,
      type: "workspace.layout.save",
    }).then(() => undefined),
};

const rendererCommandApi: PierRendererCommandAPI = {
  onCommand: (cb) => subscribeIpc(RENDERER_COMMAND_CHANNEL, cb),
  resolve: (result) =>
    ipcRenderer.send(RENDERER_COMMAND_RESULT_CHANNEL, result),
};

const commandPaletteMruApi: PierCommandPaletteMruAPI = {
  read: () => invokePierCommand<MruState>({ type: "commandPaletteMru.read" }),
  recordUse: (actionId) => {
    invokePierCommand<null>({
      actionId,
      type: "commandPaletteMru.record",
    }).catch((err) => {
      console.error("[command-palette-mru] record failed:", err);
    });
  },
  clear: () => invokePierCommand<MruState>({ type: "commandPaletteMru.clear" }),
  onChange: (handler) => {
    const listener = (_event: unknown, state: MruState) => {
      handler(state);
    };
    ipcRenderer.on(PIER_BROADCAST.COMMAND_PALETTE_MRU_CHANGED, listener);
    return () => {
      ipcRenderer.off(PIER_BROADCAST.COMMAND_PALETTE_MRU_CHANGED, listener);
    };
  },
};

const commandPaletteApi: PierCommandPaletteAPI = {
  onToggleRequest: (cb) =>
    subscribeIpc(PIER_BROADCAST.COMMAND_PALETTE_TOGGLE_REQUEST, cb),
};

const secretsApi: PierSecretsAPI = {
  get: (key) => ipcRenderer.invoke("pier:secrets:get", key),
  set: (key, value) => ipcRenderer.invoke("pier:secrets:set", { key, value }),
  delete: (key) => ipcRenderer.invoke("pier:secrets:delete", key),
  list: () => ipcRenderer.invoke("pier:secrets:list"),
};

const pluginsApi: PierPluginsAPI = {
  list: () =>
    invokePierCommand<PluginRegistryListResult>({ type: "plugin.list" }),
  inspect: (id) =>
    invokePierCommand<PluginRegistryEntry>({ id, type: "plugin.inspect" }),
  enable: (id) =>
    invokePierCommand<PluginRegistryEntry>({ id, type: "plugin.enable" }),
  disable: (id) =>
    invokePierCommand<PluginRegistryEntry>({ id, type: "plugin.disable" }),
  onChanged: (cb) => subscribeIpc(PIER_BROADCAST.PLUGINS_CHANGED, cb),
};

// gitApi / pluginSettingsApi 实现在独立文件(避免 preload/index.ts 超 500 行硬上限)。

const menuApi: PierMenuAPI = {
  popup: (template, options) =>
    ipcRenderer.invoke("pier:menu:popup", template, options),
};

const settingsApi: PierSettingsAPI = {
  onOpenRequest: (cb) => subscribeIpc(PIER_BROADCAST.SETTINGS_OPEN_REQUEST, cb),
};

const keybindingApi: PierKeybindingAPI = {
  onForward: (cb) => subscribeIpc("pier:keybinding:forward", cb),
  onModifierState: (cb) => subscribeIpc("pier:keybinding:modifier-state", cb),
};

const tasksApi: PierTasksAPI = {
  cancel: (args) =>
    invokePierCommand<TaskRunSnapshot>({
      runId: args.runId,
      type: "run.cancel",
    }),
  list: (args) =>
    invokePierCommand<TaskListResult>({
      projectRootPath: args.projectRootPath,
      type: "run.list",
    }),
  spawn: (args) =>
    invokePierCommand<TaskSpawnResult>({
      ...(args.focus === undefined ? {} : { focus: args.focus }),
      ...(args.inputs ? { inputs: args.inputs } : {}),
      ...(args.placement ? { placement: args.placement } : {}),
      projectRootPath: args.projectRootPath,
      taskId: args.taskId,
      type: "run.spawn",
    }),
  status: (args) =>
    invokePierCommand<TaskRunSnapshot>({
      runId: args.runId,
      type: "run.status",
    }),
};

const api: PierWindowAPI = {
  agents: agentsApi,
  foregroundActivity: foregroundActivityApi,
  ai: aiApi,
  closeWindow: (windowId) =>
    invokePierCommand<void>({ type: "window.close", windowId }),
  commandPalette: commandPaletteApi,
  commandPaletteMru: commandPaletteMruApi,
  createWindow: () =>
    invokePierCommand<WindowCreateResult>({ type: "window.create" }),
  env: {
    platform: process.platform,
  },
  focusWindow: (windowId) =>
    invokePierCommand<void>({ type: "window.focus", windowId }),
  files: filesApi,
  git: gitApi,
  keybinding: keybindingApi,
  listWindows: () => invokePierCommand<WindowInfo[]>({ type: "window.list" }),
  menu: menuApi,
  notifications: notificationsApi,
  plugins: pluginsApi,
  pluginSettings: pluginSettingsApi,
  preferences: preferencesApi,
  rendererCommand: rendererCommandApi,
  secrets: secretsApi,
  settings: settingsApi,
  tasks: tasksApi,
  terminal: terminalApi,
  terminalStatusBarPrefs: terminalStatusBarPrefsApi,
  theme: themeApi,
  window: {
    closeCurrent: () => ipcRenderer.invoke("pier://window:close-current"),
    getContext: () => ipcRenderer.invoke("pier://window:context"),
    onLayoutPulse: (cb) => subscribeIpc(PIER_BROADCAST.WINDOW_LAYOUT_PULSE, cb),
    readyToShow: () => ipcRenderer.send(PIER.WINDOW_RENDERER_READY),
  },
  workspace: workspaceApi,
  worktrees: worktreesApi,
};

contextBridge.exposeInMainWorld("pier", api);
