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

const BEFORE_QUIT_FLUSH_RE =
  /app\.on\("before-quit",\s*\(event\) => \{[\s\S]{0,500}?event\.preventDefault\(\);[\s\S]{0,500}?appCore\.services\.window\s*\.flushOpenWindows\(\)[\s\S]{0,500}?app\.quit\(\);/;
const CLOSE_GUARD_FLUSH_RE =
  /window\.host\.on\("close",\s*\(event:[\s\S]{0,80}?\) => \{[\s\S]{0,700}?event\.preventDefault\(\);[\s\S]{0,700}?this\.flushBeforeClose\(window,/;
const QUIT_DESTROY_SKIPS_CLOSE_RE =
  /if \(\s*!this\.isDestroyingAllForQuit[\s\S]{0,200}?this\.closeFlushDone\.has\(window\)/;

describe("window lifecycle persistence invariants", () => {
  it("flushes all open window layouts before Cmd+Q destroys windows", () => {
    expect(MAIN_SOURCE).toMatch(BEFORE_QUIT_FLUSH_RE);
  });

  it("flushes the current window before user close proceeds", () => {
    expect(WINDOW_MANAGER_SOURCE).toMatch(CLOSE_GUARD_FLUSH_RE);
  });

  it("does not run user-close record updates during app quit destroy", () => {
    expect(WINDOW_MANAGER_SOURCE).toMatch(QUIT_DESTROY_SKIPS_CLOSE_RE);
  });
});
