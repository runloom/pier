import type { MruState } from "@shared/contracts/command-palette-mru.ts";
import type { TerminalAPI } from "@shared/contracts/terminal.ts";
import { contextBridge, ipcRenderer } from "electron";

export interface WindowInfo {
  focused: boolean;
  id: string;
}

export interface PierPreferencesAPI {
  read: () => Promise<{
    theme: string;
    stylePresetId: string;
    language: string;
    uiFontFamily: string;
    monoFontFamily: string;
  }>;
  update: (
    patch: Partial<{
      theme: string;
      stylePresetId: string;
      language: string;
      uiFontFamily: string;
      monoFontFamily: string;
    }>
  ) => Promise<{
    theme: string;
    stylePresetId: string;
    language: string;
    uiFontFamily: string;
    monoFontFamily: string;
  }>;
}

export interface PierThemeAPI {
  setNativeChrome: (
    resolved: "light" | "dark",
    chromeColor?: string
  ) => Promise<void>;
}

export interface PierWorkspaceAPI {
  clearLayout: () => Promise<void>;
  loadLayout: () => Promise<unknown | null>;
  saveLayout: (layout: unknown) => Promise<void>;
}

export interface PierCommandPaletteMruAPI {
  clear: () => Promise<MruState>;
  /** 订阅 changed 广播, 返回解绑函数 */
  onChange: (handler: (state: MruState) => void) => () => void;
  read: () => Promise<MruState>;
  recordUse: (actionId: string) => void;
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

export interface PierWindowAPI {
  closeCurrentWindow: () => Promise<void>;
  closeWindow: (windowId: string) => Promise<void>;
  commandPaletteMru: PierCommandPaletteMruAPI;
  createWindow: () => Promise<{ windowId: string }>;
  focusWindow: (windowId: string) => Promise<void>;
  keybinding: PierKeybindingAPI;
  listWindows: () => Promise<WindowInfo[]>;
  platform: NodeJS.Platform;
  preferences: PierPreferencesAPI;
  terminal: TerminalAPI;
  theme: PierThemeAPI;
  workspace: PierWorkspaceAPI;
}

const preferencesApi: PierPreferencesAPI = {
  read: () => ipcRenderer.invoke("pier:preferences:read"),
  update: (patch) => ipcRenderer.invoke("pier:preferences:update", patch),
};

const terminalApi: TerminalAPI = {
  close: (panelId) => ipcRenderer.invoke("pier:terminal:close", panelId),
  create: (args) => ipcRenderer.invoke("pier:terminal:create", args),
  focus: (panelId) => ipcRenderer.send("pier:terminal:focus", panelId),
  hide: (panelId) => ipcRenderer.send("pier:terminal:hide", panelId),
  setActivePanelKind: (kind, panelId) =>
    ipcRenderer.send("pier:terminal:set-active-panel-kind", kind, panelId),
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
  clearLayout: () => ipcRenderer.invoke("pier:workspace:clear-layout"),
  loadLayout: () => ipcRenderer.invoke("pier:workspace:load-layout"),
  saveLayout: (layout) =>
    ipcRenderer.invoke("pier:workspace:save-layout", layout),
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

const keybindingApi: PierKeybindingAPI = {
  onForward: (cb) => {
    const listener = (
      _event: unknown,
      chord: { modifierFlags: number; chars: string }
    ) => {
      cb(chord);
    };
    ipcRenderer.on("pier:keybinding:forward", listener);
    return () => {
      ipcRenderer.off("pier:keybinding:forward", listener);
    };
  },
};

const api: PierWindowAPI = {
  closeCurrentWindow: () => ipcRenderer.invoke("pier://window:close-current"),
  closeWindow: (windowId) =>
    ipcRenderer.invoke("pier://window:close", windowId),
  commandPaletteMru: commandPaletteMruApi,
  createWindow: () => ipcRenderer.invoke("pier://window:create"),
  focusWindow: (windowId) =>
    ipcRenderer.invoke("pier://window:focus", windowId),
  keybinding: keybindingApi,
  listWindows: () => ipcRenderer.invoke("pier://window:list"),
  platform: process.platform,
  preferences: preferencesApi,
  terminal: terminalApi,
  theme: themeApi,
  workspace: workspaceApi,
};

contextBridge.exposeInMainWorld("pier", api);
