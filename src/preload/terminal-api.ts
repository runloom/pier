import type { TerminalAPI } from "@shared/contracts/terminal.ts";
import type {
  TerminalDebugRendererSnapshotRequest,
  TerminalDebugRendererSnapshotResult,
} from "@shared/contracts/terminal-debug.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { ipcRenderer } from "electron";
import { subscribeIpc } from "./ipc-envelope.ts";

/**
 * TerminalAPI 单独抽出（原 index.ts 超硬性文件大小上限）。
 * TerminalAPI 契约本身住在 shared/contracts/terminal.ts；这里只是把
 * ipcRenderer 绑定实现落地。renderer 端仍走 window.pier.terminal.*.
 */
export const terminalApi: TerminalAPI = {
  applyHostSnapshot: (snapshot) =>
    ipcRenderer.send("pier:terminal:apply-host-snapshot", snapshot),
  applyTheme: (colors) => ipcRenderer.send("pier:terminal:apply-theme", colors),
  close: (panelId, options) =>
    ipcRenderer
      .invoke("pier:terminal:close", panelId, options)
      .then(() => undefined),
  create: (args) => ipcRenderer.invoke("pier:terminal:create", args),
  debugSnapshot: (args) =>
    ipcRenderer.invoke("pier:terminal:debug-snapshot", args),
  endSearch: (panelId) =>
    ipcRenderer.invoke("pier:terminal:end-search", panelId),
  navigateSearch: (panelId, direction) =>
    ipcRenderer.invoke("pier:terminal:navigate-search", panelId, direction),
  reconcile: (activeIds) =>
    ipcRenderer.send("pier:terminal:reconcile", activeIds),
  onContextMenuRequest: (cb) =>
    subscribeIpc("pier:terminal:request-context-menu", cb),
  onCwdChange: (cb) => subscribeIpc(PIER_BROADCAST.TERMINAL_CWD_CHANGED, cb),
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
  onTitleChange: (cb) =>
    subscribeIpc(PIER_BROADCAST.TERMINAL_TITLE_CHANGED, cb),
  openDebugWindow: () => ipcRenderer.invoke("pier:terminal-debug:open-window"),
  performOperation: (panelId, operation) =>
    ipcRenderer.invoke("pier:terminal:perform-operation", panelId, operation),
  readSelectionText: (panelId) =>
    ipcRenderer.invoke("pier:terminal:read-selection-text", panelId),
  readSession: (panelId) =>
    ipcRenderer.invoke("pier:terminal:read-session", panelId),
  rebindTaskOutput: (panelId, params) =>
    ipcRenderer.invoke("pier:terminal:rebind-task-output", panelId, params),
  search: (panelId, query) =>
    ipcRenderer.invoke("pier:terminal:search", panelId, query),
  setAppShortcutKeys: (keys) =>
    ipcRenderer.send("pier:terminal:set-app-shortcut-keys", keys),
  setConfig: (config) => ipcRenderer.send("pier:terminal:set-config", config),
  setFont: (panelId, font) =>
    ipcRenderer.send("pier:terminal:set-font", panelId, font),
  setup: () => ipcRenderer.invoke("pier:terminal:setup"),
  onPresentationApplied: (cb) =>
    subscribeIpc(PIER_BROADCAST.TERMINAL_PRESENTATION_APPLIED, cb),
};
