import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WINDOW_MANAGER_SOURCE = readFileSync(
  resolve(import.meta.dirname, "../../../src/main/windows/window-manager.ts"),
  "utf8"
);
const TERMINAL_FOCUS_SOURCE = readFileSync(
  resolve(import.meta.dirname, "../../../src/main/ipc/terminal-focus-state.ts"),
  "utf8"
);

const IMPORTS_PRESENTATION_CLEANUP_RE =
  /import \{ clearTerminalPresentationWindowById \} from "\.\.\/ipc\/terminal-presentation\.ts";/;
const IMPORTS_FOCUS_CLEANUP_RE = /clearTerminalFocusWindow/;
const RENDER_PROCESS_GONE_CLEARS_TERMINAL_STATE_RE =
  /const electronWindowId = window\.id;[\s\S]*?window\.webContents\.on\("render-process-gone", \(\) => \{[\s\S]*?clearTerminalPresentationWindowById\(electronWindowId\);[\s\S]*?clearTerminalFocusWindowById\(electronWindowId\);[\s\S]*?closeAllTerminals/;
const CLOSE_PATH_CLEARS_TERMINAL_STATE_RE =
  /window\.host\.on\("close",[\s\S]*?clearTerminalPresentationWindowById\(electronWindowId\);[\s\S]*?clearTerminalFocusWindowById\(electronWindowId\);[\s\S]*?detachWindow/;
const CLOSED_PATH_CLEARS_TERMINAL_STATE_RE =
  /window\.host\.on\("closed", \(\) => \{[\s\S]*?clearTerminalPresentationWindowById\(electronWindowId\);[\s\S]*?clearTerminalFocusWindowById\(electronWindowId\);/;
const FOCUS_CACHE_CLEANUP_EXPORT_RE =
  /export function clearTerminalFocusWindowById\(windowId: number\): void \{\s*lastKeyboardFocusTargetByWindowId\.delete\(windowId\);\s*\}/;

describe("terminal window lifecycle state cleanup", () => {
  it("clears main-side terminal routing state when renderer or window lifecycle ends", () => {
    expect(WINDOW_MANAGER_SOURCE).toMatch(IMPORTS_PRESENTATION_CLEANUP_RE);
    expect(WINDOW_MANAGER_SOURCE).toMatch(IMPORTS_FOCUS_CLEANUP_RE);
    expect(WINDOW_MANAGER_SOURCE).toMatch(
      RENDER_PROCESS_GONE_CLEARS_TERMINAL_STATE_RE
    );
    expect(WINDOW_MANAGER_SOURCE).toMatch(CLOSE_PATH_CLEARS_TERMINAL_STATE_RE);
    expect(WINDOW_MANAGER_SOURCE).toMatch(CLOSED_PATH_CLEARS_TERMINAL_STATE_RE);
    expect(TERMINAL_FOCUS_SOURCE).toMatch(FOCUS_CACHE_CLEANUP_EXPORT_RE);
  });
});
