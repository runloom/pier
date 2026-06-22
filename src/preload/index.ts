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
  setNativeChrome: (resolved: "light" | "dark") => Promise<void>;
}

export interface PierWindowAPI {
  closeCurrentWindow: () => Promise<void>;
  closeWindow: (windowId: string) => Promise<void>;
  createWindow: () => Promise<{ windowId: string }>;
  focusWindow: (windowId: string) => Promise<void>;
  listWindows: () => Promise<WindowInfo[]>;
  platform: NodeJS.Platform;
  preferences: PierPreferencesAPI;
  theme: PierThemeAPI;
}

const preferencesApi: PierPreferencesAPI = {
  read: () => ipcRenderer.invoke("pier:preferences:read"),
  update: (patch) => ipcRenderer.invoke("pier:preferences:update", patch),
};

const themeApi: PierThemeAPI = {
  setNativeChrome: (resolved) =>
    ipcRenderer.invoke("pier:theme:set-native-chrome", resolved),
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
  theme: themeApi,
};

contextBridge.exposeInMainWorld("pier", api);
