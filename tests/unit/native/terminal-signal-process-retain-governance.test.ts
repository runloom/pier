import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PATCH_ID = "0112-signal-process-retain-surface";
const PATCH = `native/Vendor/libghostty-spm/Patches/ghostty/${PATCH_ID}.patch`;
const PATCH_README = "native/Vendor/libghostty-spm/Patches/ghostty/README.md";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function addedLines(patch: string): string[] {
  return patch
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1));
}

describe("terminal signal-process retain (patch 0112)", () => {
  it("documents NOTE_EXIT child-exited notify without reaping in the patch README", () => {
    expect(existsSync(join(ROOT, PATCH))).toBe(true);
    const readme = read(PATCH_README);
    expect(readme).toContain(`${PATCH_ID}.patch`);
    expect(readme).toContain("NOTE_EXIT");
    expect(readme).toContain("child-exited");
    expect(readme).toContain("exec.exited");
  });

  it("notifies child-exited on NOTE_EXIT without setting exec.exited", () => {
    const added = addedLines(read(PATCH)).join("\n");
    expect(added).toContain(
      "fn notifyPendingChildExited(td: *termio.Termio.ThreadData, exit_code: u32) void {"
    );
    expect(added).toContain("execdata.child_exit_notified = true;");
    expect(added).toContain(".child_exited = .{");
    const notify = added.slice(
      added.indexOf("fn notifyPendingChildExited"),
      added.indexOf("fn finishPendingExit")
    );
    expect(notify).not.toContain("execdata.exited = true");
    expect(added).toContain("notifyPendingChildExited(td, code);");
    expect(added).toContain("if (execdata.child_exit_notified) {");
  });
});
