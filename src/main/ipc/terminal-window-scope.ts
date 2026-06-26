import type { AppWindow } from "../windows/app-window.ts";
import {
  findInternalWindowId,
  findWindowSessionId,
} from "../windows/window-identity.ts";

export function stableWindowIdFor(win: AppWindow): string {
  return findInternalWindowId(win) ?? `window-${win.id}`;
}

export function terminalSessionScopeFor(win: AppWindow): string {
  return findWindowSessionId(win) ?? stableWindowIdFor(win);
}
