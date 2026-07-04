import type { WindowInfo } from "@shared/contracts/events.ts";
import type {
  WindowCreateOptions,
  WindowCreateResult,
} from "@shared/contracts/window.ts";
import { flushPanelContextState } from "../state/panel-context-state.ts";
import { flushPluginSettings } from "../state/plugin-settings.ts";
import { flushPluginState } from "../state/plugin-state.ts";
import { flushTerminalSessionState } from "../state/terminal-session-state.ts";
import { flushTerminalStatusBarPrefs } from "../state/terminal-status-bar-prefs.ts";
import {
  createWindowRecord,
  flushWindowRecordState,
  markWindowRecordClosed,
  markWindowRecordFocused,
  markWindowRecordOpen,
  readMostRecentClosedWindowRecordId,
  readPreferredOpenWindowRecordIds,
} from "../state/window-record-state.ts";
import { findWindowContext } from "../windows/window-identity.ts";
import { windowManager } from "../windows/window-manager.ts";

export interface WindowService {
  close(windowId: string): void;
  create(options?: WindowCreateOptions): Promise<WindowCreateResult>;
  flushOpenWindows(): Promise<void>;
  flushWindow(windowId: string): Promise<void>;
  focus(windowId: string): void;
  list(): WindowInfo[];
  restoreMostRecentClosed(): Promise<WindowCreateResult | null>;
  restoreOpenWindows(): Promise<WindowCreateResult[]>;
}

export interface CreateWindowServiceArgs {
  flushRendererLayout?: (windowId: string) => Promise<void>;
}

let didRegisterCloseHandler = false;
let currentFlushRendererLayout: (windowId: string) => Promise<void> =
  async () => undefined;

/**
 * 并发 flush 6 个 debounced store。任何一路失败不能吞其他成功——用 allSettled
 * 保证全部尝试写盘并把 rejection 分别 log，避免旧 Promise.all 语义下靠前 fail
 * 掩盖后面的成功/失败。
 */
async function flushAllStoresSettled(): Promise<void> {
  const flushes: [string, () => Promise<void>][] = [
    ["plugin-state", flushPluginState],
    ["plugin-settings", flushPluginSettings],
    ["panel-context-state", flushPanelContextState],
    ["terminal-session-state", flushTerminalSessionState],
    ["terminal-status-bar-prefs", flushTerminalStatusBarPrefs],
    ["window-record-state", flushWindowRecordState],
  ];
  const results = await Promise.allSettled(flushes.map(([, fn]) => fn()));
  for (const [i, result] of results.entries()) {
    if (result.status === "rejected") {
      const label = flushes[i]?.[0] ?? "unknown";
      const err = result.reason;
      console.error(
        `[${label}] flush failed:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}

async function flushWindowBeforeClose(windowId: string): Promise<void> {
  try {
    await currentFlushRendererLayout(windowId);
  } catch (err) {
    console.error(
      "[window-layout-flush] failed:",
      err instanceof Error ? err.message : String(err)
    );
  }
  await flushAllStoresSettled();
}

function ensureCloseHandler(): void {
  if (didRegisterCloseHandler) {
    return;
  }
  didRegisterCloseHandler = true;
  windowManager.onBeforeClose(({ windowId }) =>
    flushWindowBeforeClose(windowId)
  );
  windowManager.onClose(({ recordId }) => {
    markWindowRecordClosed(recordId).catch((err) => {
      console.error("[window-record-close] failed:", err);
    });
  });
  windowManager.onFocus(({ recordId }) => {
    markWindowRecordFocused(recordId).catch((err) => {
      console.error("[window-record-focus] failed:", err);
    });
  });
}

function nextRuntimeWindowId(): string | undefined {
  return windowManager.getAll().length === 0 ? "main" : undefined;
}

function isWindowRecordOpenInLiveWindow(recordId: string): boolean {
  return windowManager
    .getAll()
    .some((win) => findWindowContext(win)?.recordId === recordId);
}

export function createWindowService(
  args: CreateWindowServiceArgs = {}
): WindowService {
  currentFlushRendererLayout =
    args.flushRendererLayout ?? (async () => undefined);
  ensureCloseHandler();

  async function create(
    options: WindowCreateOptions = {}
  ): Promise<WindowCreateResult> {
    const mode = options.mode ?? "fresh";
    const recordId = (await createWindowRecord()).id;
    return await createFromRecord({ mode, recordId });
  }

  async function createFromRecord(options: {
    mode: "fresh" | "restore";
    recordId: string;
    showInactive?: boolean;
  }): Promise<WindowCreateResult> {
    const { mode, recordId, showInactive } = options;
    if (isWindowRecordOpenInLiveWindow(recordId)) {
      throw new Error(`window record already open: ${recordId}`);
    }
    const runtimeWindowId = nextRuntimeWindowId();
    const windowId = windowManager.create({
      ...(runtimeWindowId ? { id: runtimeWindowId } : {}),
      mode,
      recordId,
      ...(showInactive ? { showInactive: true } : {}),
    });
    await markWindowRecordOpen(recordId);
    return { recordId, windowId };
  }

  return {
    close: (windowId) => windowManager.close(windowId),
    create,
    focus: (windowId) => windowManager.focus(windowId),
    flushOpenWindows: async () => {
      const windows = windowManager.list();
      for (const windowInfo of windows) {
        try {
          await currentFlushRendererLayout(windowInfo.id);
        } catch (err) {
          console.error(
            "[window-layout-flush] failed:",
            err instanceof Error ? err.message : String(err)
          );
        }
      }
      await flushAllStoresSettled();
    },
    flushWindow: flushWindowBeforeClose,
    list: () => windowManager.list(),
    restoreMostRecentClosed: async () => {
      const recordId = await readMostRecentClosedWindowRecordId();
      if (!recordId) {
        return null;
      }
      return await createFromRecord({ mode: "restore", recordId });
    },
    restoreOpenWindows: async () => {
      const recordIds = await readPreferredOpenWindowRecordIds();
      const results: WindowCreateResult[] = [];
      for (const [index, recordId] of recordIds.entries()) {
        results.push(
          await createFromRecord({
            mode: "restore",
            recordId,
            showInactive: index > 0,
          })
        );
      }
      return results;
    },
  };
}
