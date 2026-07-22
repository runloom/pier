import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MAIN_SOURCE = readFileSync(
  resolve(import.meta.dirname, "../../../src/main/index.ts"),
  "utf8"
);
const WINDOW_MANAGER_SOURCE = readFileSync(
  resolve(import.meta.dirname, "../../../src/main/windows/window-manager.ts"),
  "utf8"
);
const WINDOW_CLOSE_COORDINATOR_SOURCE = readFileSync(
  resolve(
    import.meta.dirname,
    "../../../src/main/windows/window-close-coordinator.ts"
  ),
  "utf8"
);

const APP_QUIT_CONTROLLER_CREATION_RE =
  /const\s+appQuitController\s*=\s*createAppQuitController\(\s*\{/;
const APP_QUIT_CONTROLLER_FLUSH_INJECTION_RE =
  /createAppQuitController\(\{[\s\S]{0,2500}?flushBeforeQuit:\s*flushBeforeQuitConfirmed\b/;
const FLUSH_BEFORE_QUIT_WINDOWS_RE =
  /async function flushBeforeQuitConfirmed\(\): Promise<void> \{[\s\S]{0,1600}?appCore\.services\.window\s*\.flushOpenWindows\(/;
const FLUSH_BEFORE_QUIT_SECRETS_RE =
  /async function flushBeforeQuitConfirmed\(\): Promise<void> \{[\s\S]{0,1600}?appCore\.services\.secrets\.flush\(\)/;
const FLUSH_BEFORE_QUIT_EXTERNAL_PLUGINS_RE =
  /async function flushBeforeQuitConfirmed\(\): Promise<void> \{[\s\S]{0,1600}?appCore\.flushExternalPluginsBeforeQuit\(\)/;
const FLUSH_BEFORE_QUIT_SHUTDOWN_TASKS_RE =
  /async function flushBeforeQuitConfirmed\(\): Promise<void> \{[\s\S]{0,2200}?appCore\.services\.tasks\.shutdownForQuit\(\)/;
const FINAL_CLEANUP_DESTROYS_WINDOWS_RE =
  /createAppQuitController\(\{[\s\S]{0,2500}?finalCleanup:\s*\(\)\s*=>\s*\{[\s\S]{0,500}?windowManager\.destroyAllForQuit\(\)/;
const FINAL_CLEANUP_DISPOSES_TASKS_RE =
  /createAppQuitController\(\{[\s\S]{0,2500}?finalCleanup:\s*\(\)\s*=>\s*\{[\s\S]{0,500}?appCore\.services\.tasks\.dispose\(\)/;
const BEFORE_QUIT_GUARDS_SECOND_INSTANCE_RE =
  /app\.on\("before-quit",\s*\(event\) => \{\s*if \(\s*!gotTheLock\s*\) \{\s*return;\s*\}\s*appQuitController\.handleBeforeQuit\(event\);\s*\}\);/;
const CLOSE_GUARD_FLUSH_RE =
  /window\.host\.on\("close",\s*\(event:[\s\S]{0,80}?\) => \{[\s\S]{0,500}?this\.closeCoordinator\.intercept\(window,[\s\S]{0,300}?event\.preventDefault\(\)/;
const CLOSE_COORDINATOR_FLUSH_RE =
  /intercept\([\s\S]{0,500}?this\.#flush\(payload\)[\s\S]{0,500}?window\.close\(\)/;
const QUIT_DESTROY_SKIPS_CLOSE_RE =
  /if \(\s*!this\.isDestroyingAllForQuit[\s\S]{0,300}?this\.closeCoordinator\.intercept\(window/;
const PROCEED_TO_QUIT_BEGINS_QUIT_BEFORE_INSTALL_RE =
  /proceedToQuit:\s*\(\)\s*=>\s*\{[\s\S]{0,500}?windowManager\.beginQuit\(\);[\s\S]{0,500}?quitAndInstall\(\)/;
const BEGIN_QUIT_API_RE =
  /beginQuit\(\):\s*void\s*\{\s*this\.isDestroyingAllForQuit\s*=\s*true;\s*\}/;

describe("window lifecycle persistence invariants", () => {
  it("creates an app quit controller for Cmd+Q", () => {
    expect(MAIN_SOURCE).toMatch(APP_QUIT_CONTROLLER_CREATION_RE);
  });

  it("injects a flushBeforeQuit path that flushes window layouts", () => {
    expect(MAIN_SOURCE).toMatch(APP_QUIT_CONTROLLER_FLUSH_INJECTION_RE);
    expect(MAIN_SOURCE).toMatch(FLUSH_BEFORE_QUIT_WINDOWS_RE);
  });

  it("injects a flushBeforeQuit path that flushes secrets", () => {
    expect(MAIN_SOURCE).toMatch(APP_QUIT_CONTROLLER_FLUSH_INJECTION_RE);
    expect(MAIN_SOURCE).toMatch(FLUSH_BEFORE_QUIT_SECRETS_RE);
  });

  it("injects a flushBeforeQuit path that flushes external plugins", () => {
    expect(MAIN_SOURCE).toMatch(APP_QUIT_CONTROLLER_FLUSH_INJECTION_RE);
    expect(MAIN_SOURCE).toMatch(FLUSH_BEFORE_QUIT_EXTERNAL_PLUGINS_RE);
  });

  it("injects a flushBeforeQuit path that shuts down background tasks", () => {
    expect(MAIN_SOURCE).toMatch(APP_QUIT_CONTROLLER_FLUSH_INJECTION_RE);
    expect(MAIN_SOURCE).toMatch(FLUSH_BEFORE_QUIT_SHUTDOWN_TASKS_RE);
  });

  it("injects finalCleanup that destroys all windows for quit", () => {
    expect(MAIN_SOURCE).toMatch(FINAL_CLEANUP_DESTROYS_WINDOWS_RE);
  });

  it("injects finalCleanup that disposes task-owned background processes", () => {
    expect(MAIN_SOURCE).toMatch(FINAL_CLEANUP_DISPOSES_TASKS_RE);
  });

  it("does not run the app quit controller for a second-instance quit", () => {
    expect(MAIN_SOURCE).toMatch(BEFORE_QUIT_GUARDS_SECOND_INSTANCE_RE);
  });

  it("flushes the current window before user close proceeds", () => {
    expect(WINDOW_MANAGER_SOURCE).toMatch(CLOSE_GUARD_FLUSH_RE);
    expect(WINDOW_CLOSE_COORDINATOR_SOURCE).toMatch(CLOSE_COORDINATOR_FLUSH_RE);
  });

  it("does not run user-close record updates during app quit destroy", () => {
    expect(WINDOW_MANAGER_SOURCE).toMatch(QUIT_DESTROY_SKIPS_CLOSE_RE);
  });

  it("marks quitting before quitAndInstall so close intercept cannot re-enter prepareClose", () => {
    expect(WINDOW_MANAGER_SOURCE).toMatch(BEGIN_QUIT_API_RE);
    expect(MAIN_SOURCE).toMatch(PROCEED_TO_QUIT_BEGINS_QUIT_BEFORE_INSTALL_RE);
  });
});
