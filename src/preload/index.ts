import type { MruState } from "@shared/contracts/command-palette-mru.ts";
import type {
  PierCommand,
  PierCommandErrorCode,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type {
  MenuPopupOptions,
  MenuPopupResult,
  MenuTemplate,
} from "@shared/contracts/menu.ts";
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
import type {
  TerminalAPI,
  TerminalDebugRendererSnapshotRequest,
  TerminalDebugRendererSnapshotResult,
} from "@shared/contracts/terminal.ts";
import type {
  WindowContext,
  WindowCreateResult,
} from "@shared/contracts/window.ts";
import type { WindowLayoutPulse } from "@shared/contracts/window-layout.ts";
import type {
  WorktreeCheckRequest,
  WorktreeCheckResult,
  WorktreeListRequest,
  WorktreeListResult,
  WorktreeOpenRequest,
} from "@shared/contracts/worktree.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { contextBridge, ipcRenderer } from "electron";

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
}

export interface PierWorktreesAPI {
  check: (request: WorktreeCheckRequest) => Promise<WorktreeCheckResult>;
  list: (request: WorktreeListRequest) => Promise<WorktreeListResult>;
  open: (request: WorktreeOpenRequest) => Promise<unknown>;
}

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

export interface PierSettingsAPI {
  onOpenRequest: (cb: () => void) => () => void;
}

export interface PierTasksAPI {
  cancel: (args: { runId: string }) => Promise<TaskRunSnapshot>;
  list: (args: { projectRoot: string }) => Promise<TaskListResult>;
  spawn: (args: {
    focus?: boolean;
    inputs?: Record<string, string>;
    placement?:
      | "active-tab"
      | "split-right"
      | "split-below"
      | "split-left"
      | "split-above";
    projectRoot: string;
    taskId: string;
  }) => Promise<TaskSpawnResult>;
  status: (args: { runId: string }) => Promise<TaskRunSnapshot>;
}

export interface PierWindowAPI {
  closeCurrentWindow: () => Promise<void>;
  closeWindow: (windowId: string) => Promise<void>;
  commandPalette: PierCommandPaletteAPI;
  commandPaletteMru: PierCommandPaletteMruAPI;
  createWindow: () => Promise<WindowCreateResult>;
  focusWindow: (windowId: string) => Promise<void>;
  getWindowContext: () => Promise<WindowContext>;
  keybinding: PierKeybindingAPI;
  listWindows: () => Promise<WindowInfo[]>;
  menu: PierMenuAPI;
  onWindowLayoutPulse: (cb: (pulse: WindowLayoutPulse) => void) => () => void;
  platform: NodeJS.Platform;
  plugins: PierPluginsAPI;
  preferences: PierPreferencesAPI;
  readyToShow: () => void;
  rendererCommand: PierRendererCommandAPI;
  settings: PierSettingsAPI;
  tasks: PierTasksAPI;
  terminal: TerminalAPI;
  theme: PierThemeAPI;
  workspace: PierWorkspaceAPI;
  worktrees: PierWorktreesAPI;
}

/**
 * 订阅 main → renderer IPC 事件, 返回 dispose 函数.
 *
 * 所有 forward 类 API (keybinding.onForward / terminal.onCwdChange /
 * onTitleChange / onContextMenuRequest / preferences.onChanged) 共用此模板.
 * 加新订阅:一行 (channel, cb).
 */
function subscribeIpc<P>(
  channel: string,
  cb: (payload: P) => void
): () => void {
  const listener = (_event: unknown, payload: P): void => {
    cb(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.off(channel, listener);
  };
}

async function invokePierCommand<T>(command: PierCommand): Promise<T> {
  const result = (await ipcRenderer.invoke(
    PIER.COMMAND_EXECUTE,
    command
  )) as PierCommandResult;
  if (result.ok) {
    return result.data as T;
  }
  const error = new Error(result.error.message) as Error & {
    code?: PierCommandErrorCode;
  };
  error.code = result.error.code;
  throw error;
}

const preferencesApi: PierPreferencesAPI = {
  onChanged: (cb) => subscribeIpc(PIER_BROADCAST.PREFERENCES_CHANGED, cb),
  read: () => ipcRenderer.invoke("pier:preferences:read"),
  update: (patch) => ipcRenderer.invoke("pier:preferences:update", patch),
};

const terminalApi: TerminalAPI = {
  applyInputRouting: (snapshot) =>
    ipcRenderer.send("pier:terminal:apply-input-routing", snapshot),
  applyPresentation: (snapshot) =>
    ipcRenderer.send("pier:terminal:apply-presentation", snapshot),
  applyTheme: (colors) => ipcRenderer.send("pier:terminal:apply-theme", colors),
  close: (panelId) => ipcRenderer.send("pier:terminal:close", panelId),
  create: (args) => ipcRenderer.invoke("pier:terminal:create", args),
  debugSnapshot: (args) =>
    ipcRenderer.invoke("pier:terminal:debug-snapshot", args),
  endSearch: (panelId) =>
    ipcRenderer.invoke("pier:terminal:end-search", panelId),
  hide: (panelId) => ipcRenderer.send("pier:terminal:hide", panelId),
  navigateSearch: (panelId, direction) =>
    ipcRenderer.invoke("pier:terminal:navigate-search", panelId, direction),
  reconcile: (activeIds) =>
    ipcRenderer.send("pier:terminal:reconcile", activeIds),
  onContextMenuRequest: (cb) =>
    subscribeIpc("pier:terminal:request-context-menu", cb),
  onCwdChange: (cb) => subscribeIpc("pier:terminal:cwd-change", cb),
  onDebugRendererSnapshotRequest: (cb) => {
    const listener = async (
      _event: unknown,
      req: TerminalDebugRendererSnapshotRequest
    ) => {
      const result: TerminalDebugRendererSnapshotResult = {
        ok: false,
        requestId: req.requestId,
      };
      try {
        result.renderer = await cb(req);
        result.ok = true;
      } catch (err) {
        result.error = err instanceof Error ? err.message : String(err);
      }
      ipcRenderer.send("pier:terminal-debug:renderer-snapshot-result", result);
    };
    ipcRenderer.on("pier:terminal-debug:collect-renderer-snapshot", listener);
    return () => {
      ipcRenderer.off(
        "pier:terminal-debug:collect-renderer-snapshot",
        listener
      );
    };
  },
  onFocusRequest: (cb) => subscribeIpc("pier:terminal:focus-request", cb),
  onSearchOpenRequest: (cb) =>
    subscribeIpc(PIER_BROADCAST.TERMINAL_SEARCH_OPEN_REQUEST, cb),
  onSearchState: (cb) => subscribeIpc("pier:terminal:search-state", cb),
  onTabChromePatch: (cb) => subscribeIpc("pier:terminal:tab-chrome-patch", cb),
  onTitleChange: (cb) => subscribeIpc("pier:terminal:title-change", cb),
  openDebugWindow: () => ipcRenderer.invoke("pier:terminal-debug:open-window"),
  performOperation: (panelId, operation) =>
    ipcRenderer.invoke("pier:terminal:perform-operation", panelId, operation),
  readSession: (panelId) =>
    ipcRenderer.invoke("pier:terminal:read-session", panelId),
  search: (panelId, query) =>
    ipcRenderer.invoke("pier:terminal:search", panelId, query),
  setAppShortcutKeys: (keys) =>
    ipcRenderer.send("pier:terminal:set-app-shortcut-keys", keys),
  setConfig: (config) => ipcRenderer.send("pier:terminal:set-config", config),
  setFont: (panelId, font) =>
    ipcRenderer.send("pier:terminal:set-font", panelId, font),
  setFrame: (panelId, frame) =>
    ipcRenderer.send("pier:terminal:set-frame", panelId, frame),
  setup: () => ipcRenderer.invoke("pier:terminal:setup"),
  show: (panelId) => ipcRenderer.send("pier:terminal:show", panelId),
};

const themeApi: PierThemeAPI = {
  setNativeChrome: (resolved, chromeColor) =>
    ipcRenderer.invoke("pier:theme:set-native-chrome", resolved, chromeColor),
};

const workspaceApi: PierWorkspaceAPI = {
  clearLayout: (recordId) =>
    ipcRenderer.invoke("pier:workspace:clear-layout", recordId),
  loadLayout: (recordId) =>
    ipcRenderer.invoke("pier:workspace:load-layout", recordId),
  onNewTerminalRequest: (cb) =>
    subscribeIpc(PIER_BROADCAST.NEW_TERMINAL_REQUEST, cb),
  saveLayout: (layout, recordId) =>
    ipcRenderer.invoke("pier:workspace:save-layout", layout, recordId),
};

const rendererCommandApi: PierRendererCommandAPI = {
  onCommand: (cb) => subscribeIpc(RENDERER_COMMAND_CHANNEL, cb),
  resolve: (result) =>
    ipcRenderer.send(RENDERER_COMMAND_RESULT_CHANNEL, result),
};

const commandPaletteMruApi: PierCommandPaletteMruAPI = {
  read: () => ipcRenderer.invoke("pier:command-palette-mru:read"),
  recordUse: (actionId) =>
    ipcRenderer.send("pier:command-palette-mru:record", actionId),
  clear: () => ipcRenderer.invoke("pier:command-palette-mru:clear"),
  onChange: (handler) => {
    const listener = (_event: unknown, state: MruState) => {
      handler(state);
    };
    ipcRenderer.on("pier:command-palette-mru:changed", listener);
    return () => {
      ipcRenderer.off("pier:command-palette-mru:changed", listener);
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
};

const worktreesApi: PierWorktreesAPI = {
  check: (request) =>
    invokePierCommand<WorktreeCheckResult>({
      path: request.path,
      type: "worktree.check",
    }),
  list: (request) =>
    invokePierCommand<WorktreeListResult>({
      path: request.path,
      type: "worktree.list",
    }),
  open: (request) =>
    invokePierCommand<unknown>({
      path: request.path,
      type: "worktree.open",
    }),
};

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
      projectRoot: args.projectRoot,
      type: "run.list",
    }),
  spawn: (args) =>
    invokePierCommand<TaskSpawnResult>({
      ...(args.focus === undefined ? {} : { focus: args.focus }),
      ...(args.inputs ? { inputs: args.inputs } : {}),
      ...(args.placement ? { placement: args.placement } : {}),
      projectRoot: args.projectRoot,
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
  closeCurrentWindow: () => ipcRenderer.invoke("pier://window:close-current"),
  closeWindow: (windowId) =>
    ipcRenderer.invoke("pier://window:close", windowId),
  commandPalette: commandPaletteApi,
  commandPaletteMru: commandPaletteMruApi,
  createWindow: () => ipcRenderer.invoke("pier://window:create"),
  focusWindow: (windowId) =>
    ipcRenderer.invoke("pier://window:focus", windowId),
  getWindowContext: () => ipcRenderer.invoke("pier://window:context"),
  keybinding: keybindingApi,
  listWindows: () => ipcRenderer.invoke("pier://window:list"),
  menu: menuApi,
  onWindowLayoutPulse: (cb) =>
    subscribeIpc(PIER_BROADCAST.WINDOW_LAYOUT_PULSE, cb),
  platform: process.platform,
  plugins: pluginsApi,
  preferences: preferencesApi,
  readyToShow: () => ipcRenderer.send(PIER.WINDOW_RENDERER_READY),
  rendererCommand: rendererCommandApi,
  settings: settingsApi,
  tasks: tasksApi,
  terminal: terminalApi,
  theme: themeApi,
  workspace: workspaceApi,
  worktrees: worktreesApi,
};

contextBridge.exposeInMainWorld("pier", api);
