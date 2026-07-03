import type {
  TerminalOperationResult,
  TerminalSearchDirection,
} from "@shared/contracts/terminal.ts";
import type { IpcMain, WebContents } from "electron";
import type { AppWindow } from "../windows/app-window.ts";
import { recordNativeTerminalRoute } from "./terminal-debug.ts";
import { forwardToWindow } from "./terminal-forwarding.ts";
import type { NativeAddon } from "./terminal-native-addon.ts";
import { fromNativePanelKey, toNativePanelKey } from "./terminal-panel-id.ts";

const MAX_TERMINAL_SEARCH_QUERY_LENGTH = 512;

function isValidPanelId(panelId: unknown): panelId is string {
  return typeof panelId === "string" && panelId.length > 0;
}

function terminalBindingResult(
  opts: {
    addon: NativeAddon | null;
    loadError: string | null;
    panelId: unknown;
    win: AppWindow | null;
  },
  action: string
): TerminalOperationResult {
  if (!opts.addon) {
    return { ok: false, error: opts.loadError ?? "native addon not loaded" };
  }
  if (!isValidPanelId(opts.panelId)) {
    return { ok: false, error: "invalid panel id" };
  }
  if (!opts.win) {
    return { ok: false, error: "window not found" };
  }
  try {
    const ok = opts.addon.performTerminalBindingAction(
      toNativePanelKey(opts.win, opts.panelId),
      action
    );
    return ok
      ? { ok: true }
      : { ok: false, error: "terminal operation failed" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function isValidSearchQuery(query: unknown): query is string {
  return (
    typeof query === "string" &&
    query.length <= MAX_TERMINAL_SEARCH_QUERY_LENGTH &&
    !query.includes("\0")
  );
}

function isSearchDirection(value: unknown): value is TerminalSearchDirection {
  return value === "next" || value === "previous";
}

export function performTerminalSearch(opts: {
  addon: NativeAddon | null;
  loadError: string | null;
  panelId: unknown;
  query: unknown;
  win: AppWindow | null;
}): TerminalOperationResult {
  if (!isValidSearchQuery(opts.query)) {
    return { ok: false, error: "invalid search query" };
  }
  return terminalBindingResult(
    opts,
    opts.query === "" ? "end_search" : `search:${opts.query}`
  );
}

export function navigateTerminalSearch(opts: {
  addon: NativeAddon | null;
  direction: unknown;
  loadError: string | null;
  panelId: unknown;
  win: AppWindow | null;
}): TerminalOperationResult {
  if (!isSearchDirection(opts.direction)) {
    return { ok: false, error: "invalid search direction" };
  }
  return terminalBindingResult(opts, `navigate_search:${opts.direction}`);
}

export function endTerminalSearch(opts: {
  addon: NativeAddon | null;
  loadError: string | null;
  panelId: unknown;
  win: AppWindow | null;
}): TerminalOperationResult {
  return terminalBindingResult(opts, "end_search");
}

export function registerTerminalSearchIpc(opts: {
  addon: NativeAddon | null;
  ipcMain: IpcMain;
  loadError: string | null;
  windowFromWebContents(webContents: WebContents): AppWindow | null;
}): void {
  const { addon, ipcMain, loadError, windowFromWebContents } = opts;

  addon?.setSearchForwardCallback?.((id, panelId, total, selected) => {
    recordNativeTerminalRoute(id, "search-state", panelId, { selected, total });
    forwardToWindow(
      id,
      "pier:terminal:search-state",
      { panelId: fromNativePanelKey(panelId), selected, total },
      "pier-search-forward"
    );
  });

  ipcMain.handle(
    "pier:terminal:search",
    async (event, panelId: unknown, query: unknown) =>
      performTerminalSearch({
        addon,
        loadError,
        panelId,
        query,
        win: windowFromWebContents(event.sender),
      })
  );

  ipcMain.handle(
    "pier:terminal:navigate-search",
    async (event, panelId: unknown, direction: unknown) =>
      navigateTerminalSearch({
        addon,
        direction,
        loadError,
        panelId,
        win: windowFromWebContents(event.sender),
      })
  );

  ipcMain.handle("pier:terminal:end-search", async (event, panelId: unknown) =>
    endTerminalSearch({
      addon,
      loadError,
      panelId,
      win: windowFromWebContents(event.sender),
    })
  );
}
