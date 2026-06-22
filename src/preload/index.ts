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

export interface PierWindowAPI {
  closeCurrentWindow: () => Promise<void>;
  closeWindow: (windowId: string) => Promise<void>;
  createWindow: () => Promise<{ windowId: string }>;
  focusWindow: (windowId: string) => Promise<void>;
  listWindows: () => Promise<WindowInfo[]>;
  platform: NodeJS.Platform;
  preferences: PierPreferencesAPI;
  terminal: TerminalAPI;
  theme: PierThemeAPI;
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
  setFrame: (panelId, frame) =>
    ipcRenderer.send("pier:terminal:set-frame", panelId, frame),
  setOverlayActive: (active) =>
    ipcRenderer.send("pier:terminal:set-overlay", active),
  setup: () => ipcRenderer.invoke("pier:terminal:setup"),
  show: (panelId) => ipcRenderer.send("pier:terminal:show", panelId),
};

const themeApi: PierThemeAPI = {
  setNativeChrome: (resolved, chromeColor) =>
    ipcRenderer.invoke("pier:theme:set-native-chrome", resolved, chromeColor),
};

const api: PierWindowAPI = {
  closeCurrentWindow: () => ipcRenderer.invoke("pier://window:close-current"),
  closeWindow: (windowId) =>
    ipcRenderer.invoke("pier://window:close", windowId),
  createWindow: () => ipcRenderer.invoke("pier://window:create"),
  focusWindow: (windowId) =>
    ipcRenderer.invoke("pier://window:focus", windowId),
  listWindows: () => ipcRenderer.invoke("pier://window:list"),
  platform: process.platform,
  preferences: preferencesApi,
  terminal: terminalApi,
  theme: themeApi,
};

contextBridge.exposeInMainWorld("pier", api);
