import { describe, expect, it, vi } from "vitest";
import {
  BusyError,
  LifecycleLocks,
} from "../../../../../src/main/services/agents/lifecycle/locks.ts";
import type { LifecycleRunner } from "../../../../../src/main/services/agents/lifecycle/runner/types.ts";
import { createAgentLifecycleService } from "../../../../../src/main/services/agents/lifecycle/service.ts";

function fakeRunner(
  result: Partial<Awaited<ReturnType<LifecycleRunner["run"]>>> = {}
): LifecycleRunner {
  return {
    run: vi.fn(async () => ({
      ok: true,
      code: 0,
      stepIndex: 0,
      stdout: "",
      stderr: "",
      ...result,
    })),
  };
}

describe("LifecycleLocks", () => {
  it("rejects concurrent claim on the same agent", async () => {
    const locks = new LifecycleLocks();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    const first = locks.withAgentLock("codex", async () => {
      await gate;
      return 1;
    });
    await Promise.resolve();
    await expect(
      locks.withAgentLock("codex", async () => 2)
    ).rejects.toBeInstanceOf(BusyError);
    release();
    await expect(first).resolves.toBe(1);
  });

  it("allows different agents in parallel", async () => {
    const locks = new LifecycleLocks();
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => {
      releaseA = r;
    });
    const a = locks.withAgentLock("codex", async () => {
      await gateA;
      return "a";
    });
    await Promise.resolve();
    const b = locks.withAgentLock("claude", async () => "b");
    await expect(b).resolves.toBe("b");
    releaseA();
    await expect(a).resolves.toBe("a");
  });
});

describe("agent lifecycle service + runner", () => {
  it("returns busy when the same agent is already running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const runner: LifecycleRunner = {
      run: vi.fn(async () => {
        await gate;
        return {
          ok: true,
          code: 0,
          stepIndex: 0,
          stdout: "",
          stderr: "",
        };
      }),
    };
    const service = createAgentLifecycleService({
      getEnv: async () => ({ ...process.env }),
      runner,
    });

    const first = service.run("codex", "install");
    await Promise.resolve();
    await Promise.resolve();
    const second = await service.run("codex", "install");
    expect(second.ok).toBe(false);
    expect(second.errorCode).toBe("busy");
    release();
    const firstResult = await first;
    expect(firstResult.errorCode).not.toBe("busy");
  });

  it("cancels in-flight run by agentId", async () => {
    let sawAbort = false;
    const runner: LifecycleRunner = {
      run: vi.fn(async (_plan, opts) => {
        await new Promise<void>((resolve) => {
          if (opts.signal?.aborted) {
            sawAbort = true;
            resolve();
            return;
          }
          opts.signal?.addEventListener(
            "abort",
            () => {
              sawAbort = true;
              resolve();
            },
            { once: true }
          );
        });
        return {
          ok: false,
          code: null,
          stepIndex: 0,
          stdout: "",
          stderr: "cancelled",
          cancelled: true,
        };
      }),
    };
    // Empty PATH so local which finds nothing → install always reaches runner.
    const service = createAgentLifecycleService({
      getEnv: async () => ({ PATH: "/no-such-bin", Path: "/no-such-bin" }),
      runner,
    });
    const pending = service.run("gemini", "install");
    // allow reservation + runner start
    await new Promise((r) => setTimeout(r, 50));
    expect(service.cancel("gemini")).toBe(true);
    const result = await pending;
    expect(sawAbort).toBe(true);
    expect(result.errorCode).toBe("cancelled");
  });

  it("unsupported agents return unsupported without calling runner", async () => {
    const runner = fakeRunner();
    const service = createAgentLifecycleService({
      getEnv: async () => ({}),
      runner,
    });
    const result = await service.run("rovo", "install");
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("unsupported");
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("maps package_manager_missing from runner", async () => {
    const runner = fakeRunner({
      ok: false,
      code: 1,
      packageManagerMissing: true,
      stderr: "npm missing",
    });
    const service = createAgentLifecycleService({
      // Empty PATH so probe finds nothing and install always reaches the runner.
      getEnv: async () => ({ PATH: "/no-such-bin", Path: "/no-such-bin" }),
      runner,
    });
    const result = await service.run("gemini", "install");
    expect(result.skipped).not.toBe(true);
    expect(result.errorCode).toBe("package_manager_missing");
  });

  it("returns env_unavailable when getEnv throws", async () => {
    const service = createAgentLifecycleService({
      getEnv: async () => {
        throw new Error("pes down");
      },
      runner: fakeRunner(),
    });
    const result = await service.run("codex", "install");
    expect(result.errorCode).toBe("env_unavailable");
  });

  it("probe does not fall back to process.env when getEnv fails", async () => {
    const service = createAgentLifecycleService({
      getEnv: async () => {
        throw new Error("pes down");
      },
      runner: fakeRunner(),
    });
    const probes = await service.probe({ agentIds: ["codex"] });
    expect(probes[0]?.envDegraded).toBe(true);
    expect(probes[0]?.installs).toEqual([]);
  });

  // Shell probes + dual plan passes; under full-suite load default 5s flakes.
  it("continues past self-upgrade no-op when version is unchanged", async () => {
    const { chmod, mkdir, mkdtemp, writeFile, rm } = await import(
      "node:fs/promises"
    );
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const root = await mkdtemp(join(tmpdir(), "pier-opencode-update-"));
    // nvm-shaped path → installSource "nvm" → update plan: self then npm-latest
    const binDir = join(root, ".nvm", "versions", "node", "v24.0.0", "bin");
    await mkdir(binDir, { recursive: true });
    const versionFile = join(root, "version.txt");
    await writeFile(versionFile, "1.0.0\n", "utf8");
    const binPath = join(binDir, "opencode");
    await writeFile(
      binPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  cat "${versionFile}"
  exit 0
fi
exit 0
`,
      "utf8"
    );
    await chmod(binPath, 0o755);

    let runCount = 0;
    const runner: LifecycleRunner = {
      run: vi.fn(async (plan) => {
        runCount += 1;
        // First success is self (`opencode upgrade`); version stays 1.0.0.
        // Second plan should be remaining fallbacks; bump version then.
        if (runCount >= 2) {
          await writeFile(versionFile, "1.0.1\n", "utf8");
        }
        const first = plan.steps[0];
        // Guard: first attempt must be self (not npm), second may be npm.
        if (runCount === 1) {
          expect(first?.kind).toBe("argv");
          if (first?.kind === "argv") {
            expect(first.file).not.toBe("npm");
            expect(first.args[0]).toBe("upgrade");
          }
        }
        return {
          ok: true,
          code: 0,
          stepIndex: 0,
          stdout: "",
          stderr: runCount === 1 ? "already installed" : "updated",
        };
      }),
    };

    try {
      const service = createAgentLifecycleService({
        getEnv: async () => ({
          ...process.env,
          PATH: `${binDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
        }),
        runner,
      });
      const result = await service.run("opencode", "update");
      expect(runCount).toBeGreaterThanOrEqual(2);
      expect(result.ok).toBe(true);
      expect(result.version).toBe("1.0.1");
      expect(result.errorCode).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);

  it("does not fall through to install script after reinstall-mode self already-latest", async () => {
    const { chmod, mkdir, mkdtemp, writeFile, rm } = await import(
      "node:fs/promises"
    );
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    // kiro: updateMode reinstall, plan self then reinstall. Already-latest self
    // must not continue into the official script (TTY failure path).
    const root = await mkdtemp(join(tmpdir(), "pier-kiro-self-latest-"));
    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    const binPath = join(binDir, "kiro-cli");
    await writeFile(
      binPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "kiro-cli 2.16.1"
  exit 0
fi
exit 0
`,
      "utf8"
    );
    await chmod(binPath, 0o755);

    const runner: LifecycleRunner = {
      run: vi.fn(async (plan) => {
        const first = plan.steps[0];
        expect(first?.kind).toBe("argv");
        if (first?.kind === "argv") {
          expect(first.file).toBe(binPath);
          expect(first.args[0]).toBe("update");
        }
        // Plan may still list reinstall as later steps; service must not re-invoke
        // runner after version-unchanged self success in reinstall mode.
        return {
          ok: true,
          code: 0,
          stepIndex: 0,
          stdout: "",
          stderr: "Already up to date",
        };
      }),
    };

    try {
      const service = createAgentLifecycleService({
        getEnv: async () => ({
          ...process.env,
          PATH: `${binDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
        }),
        runner,
      });
      const result = await service.run("kiro", "update");
      expect(runner.run).toHaveBeenCalledTimes(1);
      // reinstall mode: success with unchanged version is ok (not versioned soft-fail)
      expect(result.ok).toBe(true);
      expect(result.version).toBe("2.16.1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Brew-shaped PATH probe + upgrade plan; allow headroom under suite load.
  it("does not dual-install after brew upgrade no-op (version_unchanged)", async () => {
    const { chmod, mkdir, mkdtemp, writeFile, rm } = await import(
      "node:fs/promises"
    );
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    if (process.platform === "win32") {
      return;
    }

    const root = await mkdtemp(join(tmpdir(), "pier-opencode-brew-"));
    // Cellar-shaped path → installSource "brew" → primary brew-upgrade
    const cellarBin = join(root, "Cellar", "opencode", "1.0.0", "bin");
    await mkdir(cellarBin, { recursive: true });
    const binPath = join(cellarBin, "opencode");
    await writeFile(
      binPath,
      `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "1.0.0"
  exit 0
fi
exit 0
`,
      "utf8"
    );
    await chmod(binPath, 0o755);

    const runner: LifecycleRunner = {
      run: vi.fn(async (plan) => {
        const first = plan.steps[0];
        expect(first?.kind).toBe("argv");
        if (first?.kind === "argv") {
          expect(first.file).toBe("brew");
        }
        return {
          ok: true,
          code: 0,
          stepIndex: 0,
          stdout: "",
          stderr: "already installed",
        };
      }),
    };

    try {
      const service = createAgentLifecycleService({
        getEnv: async () => ({
          ...process.env,
          PATH: `${cellarBin}:${process.env.PATH ?? ""}`,
        }),
        runner,
      });
      const result = await service.run("opencode", "update");
      // brew no-op must not fall through to npm (dual install risk)
      expect(runner.run).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe("version_unchanged");
      expect(result.softFailure).toBe("version_unchanged");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 15_000);
});
