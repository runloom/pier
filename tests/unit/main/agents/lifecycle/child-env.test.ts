import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mergeLifecycleChildEnv } from "../../../../../src/main/services/agents/lifecycle/runner/child-env.ts";
import { runProcess } from "../../../../../src/main/services/agents/lifecycle/runner/process.ts";

describe("mergeLifecycleChildEnv", () => {
  it("never pins HOMEBREW_NO_AUTO_UPDATE (stale index would no-op brew upgrade)", () => {
    const merged = mergeLifecycleChildEnv({});
    expect(merged.HOMEBREW_NO_AUTO_UPDATE).toBeUndefined();
  });

  it("throttles brew auto-update instead of disabling it", () => {
    expect(mergeLifecycleChildEnv({}).HOMEBREW_AUTO_UPDATE_SECS).toBe("300");
    expect(
      mergeLifecycleChildEnv({ HOMEBREW_AUTO_UPDATE_SECS: "60" })
        .HOMEBREW_AUTO_UPDATE_SECS
    ).toBe("60");
  });

  it("respects an explicit user HOMEBREW_NO_AUTO_UPDATE", () => {
    expect(
      mergeLifecycleChildEnv({ HOMEBREW_NO_AUTO_UPDATE: "1" })
        .HOMEBREW_NO_AUTO_UPDATE
    ).toBe("1");
  });

  it("keeps non-interactive defaults", () => {
    const merged = mergeLifecycleChildEnv({});
    expect(merged.NONINTERACTIVE).toBe("1");
    expect(merged.HOMEBREW_NO_ENV_HINTS).toBe("1");
    expect(merged.HOMEBREW_NO_INSTALL_CLEANUP).toBe("1");
  });
});

describe("runProcess cwd", () => {
  it("spawns in the requested cwd", async () => {
    if (process.platform === "win32") {
      return;
    }
    const dir = await realpath(await mkdtemp(join(tmpdir(), "pier-cwd-")));
    try {
      const result = await runProcess("/bin/sh", ["-c", "pwd"], {
        cwd: dir,
        env: {},
        timeoutMs: 5000,
      });
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("inherits the host cwd when none is given", async () => {
    if (process.platform === "win32") {
      return;
    }
    const result = await runProcess("/bin/sh", ["-c", "pwd"], {
      env: {},
      timeoutMs: 5000,
    });
    expect(result.stdout.trim()).toBe(await realpath(process.cwd()));
  });
});
