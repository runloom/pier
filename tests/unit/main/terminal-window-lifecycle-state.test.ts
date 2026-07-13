import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WINDOW_MANAGER_SOURCE = readFileSync(
  resolve(import.meta.dirname, "../../../src/main/windows/window-manager.ts"),
  "utf8"
);
const RENDERER_FAILURE_RECOVERY_SOURCE = readFileSync(
  resolve(
    import.meta.dirname,
    "../../../src/main/windows/renderer-failure-recovery.ts"
  ),
  "utf8"
);

const IMPORTS_COORDINATOR_RE =
  /import \{ terminalFocusCoordinator \} from "\.\.\/ipc\/terminal-focus-coordinator\.ts";/;
const RENDER_PROCESS_GONE_CLEARS_TERMINAL_STATE_RE =
  /beforeRendererGone: \(\) => \{[\s\S]*?terminalFocusCoordinator\.clearWindow\(electronWindowId\);[\s\S]*?closeAllTerminals/;
const RENDER_PROCESS_GONE_INVOKES_CLEANUP_RE =
  /window\.webContents\.on\("render-process-gone",[\s\S]*?beforeRendererGone\(\);/;
const CLOSE_PATH_CLEARS_TERMINAL_STATE_RE =
  /window\.host\.on\("close",[\s\S]*?terminalFocusCoordinator\.clearWindow\(electronWindowId\);[\s\S]*?detachWindow/;
const CLOSED_PATH_CLEARS_TERMINAL_STATE_RE =
  /window\.host\.on\("closed", \(\) => \{[\s\S]*?terminalFocusCoordinator\.clearWindow\(electronWindowId\);/;

describe("terminal window lifecycle state cleanup", () => {
  it("clears main-side terminal routing state when renderer or window lifecycle ends", () => {
    expect(WINDOW_MANAGER_SOURCE).toMatch(IMPORTS_COORDINATOR_RE);
    expect(WINDOW_MANAGER_SOURCE).toMatch(
      RENDER_PROCESS_GONE_CLEARS_TERMINAL_STATE_RE
    );
    expect(RENDERER_FAILURE_RECOVERY_SOURCE).toMatch(
      RENDER_PROCESS_GONE_INVOKES_CLEANUP_RE
    );
    expect(WINDOW_MANAGER_SOURCE).toMatch(CLOSE_PATH_CLEARS_TERMINAL_STATE_RE);
    expect(WINDOW_MANAGER_SOURCE).toMatch(CLOSED_PATH_CLEARS_TERMINAL_STATE_RE);
  });
});
