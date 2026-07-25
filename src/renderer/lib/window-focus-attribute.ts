/**
 * Sync OS-level BrowserWindow / BaseWindow key-window focus onto
 * `<html data-window-focused>` so chrome CSS (dockview S3 tab indicator)
 * demotes only when the window is not key.
 *
 * Must NOT use DOM `window` blur/focus or `document.hasFocus()`:
 * with Ghostty native firstResponder, the web document is unfocused while the
 * Pier window is still key — that incorrectly demoted S3 (and regressed new-tab
 * chrome when FR handoff fired synthetic blur). Source of truth is main
 * `host.on("focus"|"blur")` → `PIER_BROADCAST.WINDOW_FOCUS_CHANGED`, seeded via
 * `window.getContext().focused` only until the first live event arrives.
 */

export const WINDOW_FOCUSED_ATTR = "data-window-focused";

let installed = false;
/** OS key-window focus for this renderer; optimistic true until seed / live event. */
let keyFocused = true;

function applyWindowFocused(focused: boolean): void {
  keyFocused = focused;
  document.documentElement.setAttribute(
    WINDOW_FOCUSED_ATTR,
    focused ? "true" : "false"
  );
}

/**
 * Whether this Pier window is the OS key window.
 * Source of truth matches `data-window-focused` (main focus/blur), not DOM
 * `document.hasFocus()` (false while native terminal is firstResponder).
 *
 * Used to gate multi-window message toasts: only the focused window renders
 * in-app toast; unfocused windows still sync inbox via NCS broadcast.
 */
export function isWindowKeyFocused(): boolean {
  return keyFocused;
}

interface WindowFocusApi {
  getContext?: () => Promise<{ focused?: boolean }>;
  onFocusChanged?: (cb: (payload: { focused: boolean }) => void) => () => void;
}

function readWindowApi(): WindowFocusApi | undefined {
  const pier = (
    globalThis as {
      window?: { pier?: { window?: WindowFocusApi } };
      pier?: { window?: WindowFocusApi };
    }
  ).window?.pier?.window;
  return pier;
}

/**
 * @returns disposer (mainly for tests); no-op if already installed
 */
export function installWindowFocusAttribute(): () => void {
  if (typeof document === "undefined") {
    return () => undefined;
  }
  if (installed) {
    return () => undefined;
  }
  installed = true;

  // Optimistic until main seed / first event. Prefer S3 over false demotion.
  applyWindowFocused(true);

  // Live focus events always win over a late getContext seed (showInactive →
  // later key-window focus can race a seed that sampled isFocused() === false).
  let sawLiveFocusEvent = false;

  const api = readWindowApi();
  const unsubFocus =
    api?.onFocusChanged?.(({ focused }) => {
      sawLiveFocusEvent = true;
      applyWindowFocused(focused);
    }) ?? (() => undefined);

  const seed = api?.getContext?.();
  if (seed) {
    seed
      .then((ctx) => {
        if (!installed || sawLiveFocusEvent) {
          return;
        }
        if (typeof ctx.focused === "boolean") {
          applyWindowFocused(ctx.focused);
        }
      })
      .catch(() => undefined);
  }

  return () => {
    unsubFocus();
    document.documentElement.removeAttribute(WINDOW_FOCUSED_ATTR);
    installed = false;
  };
}

/** Test helper — resets module singleton between cases. */
export function resetWindowFocusAttributeForTests(): void {
  if (typeof document !== "undefined") {
    document.documentElement.removeAttribute(WINDOW_FOCUSED_ATTR);
  }
  installed = false;
  keyFocused = true;
}

/** Test helper — set focus without installing the full attribute bridge. */
export function setWindowKeyFocusedForTests(focused: boolean): void {
  keyFocused = focused;
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute(
      WINDOW_FOCUSED_ATTR,
      focused ? "true" : "false"
    );
  }
}
