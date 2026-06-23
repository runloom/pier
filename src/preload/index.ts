import type {
  MenuPopupOptions,
  MenuPopupResult,
  MenuTemplate,
} from "@shared/contracts/menu.ts";
import type { TerminalAPI } from "@shared/contracts/terminal.ts";
import { contextBridge, ipcRenderer } from "electron";

export interface WindowInfo {
  focused: boolean;
  id: string;
}

interface PreferencesSnapshot {
  language: string;
  monoFontFamily: string;
  stylePresetId: string;
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
  clearLayout: () => Promise<void>;
  loadLayout: () => Promise<unknown | null>;
  saveLayout: (layout: unknown) => Promise<void>;
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

export interface PierWindowAPI {
  closeCurrentWindow: () => Promise<void>;
  closeWindow: (windowId: string) => Promise<void>;
  createWindow: () => Promise<{ windowId: string }>;
  focusWindow: (windowId: string) => Promise<void>;
  keybinding: PierKeybindingAPI;
  listWindows: () => Promise<WindowInfo[]>;
  menu: PierMenuAPI;
  platform: NodeJS.Platform;
  preferences: PierPreferencesAPI;
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
  hide: (panelId) => ipcRenderer.send("pier:terminal:hide", panelId),
  onContextMenuRequest: (cb) =>
    subscribeIpc("pier:terminal:request-context-menu", cb),
  onCwdChange: (cb) => subscribeIpc("pier:terminal:cwd-change", cb),
  onTitleChange: (cb) => subscribeIpc("pier:terminal:title-change", cb),
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

const menuApi: PierMenuAPI = {
  popup: (template, options) =>
    ipcRenderer.invoke("pier:menu:popup", template, options),
};

const keybindingApi: PierKeybindingAPI = {
  onForward: (cb) => subscribeIpc("pier:keybinding:forward", cb),
};

const api: PierWindowAPI = {
  closeCurrentWindow: () => ipcRenderer.invoke("pier://window:close-current"),
  closeWindow: (windowId) =>
    ipcRenderer.invoke("pier://window:close", windowId),
  createWindow: () => ipcRenderer.invoke("pier://window:create"),
  focusWindow: (windowId) =>
    ipcRenderer.invoke("pier://window:focus", windowId),
  keybinding: keybindingApi,
  listWindows: () => ipcRenderer.invoke("pier://window:list"),
  menu: menuApi,
  platform: process.platform,
  preferences: preferencesApi,
  terminal: terminalApi,
  theme: themeApi,
  workspace: workspaceApi,
};

contextBridge.exposeInMainWorld("pier", api);
