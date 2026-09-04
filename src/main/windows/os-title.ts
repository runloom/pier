import type { WindowInfo } from "@shared/contracts/events.ts";
import { FALLBACK_LOCALE, type SupportedLocale } from "@shared/i18n/locales.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import {
  buildWindowDisplaysFromDrafts,
  type WindowIdentityDraft,
  windowDisplayCopyForLocale,
} from "@shared/window-display/index.ts";
import type { AppWindow } from "./app-window.ts";
import { findWindowContext } from "./identity.ts";

export interface WindowDisplayDraftPatch {
  baseLabel?: string;
  branch?: string;
  projectPath?: string;
  stableTabQualifier?: string;
}

export interface WindowOsTitleHost {
  getWindow(windowId: string): AppWindow | undefined;
  listWindows(): readonly { id: string; recordId: string }[];
}

const drafts = new Map<string, WindowIdentityDraft>();
const titles = new Map<string, string>();
let host: WindowOsTitleHost | null = null;
let uiLocale: SupportedLocale = FALLBACK_LOCALE;

export function installWindowOsTitle(nextHost: WindowOsTitleHost): void {
  host = nextHost;
}

function copy() {
  return windowDisplayCopyForLocale(uiLocale);
}

export function setWindowOsTitleLocale(locale: SupportedLocale): void {
  if (locale === uiLocale) {
    return;
  }
  uiLocale = locale;
  applyAll();
}

function applyAll(broadcast = true): void {
  if (!host) {
    return;
  }
  const windows = host.listWindows();
  const identityDrafts: WindowIdentityDraft[] = windows.map(
    (window) =>
      drafts.get(window.id) ?? {
        id: window.id,
        recordId: window.recordId,
      }
  );
  const displays = buildWindowDisplaysFromDrafts(identityDrafts, copy());
  const nextTitles = new Map<string, string>();
  for (const display of displays) {
    nextTitles.set(display.id, display.menuLabel);
    const window = host.getWindow(display.id);
    if (window && !window.isDestroyed()) {
      window.setTitle(display.menuLabel);
    }
  }
  titles.clear();
  for (const [id, title] of nextTitles) {
    titles.set(id, title);
  }
  if (broadcast) {
    broadcastWindowListChanged();
  }
}

function broadcastWindowListChanged(): void {
  if (!host) {
    return;
  }
  const windows: WindowInfo[] = host.listWindows().map((window) => {
    const live = host?.getWindow(window.id);
    const title = titles.get(window.id);
    return {
      id: window.id,
      recordId: window.recordId,
      focused: live?.isFocused() ?? false,
      electronWindowId: live ? String(live.id) : undefined,
      ...(title ? { title } : {}),
    };
  });
  for (const window of host.listWindows()) {
    const live = host.getWindow(window.id);
    if (!live || live.isDestroyed() || live.webContents.isDestroyed()) {
      continue;
    }
    try {
      live.webContents.send(PIER_BROADCAST.WINDOW_CHANGED, windows);
    } catch {
      // Renderer may be gone or the test harness may throw on send.
    }
  }
}

export function guardWindowPageTitle(window: AppWindow): void {
  window.webContents.on("page-title-updated", (event) => {
    event.preventDefault();
  });
}

export function refreshWindowOsTitles(): void {
  applyAll(false);
}

export function bindWindowOsTitleHost(
  windows: Map<string, AppWindow>,
  getWindow: (windowId: string) => AppWindow | undefined
): void {
  installWindowOsTitle({
    getWindow,
    listWindows: () =>
      [...windows.entries()].map(([id, managed]) => ({
        id,
        recordId: findWindowContext(managed)?.recordId ?? id,
      })),
  });
  applyAll(false);
}

export function forgetWindowOsTitle(windowId: string): void {
  drafts.delete(windowId);
  titles.delete(windowId);
  applyAll();
}

export function reportWindowDisplayDraft(
  windowId: string,
  recordId: string,
  patch: WindowDisplayDraftPatch
): void {
  drafts.set(windowId, {
    id: windowId,
    recordId,
    ...("baseLabel" in patch && patch.baseLabel
      ? { baseLabel: patch.baseLabel }
      : {}),
    ...("branch" in patch && patch.branch ? { branch: patch.branch } : {}),
    ...("projectPath" in patch && patch.projectPath
      ? { projectPath: patch.projectPath }
      : {}),
    ...("stableTabQualifier" in patch && patch.stableTabQualifier
      ? { stableTabQualifier: patch.stableTabQualifier }
      : {}),
  });
  applyAll();
}

export function windowOsTitleOf(windowId: string): string | undefined {
  return titles.get(windowId);
}

export function listManagedWindowInfos(
  windows: Map<string, AppWindow>,
  lastFocusedAtByWindowId: Map<string, number>
): WindowInfo[] {
  return [...windows.entries()].map(([id, window]) => {
    const lastFocusedAt = lastFocusedAtByWindowId.get(id);
    const context = findWindowContext(window);
    const title = titles.get(id);
    return {
      id,
      focused: window.isFocused(),
      ...(lastFocusedAt === undefined ? {} : { lastFocusedAt }),
      recordId: context?.recordId ?? id,
      electronWindowId: context?.electronWindowId ?? String(window.id),
      ...(title ? { title } : {}),
    };
  });
}

/** Test-only: drop module state between cases. */
export function resetWindowOsTitleForTests(): void {
  drafts.clear();
  titles.clear();
  host = null;
  uiLocale = FALLBACK_LOCALE;
}
