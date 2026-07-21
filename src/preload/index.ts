import type { AgentKind } from "@shared/contracts/agent.ts";
import type { MruState } from "@shared/contracts/command-palette-mru.ts";
import type { WindowInfo as SharedWindowInfo } from "@shared/contracts/events.ts";
import type { SystemNotificationPermissionSnapshot } from "@shared/contracts/notification.ts";
import type {
  PluginRegistryEntry,
  PluginRegistryListResult,
} from "@shared/contracts/plugin.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import {
  RENDERER_COMMAND_CHANNEL,
  RENDERER_COMMAND_RESULT_CHANNEL,
} from "@shared/contracts/renderer-command-channels.ts";
import type { TerminalAPI } from "@shared/contracts/terminal.ts";
import type { WindowCreateResult } from "@shared/contracts/window.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { contextBridge, ipcRenderer } from "electron";
import {
  agentRuntimeIndexApi,
  type PierAgentRuntimeIndexAPI,
} from "./agent-runtime-index-api.ts";
import { aiApi, type PierAiAPI } from "./ai-api.ts";
import {
  environmentsApi,
  type PierEnvironmentsAPI,
} from "./environment-api.ts";
import {
  createExternalNavigationApi,
  type PierExternalNavigationApi,
} from "./external-navigation-api.ts";
import { filesApi, type PierFilesAPI } from "./file-api.ts";
import {
  createFilePreviewApi,
  type PierFilePreviewApi,
} from "./file-preview-api.ts";
import { fileQueryApi, type PierFileQueryAPI } from "./file-query-api.ts";
import {
  foregroundActivityApi,
  type PierForegroundActivityAPI,
} from "./foreground-activity-api.ts";
import { gitApi, type PierGitAPI } from "./git-api.ts";
import { invokePierCommand, subscribeIpc } from "./ipc-envelope.ts";
import {
  type AppPreloadApi,
  type AppUpdatePreloadApi,
  createAppPreloadApi,
  createAppUpdatePreloadApi,
  createManagedPluginsPreloadApi,
  createPluginRpcPreloadApi,
  type ManagedPluginsPreloadApi,
  type PluginRpcPreloadApi,
} from "./plugin-management-api.ts";
import {
  type PierPluginSettingsAPI,
  pluginSettingsApi,
} from "./plugin-settings-api.ts";
import { installRendererBootHandshake } from "./renderer-boot-handshake.ts";

const signalRendererBoot = installRendererBootHandshake(ipcRenderer);

import {
  type PierProjectSkillsAPI,
  projectSkillsApi,
} from "./project-skills-api.ts";
import { type PierSystemStatsAPI, systemStatsApi } from "./system-stats-api.ts";
import { type PierTasksAPI, tasksApi } from "./task-api.ts";
import { terminalApi } from "./terminal-api.ts";
import {
  type PierTerminalStatusBarPrefsAPI,
  terminalStatusBarPrefsApi,
} from "./terminal-status-bar-api.ts";
import { type PierUsageDataAPI, usageDataApi } from "./usage-data-api.ts";
import { type PierWorktreesAPI, worktreesApi } from "./worktree-api.ts";

export type WindowInfo = SharedWindowInfo;

export type {
  PierAgentsAPI,
  PierAppQuitAPI,
  PierClipboardAPI,
  PierCommandPaletteAPI,
  PierCommandPaletteMruAPI,
  PierEnvAPI,
  PierKeybindingAPI,
  PierMenuAPI,
  PierNotificationsAPI,
  PierPluginsAPI,
  PierPreferencesAPI,
  PierRendererCommandAPI,
  PierSettingsAPI,
  PierThemeAPI,
  PierWindowNsAPI,
  PierWorkspaceAPI,
  PreferencesSnapshot,
} from "./api-types.ts";

import type {
  PierAgentsAPI,
  PierAppQuitAPI,
  PierClipboardAPI,
  PierCommandPaletteAPI,
  PierCommandPaletteMruAPI,
  PierEnvAPI,
  PierKeybindingAPI,
  PierMenuAPI,
  PierNotificationsAPI,
  PierPluginsAPI,
  PierPreferencesAPI,
  PierRendererCommandAPI,
  PierSettingsAPI,
  PierThemeAPI,
  PierWindowNsAPI,
  PierWorkspaceAPI,
} from "./api-types.ts";

export interface PierWindowAPI {
  agentRuntimeIndex: PierAgentRuntimeIndexAPI;
  agents: PierAgentsAPI;
  ai: PierAiAPI;
  app: AppPreloadApi;
  appQuit: PierAppQuitAPI;
  appUpdate: AppUpdatePreloadApi;
  clipboard: PierClipboardAPI;
  closeWindow: (windowId: string) => Promise<void>;
  commandPalette: PierCommandPaletteAPI;
  commandPaletteMru: PierCommandPaletteMruAPI;
  createWindow: () => Promise<WindowCreateResult>;
  env: PierEnvAPI;
  environments: PierEnvironmentsAPI;
  externalNavigation: PierExternalNavigationApi;
  filePreviews: PierFilePreviewApi;
  fileQuery: PierFileQueryAPI;
  files: PierFilesAPI;
  focusWindow: (windowId: string) => Promise<void>;
  foregroundActivity: PierForegroundActivityAPI;
  git: PierGitAPI;
  keybinding: PierKeybindingAPI;
  listWindows: () => Promise<WindowInfo[]>;
  managedPlugins: ManagedPluginsPreloadApi;
  menu: PierMenuAPI;
  notifications: PierNotificationsAPI;
  pluginRpc: PluginRpcPreloadApi;
  pluginSettings: PierPluginSettingsAPI;
  plugins: PierPluginsAPI;
  preferences: PierPreferencesAPI;
  projectSkills: PierProjectSkillsAPI;
  rendererCommand: PierRendererCommandAPI;
  settings: PierSettingsAPI;
  systemStats: PierSystemStatsAPI;
  tasks: PierTasksAPI;
  terminal: TerminalAPI;
  terminalStatusBarPrefs: PierTerminalStatusBarPrefsAPI;
  theme: PierThemeAPI;
  usageData: PierUsageDataAPI;
  window: PierWindowNsAPI;
  workspace: PierWorkspaceAPI;
  worktrees: PierWorktreesAPI;
}

const agentsApi: PierAgentsAPI = {
  detect: () => ipcRenderer.invoke("pier:agents:detect"),
  prepareLaunch: (agentId: AgentKind) =>
    ipcRenderer.invoke("pier:agents:prepareLaunch", agentId),
  prepareLaunchFromSpec: (spec) =>
    ipcRenderer.invoke("pier:agents:prepareLaunchFromSpec", spec),
  refresh: () => ipcRenderer.invoke("pier:agents:refresh"),
  selection: () => ipcRenderer.invoke("pier:agents:selection"),
};

const appQuitApi: PierAppQuitAPI = {
  decide: (decision) =>
    ipcRenderer.invoke(PIER.APP_QUIT_DECISION, decision).then(() => undefined),
  onRequested: (cb) => subscribeIpc(PIER_BROADCAST.APP_QUIT_REQUESTED, cb),
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
  getPermissionStatus: () =>
    ipcRenderer.invoke(PIER.SYSTEM_NOTIFICATION_PERMISSION),
  onPermissionChanged: (cb) => {
    const listener = (
      _event: unknown,
      payload: SystemNotificationPermissionSnapshot
    ): void => {
      cb(payload);
    };
    ipcRenderer.on(
      PIER_BROADCAST.SYSTEM_NOTIFICATION_PERMISSION_CHANGED,
      listener
    );
    return () => {
      ipcRenderer.off(
        PIER_BROADCAST.SYSTEM_NOTIFICATION_PERMISSION_CHANGED,
        listener
      );
    };
  },
  openSystemSettings: () =>
    ipcRenderer.invoke(PIER.SYSTEM_NOTIFICATION_OPEN_SETTINGS),
  sendTest: () => ipcRenderer.invoke(PIER.SYSTEM_NOTIFICATION_TEST),
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

const externalNavigationApi = createExternalNavigationApi({
  invoke: (request) =>
    ipcRenderer.invoke(PIER.EXTERNAL_NAVIGATION_OPEN, request),
  isUserActivationActive: () => navigator.userActivation?.isActive === true,
  now: Date.now,
  randomNonce: () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      ""
    );
  },
});

const filePreviewApi = createFilePreviewApi({
  invokeAcquire: (request) =>
    ipcRenderer.invoke(PIER.FILE_PREVIEW_RUNTIME_ACQUIRE, request),
  invokeIssue: (request) =>
    ipcRenderer.invoke(PIER.FILE_PREVIEW_TICKET_ISSUE, request),
  invokeRelease: (request) =>
    ipcRenderer.invoke(PIER.FILE_PREVIEW_TICKET_RELEASE, request),
  invokeRevoke: (request) =>
    ipcRenderer.invoke(PIER.FILE_PREVIEW_RUNTIME_REVOKE, request),
});

// gitApi / pluginSettingsApi 实现在独立文件(避免 preload/index.ts 超 500 行硬上限)。

const menuApi: PierMenuAPI = {
  popup: (template, options) =>
    ipcRenderer.invoke("pier:menu:popup", template, options),
};

const clipboardApi: PierClipboardAPI = {
  writeText: (text) => ipcRenderer.invoke("pier:clipboard:writeText", text),
};

const settingsApi: PierSettingsAPI = {
  onOpenRequest: (cb) => subscribeIpc(PIER_BROADCAST.SETTINGS_OPEN_REQUEST, cb),
};

const keybindingApi: PierKeybindingAPI = {
  onForward: (cb) => subscribeIpc("pier:keybinding:forward", cb),
  onModifierState: (cb) => subscribeIpc("pier:keybinding:modifier-state", cb),
};

const api: PierWindowAPI = {
  agents: agentsApi,
  appQuit: appQuitApi,
  agentRuntimeIndex: agentRuntimeIndexApi,
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
  fileQuery: fileQueryApi,
  environments: environmentsApi,
  externalNavigation: externalNavigationApi,
  filePreviews: filePreviewApi,
  git: gitApi,
  keybinding: keybindingApi,
  listWindows: () => invokePierCommand<WindowInfo[]>({ type: "window.list" }),
  menu: menuApi,
  clipboard: clipboardApi,
  notifications: notificationsApi,
  plugins: pluginsApi,
  pluginSettings: pluginSettingsApi,
  preferences: preferencesApi,
  projectSkills: projectSkillsApi,
  rendererCommand: rendererCommandApi,
  settings: settingsApi,
  systemStats: systemStatsApi,
  tasks: tasksApi,
  terminal: terminalApi,
  terminalStatusBarPrefs: terminalStatusBarPrefsApi,
  usageData: usageDataApi,
  managedPlugins: createManagedPluginsPreloadApi(),
  pluginRpc: createPluginRpcPreloadApi(),
  app: createAppPreloadApi(),
  appUpdate: createAppUpdatePreloadApi(),
  theme: themeApi,
  window: {
    closeCurrent: () => ipcRenderer.invoke("pier://window:close-current"),
    getContext: () => ipcRenderer.invoke("pier://window:context"),
    onLayoutPulse: (cb) => subscribeIpc(PIER_BROADCAST.WINDOW_LAYOUT_PULSE, cb),
    readyToShow: signalRendererBoot,
    reportRuntimeFailure: (failure) =>
      ipcRenderer.send(PIER.WINDOW_RENDERER_RUNTIME_FAILURE, failure),
  },
  workspace: workspaceApi,
  worktrees: worktreesApi,
};

contextBridge.exposeInMainWorld("pier", api);
