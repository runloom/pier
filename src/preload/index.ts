import type { MruState } from "@shared/contracts/command-palette-mru.ts";
import type {
  MenuPopupOptions,
  MenuPopupResult,
  MenuTemplate,
} from "@shared/contracts/menu.ts";
import type {
  RendererCommandEnvelope,
  RendererCommandResult,
} from "@shared/contracts/renderer-command.ts";
import {
  RENDERER_COMMAND_CHANNEL,
  RENDERER_COMMAND_RESULT_CHANNEL,
} from "@shared/contracts/renderer-command-channels.ts";
import type { TerminalAPI } from "@shared/contracts/terminal.ts";
import type {
  WindowContext,
  WindowCreateResult,
} from "@shared/contracts/window.ts";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { contextBridge, ipcRenderer } from "electron";

export interface WindowInfo {
  focused: boolean;
  id: string;
  recordId: string;
}

interface PreferencesSnapshot {
  language: string;
  monoFontFamily: string;
  monoFontSize: number;
  stylePresetId: string;
  terminalCursorBlink: boolean;
  terminalCursorStyle: "block" | "bar" | "underline";
  terminalNewCwdPolicy: "activeTerminal" | "shellDefault";
  terminalPasteProtection: boolean;
  terminalScrollbackMb: number;
  theme: string;
  uiFontFamily: string;
}

export interface PierPreferencesAPI {
  /**
   * 订阅其他窗口对 preferences 的修改 — main 端 update 后会广播给除 sender 外
   * 的所有 BrowserWindow. 调用方在 sender 自己的 setter 里已经 await + 同步
   * 应用过, 不会收到自己的广播.
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

/**
 * Keyboard chord forward: swift NSEvent monitor 捕获 Cmd+key → main IPC →
 * 这里 dispatch 到 renderer 侧的 listener (shell-keybindings).
 */
export interface PierKeybindingAPI {
  onForward: (
    cb: (chord: { modifierFlags: number; chars: string }) => void
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

export interface WindowLayoutPulse {
  reason: "resize" | "zoom";
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
  preferences: PierPreferencesAPI;
  readyToShow: () => void;
  rendererCommand: PierRendererCommandAPI;
  settings: PierSettingsAPI;
  terminal: TerminalAPI;
  theme: PierThemeAPI;
  workspace: PierWorkspaceAPI;
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

const preferencesApi: PierPreferencesAPI = {
  onChanged: (cb) => subscribeIpc("pier:preferences:changed", cb),
  read: () => ipcRenderer.invoke("pier:preferences:read"),
  update: (patch) => ipcRenderer.invoke("pier:preferences:update", patch),
};

const terminalApi: TerminalAPI = {
  applyTheme: (colors) => ipcRenderer.send("pier:terminal:apply-theme", colors),
  close: (panelId) => ipcRenderer.send("pier:terminal:close", panelId),
  create: (args) => ipcRenderer.invoke("pier:terminal:create", args),
  focus: (panelId) => ipcRenderer.send("pier:terminal:focus", panelId),
  focusSession: (args) =>
    ipcRenderer.invoke("pier:terminal:focus-session", args),
  hide: (panelId) => ipcRenderer.send("pier:terminal:hide", panelId),
  listSessions: (args) =>
    ipcRenderer.invoke("pier:terminal:list-sessions", args),
  reconcile: (activeIds) =>
    ipcRenderer.send("pier:terminal:reconcile", activeIds),
  onContextMenuRequest: (cb) =>
    subscribeIpc("pier:terminal:request-context-menu", cb),
  onCwdChange: (cb) => subscribeIpc("pier:terminal:cwd-change", cb),
  onFocusRequest: (cb) => subscribeIpc("pier:terminal:focus-request", cb),
  onTitleChange: (cb) => subscribeIpc("pier:terminal:title-change", cb),
  openSession: (args) => ipcRenderer.invoke("pier:terminal:open-session", args),
  performOperation: (panelId, operation) =>
    ipcRenderer.invoke("pier:terminal:perform-operation", panelId, operation),
  readSession: (panelId) =>
    ipcRenderer.invoke("pier:terminal:read-session", panelId),
  setActivePanelKind: (kind, panelId) =>
    ipcRenderer.send("pier:terminal:set-active-panel-kind", kind, panelId),
  setConfig: (config) => ipcRenderer.send("pier:terminal:set-config", config),
  setFont: (panelId, font) =>
    ipcRenderer.send("pier:terminal:set-font", panelId, font),
  setFrame: (panelId, frame) =>
    ipcRenderer.send("pier:terminal:set-frame", panelId, frame),
  setOverlayActive: (active) =>
    ipcRenderer.send("pier:terminal:set-overlay", active),
  // ↑ preload 不带 windowId, main 端用 event.sender 自动找 BrowserWindow.
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

const menuApi: PierMenuAPI = {
  popup: (template, options) =>
    ipcRenderer.invoke("pier:menu:popup", template, options),
};

const settingsApi: PierSettingsAPI = {
  onOpenRequest: (cb) => subscribeIpc(PIER_BROADCAST.SETTINGS_OPEN_REQUEST, cb),
};

const keybindingApi: PierKeybindingAPI = {
  onForward: (cb) => subscribeIpc("pier:keybinding:forward", cb),
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
  preferences: preferencesApi,
  readyToShow: () => ipcRenderer.send(PIER.WINDOW_RENDERER_READY),
  rendererCommand: rendererCommandApi,
  settings: settingsApi,
  terminal: terminalApi,
  theme: themeApi,
  workspace: workspaceApi,
};

contextBridge.exposeInMainWorld("pier", api);
