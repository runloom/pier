import type { AgentKind } from "@shared/contracts/agent.ts";
import type { MruState } from "@shared/contracts/command-palette-mru.ts";
import type { WindowInfo as SharedWindowInfo } from "@shared/contracts/events.ts";
import type {
  PluginRegistryEntry,
  PluginRegistryListResult,
} from "@shared/contracts/plugin.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import {
  RENDERER_COMMAND_CHANNEL,
  RENDERER_COMMAND_RESULT_CHANNEL,
} from "@shared/contracts/renderer-command-channels.ts";
import type { ShellEnvironmentHostStatus } from "@shared/contracts/terminal/shell-environment.ts";
import type { TerminalAPI } from "@shared/contracts/terminal.ts";
import type { WindowCreateResult } from "@shared/contracts/window.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { contextBridge, ipcRenderer } from "electron";
import { agentAssetsApi, type PierAgentAssetsAPI } from "./agent-assets-api.ts";
import {
  agentRuntimeIndexApi,
  type PierAgentRuntimeIndexAPI,
} from "./agent-runtime-index-api.ts";
import { aiApi, type PierAiAPI } from "./ai-api.ts";
import { canvasHostApi, type PierCanvasHostAPI } from "./canvas-host-api.ts";
import { commentsApi, type PierCommentsAPI } from "./comments-api.ts";
import { diagnosticsApi, type PierDiagnosticsAPI } from "./diagnostics-api.ts";
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
import { hostCatalogApi, type PierHostCatalogAPI } from "./host-catalog-api.ts";
import {
  createHtmlPreviewApi,
  type PierHtmlPreviewApi,
} from "./html-preview/api.ts";
import { invokePierCommand, subscribeIpc } from "./ipc-envelope.ts";
import { liveModulesApi, type PierLiveModulesAPI } from "./live-modules-api.ts";
import { lspApi, type PierLspAPI } from "./lsp-api.ts";
import {
  createMediaPreviewApi,
  type PierMediaPreviewApi,
} from "./media-preview-api.ts";
import {
  notificationCenterApi,
  type PierNotificationCenterAPI,
} from "./notification-center-api.ts";
import {
  notificationsApi,
  type PierNotificationsAPI,
} from "./notifications-api.ts";
import {
  createPanelTransferApi,
  type PierPanelTransferAPI,
} from "./panel-transfer-api.ts";
import { type PierPanelsAPI, panelsApi } from "./panels-api.ts";
import {
  type PierHomeSkillsAPI,
  type PierPierBindingsAPI,
  pierBindingsApi,
  pierHomeSkillsApi,
} from "./pier-home-skills-api.ts";
import { type PierResourceAPI, pierResourceApi } from "./pier-resource-api.ts";
import {
  type AppCliPreloadApi,
  type AppPreloadApi,
  type AppUpdatePreloadApi,
  createAppCliPreloadApi,
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
import {
  type PierProjectSkillsAPI,
  projectSkillsApi,
} from "./project-skills-api.ts";
import { installRendererBootHandshake } from "./renderer-boot-handshake.ts";
import { type PierTasksAPI, tasksApi } from "./task-api.ts";
import { terminalApi } from "./terminal-api.ts";
import {
  type PierTerminalStatusBarPrefsAPI,
  terminalStatusBarPrefsApi,
} from "./terminal-status-bar-api.ts";
import { type PierTerminalsAPI, terminalsApi } from "./terminals-api.ts";
import { type PierUsageDataAPI, usageDataApi } from "./usage-data-api.ts";
import { createWindowApi } from "./window-api.ts";
import { type PierWorktreesAPI, worktreesApi } from "./worktree-api.ts";

const signalRendererBoot = installRendererBootHandshake(ipcRenderer);

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
  PierShellEnvironmentAPI,
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
  PierPluginsAPI,
  PierPreferencesAPI,
  PierRendererCommandAPI,
  PierSettingsAPI,
  PierShellEnvironmentAPI,
  PierThemeAPI,
  PierWorkspaceAPI,
} from "./api-types.ts";
import type { PierWindowNsAPI } from "./window-api.ts";

export interface PierWindowAPI {
  agentAssets: PierAgentAssetsAPI;
  agentRuntimeIndex: PierAgentRuntimeIndexAPI;
  agents: PierAgentsAPI;
  ai: PierAiAPI;
  app: AppPreloadApi;
  appCli: AppCliPreloadApi;
  appQuit: PierAppQuitAPI;
  appUpdate: AppUpdatePreloadApi;
  canvasHost: PierCanvasHostAPI;
  catalog: PierHostCatalogAPI;
  clipboard: PierClipboardAPI;
  closeWindow: (windowId: string) => Promise<void>;
  commandPalette: PierCommandPaletteAPI;
  commandPaletteMru: PierCommandPaletteMruAPI;
  comments: PierCommentsAPI;
  createWindow: () => Promise<WindowCreateResult>;
  diagnostics: PierDiagnosticsAPI;
  env: PierEnvAPI;
  environments: PierEnvironmentsAPI;
  externalNavigation: PierExternalNavigationApi;
  filePreviews: PierFilePreviewApi;
  fileQuery: PierFileQueryAPI;
  files: PierFilesAPI;
  focusWindow: (windowId: string) => Promise<void>;
  foregroundActivity: PierForegroundActivityAPI;
  git: PierGitAPI;
  htmlPreviews: PierHtmlPreviewApi;
  keybinding: PierKeybindingAPI;
  listWindows: () => Promise<WindowInfo[]>;
  liveModules: PierLiveModulesAPI;
  lsp: PierLspAPI;
  managedPlugins: ManagedPluginsPreloadApi;
  mediaPreviews: PierMediaPreviewApi;
  menu: PierMenuAPI;
  notificationCenter: PierNotificationCenterAPI;
  notifications: PierNotificationsAPI;
  panels: PierPanelsAPI;
  panelTransfer: PierPanelTransferAPI;
  pierBindings: PierPierBindingsAPI;
  pierHomeSkills: PierHomeSkillsAPI;
  pluginRpc: PluginRpcPreloadApi;
  pluginSettings: PierPluginSettingsAPI;
  plugins: PierPluginsAPI;
  preferences: PierPreferencesAPI;
  projectSkills: PierProjectSkillsAPI;
  rendererCommand: PierRendererCommandAPI;
  resources: PierResourceAPI;
  settings: PierSettingsAPI;
  shellEnvironment: PierShellEnvironmentAPI;
  tasks: PierTasksAPI;
  terminal: TerminalAPI;
  terminalStatusBarPrefs: PierTerminalStatusBarPrefsAPI;
  terminals: PierTerminalsAPI;
  theme: PierThemeAPI;
  usageData: PierUsageDataAPI;
  window: PierWindowNsAPI;
  workspace: PierWorkspaceAPI;
  worktrees: PierWorktreesAPI;
}

const agentsApi: PierAgentsAPI = {
  lifecycle: {
    cancel: (agentId) =>
      ipcRenderer.invoke("pier:agents:lifecycle:cancel", { agentId }),
    onProgress: (cb) =>
      subscribeIpc(PIER_BROADCAST.AGENT_LIFECYCLE_PROGRESS, cb),
    run: (agentId, action) =>
      ipcRenderer.invoke("pier:agents:lifecycle:run", { agentId, action }),
    runMany: (agentIds, action) =>
      ipcRenderer.invoke("pier:agents:lifecycle:runMany", {
        agentIds,
        action,
      }),
  },
  prepareLaunch: (agentId: AgentKind) =>
    ipcRenderer.invoke("pier:agents:prepareLaunch", agentId),
  prepareLaunchFromSpec: (spec) =>
    ipcRenderer.invoke("pier:agents:prepareLaunchFromSpec", spec),
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

const shellEnvironmentApi: PierShellEnvironmentAPI = {
  refresh: () =>
    invokePierCommand<ShellEnvironmentHostStatus>({
      type: "shellEnvironment.refresh",
    }),
  status: () =>
    invokePierCommand<ShellEnvironmentHostStatus>({
      type: "shellEnvironment.status",
    }),
};

const themeApi: PierThemeAPI = {
  onVisualPreview: (cb) =>
    subscribeIpc(PIER_BROADCAST.THEME_VISUAL_PREVIEW, cb),
  previewVisual: (payload) =>
    ipcRenderer.invoke(PIER.THEME_PREVIEW_VISUAL, payload),
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
const htmlPreviewApi = createHtmlPreviewApi({
  invokeIssue: (request) =>
    ipcRenderer.invoke(PIER.HTML_PREVIEW_TICKET_ISSUE, request),
  invokeRelease: (request) =>
    ipcRenderer.invoke(PIER.HTML_PREVIEW_TICKET_RELEASE, request),
  invokeTouch: (request) =>
    ipcRenderer.invoke(PIER.HTML_PREVIEW_TICKET_TOUCH, request),
});

// gitApi / pluginSettingsApi 实现在独立文件(避免 preload/index.ts 超 500 行硬上限)。

const menuApi: PierMenuAPI = {
  popup: (template, options) =>
    ipcRenderer.invoke("pier:menu:popup", template, options),
};

const clipboardApi: PierClipboardAPI = {
  writeText: (text) => ipcRenderer.invoke("pier:clipboard:writeText", text),
  beginImageSuppress: () =>
    ipcRenderer.invoke("pier:clipboard:beginImageSuppress"),
  endImageSuppress: () => ipcRenderer.invoke("pier:clipboard:endImageSuppress"),
};

const settingsApi: PierSettingsAPI = {
  onOpenRequest: (cb) => subscribeIpc(PIER_BROADCAST.SETTINGS_OPEN_REQUEST, cb),
};

const keybindingApi: PierKeybindingAPI = {
  onForward: (cb) => subscribeIpc("pier:keybinding:forward", cb),
  onModifierState: (cb) => subscribeIpc("pier:keybinding:modifier-state", cb),
};

const mediaPreviewApi = createMediaPreviewApi({
  invokeIssue: (request) =>
    ipcRenderer.invoke(PIER.MEDIA_PREVIEW_ABSOLUTE_ISSUE, request),
  invokeRelease: (request) =>
    ipcRenderer.invoke(PIER.MEDIA_PREVIEW_ABSOLUTE_RELEASE, request),
});

const api: PierWindowAPI = {
  agents: agentsApi,
  agentAssets: agentAssetsApi,
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
  lsp: lspApi,
  environments: environmentsApi,
  externalNavigation: externalNavigationApi,
  filePreviews: filePreviewApi,
  git: gitApi,
  htmlPreviews: htmlPreviewApi,
  keybinding: keybindingApi,
  listWindows: () => invokePierCommand<WindowInfo[]>({ type: "window.list" }),
  liveModules: liveModulesApi,
  menu: menuApi,
  clipboard: clipboardApi,
  notifications: notificationsApi,
  notificationCenter: notificationCenterApi,
  catalog: hostCatalogApi,
  canvasHost: canvasHostApi,
  comments: commentsApi,
  diagnostics: diagnosticsApi,
  plugins: pluginsApi,
  pluginSettings: pluginSettingsApi,
  preferences: preferencesApi,
  shellEnvironment: shellEnvironmentApi,
  projectSkills: projectSkillsApi,
  pierHomeSkills: pierHomeSkillsApi,
  pierBindings: pierBindingsApi,
  rendererCommand: rendererCommandApi,
  settings: settingsApi,
  resources: pierResourceApi,
  tasks: tasksApi,
  terminal: terminalApi,
  terminals: terminalsApi,
  terminalStatusBarPrefs: terminalStatusBarPrefsApi,
  usageData: usageDataApi,
  managedPlugins: createManagedPluginsPreloadApi(),
  mediaPreviews: mediaPreviewApi,
  panels: panelsApi,
  panelTransfer: createPanelTransferApi(),
  pluginRpc: createPluginRpcPreloadApi(),
  app: createAppPreloadApi(),
  appCli: createAppCliPreloadApi(),
  appUpdate: createAppUpdatePreloadApi(),
  theme: themeApi,
  window: createWindowApi(signalRendererBoot),
  workspace: workspaceApi,
  worktrees: worktreesApi,
};

contextBridge.exposeInMainWorld("pier", api);
