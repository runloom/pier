import { chmod, mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatRemainingInstalls } from "../../../../../src/main/services/agents/lifecycle/run-uninstall.ts";
import type { LifecycleRunner } from "../../../../../src/main/services/agents/lifecycle/runner/types.ts";
import { createAgentLifecycleService } from "../../../../../src/main/services/agents/lifecycle/service.ts";

function fakeOkRunner(): LifecycleRunner {
  return {
    run: vi.fn(async () => ({
      ok: true,
      code: 0,
      stepIndex: 0,
      stdout: "",
      stderr: "",
    })),
  };
}

async function writeAgentBin(
  binDir: string,
  name: string,
  version = "1.0.0"
): Promise<string> {
  await mkdir(binDir, { recursive: true });
  const binPath = join(binDir, name);
  await writeFile(
    binPath,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "${version}"
  exit 0
fi
exit 0
`,
    "utf8"
  );
  await chmod(binPath, 0o755);
  return binPath;
}

/**
 * Prefer temp bins first, keep only system roots so `which` works and a real
 * host install of the same agent CLI is unlikely to appear on PATH.
 */
function pathEnv(binDir: string): NodeJS.ProcessEnv {
  const sep = process.platform === "win32" ? ";" : ":";
  const systemRoots =
    process.platform === "win32"
      ? [
          process.env.SystemRoot
            ? `${process.env.SystemRoot}\\System32`
            : "C:\\Windows\\System32",
        ]
      : ["/usr/bin", "/bin"];
  return {
    ...process.env,
    PATH: [binDir, ...systemRoots].join(sep),
    Path: [binDir, ...systemRoots].join(sep),
  };
}

describe("run uninstall service", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) {
        await fn();
      }
    }
  });

  it("never calls afterInstall on successful uninstall", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-uninstall-ok-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    // npm-shaped path so managed uninstall plan exists for gemini.
    const binDir = join(root, "lib", "node_modules", ".bin");
    const binPath = await writeAgentBin(binDir, "gemini");

    const afterInstall = vi.fn();
    const afterUninstall = vi.fn();
    const runner: LifecycleRunner = {
      run: vi.fn(async () => {
        // Simulate PM removing the bin so post-probe sees detected=false.
        await unlink(binPath).catch(() => undefined);
        return {
          ok: true,
          code: 0,
          stepIndex: 0,
          stdout: "",
          stderr: "",
        };
      }),
    };

    const svc = createAgentLifecycleService({
      getEnv: async () => pathEnv(binDir),
      runner,
      afterInstall,
      afterUninstall,
    });

    const result = await svc.run("gemini", "uninstall");
    expect(result.ok).toBe(true);
    expect(result.skipped).not.toBe(true);
    expect(result.errorCode).toBeUndefined();
    expect(afterUninstall).toHaveBeenCalledWith("gemini");
    expect(afterInstall).not.toHaveBeenCalled();
    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it("still_detected is hard fail with remaining paths in errorDetail", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-uninstall-still-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const binDir = join(root, "lib", "node_modules", ".bin");
    const binPath = await writeAgentBin(binDir, "gemini", "2.0.0");

    const afterInstall = vi.fn();
    const afterUninstall = vi.fn();
    const runner = fakeOkRunner();

    const svc = createAgentLifecycleService({
      getEnv: async () => pathEnv(binDir),
      runner,
      afterInstall,
      afterUninstall,
    });

    const result = await svc.run("gemini", "uninstall");
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("still_detected");
    expect(result.softFailure).toBeUndefined();
    expect(result.errorDetail).toBeTruthy();
    expect(result.errorDetail).toContain(binPath);
    expect(result.errorDetail).toMatch(/\[npm\]/);
    expect(afterUninstall).not.toHaveBeenCalled();
    expect(afterInstall).not.toHaveBeenCalled();
  });

  it("custom uninstall shell runs when canUninstall is false (full + path)", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-uninstall-custom-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    // Plain path source → managed canUninstall false for claude.
    const binDir = join(root, ".local", "bin");
    const binPath = await writeAgentBin(binDir, "claude");

    const runner: LifecycleRunner = {
      run: vi.fn(async () => {
        await unlink(binPath).catch(() => undefined);
        return {
          ok: true,
          code: 0,
          stepIndex: 0,
          stdout: "",
          stderr: "",
        };
      }),
    };

    const svc = createAgentLifecycleService({
      getEnv: async () => pathEnv(binDir),
      runner,
      getLifecycleCommands: async () => ({
        install: {},
        update: {},
        uninstall: { claude: "echo uninstall-claude" },
      }),
    });

    // Preflight: without custom, path-sourced claude has no managed plan.
    const probes = await svc.probe({ agentIds: ["claude"], deep: true });
    expect(probes[0]?.detected).toBe(true);
    expect(probes[0]?.canUninstall).toBe(false);

    const result = await svc.run("claude", "uninstall");
    expect(result.ok).toBe(true);
    expect(runner.run).toHaveBeenCalledTimes(1);
    const plan = vi.mocked(runner.run).mock.calls[0]?.[0];
    expect(plan?.steps).toEqual([
      { kind: "shell", command: "echo uninstall-claude" },
    ]);
    expect(plan?.preview).toBe("echo uninstall-claude");
  });

  it("support guided → unsupported", async () => {
    const runner = fakeOkRunner();
    const svc = createAgentLifecycleService({
      getEnv: async () => ({}),
      runner,
    });
    const result = await svc.run("rovo", "uninstall");
    expect(result).toMatchObject({
      ok: false,
      errorCode: "unsupported",
      action: "uninstall",
      agentId: "rovo",
    });
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("skips when already not detected", async () => {
    const runner = fakeOkRunner();
    const svc = createAgentLifecycleService({
      getEnv: async () => ({ PATH: "/no-such-bin", Path: "/no-such-bin" }),
      runner,
    });
    const result = await svc.run("gemini", "uninstall");
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("formatRemainingInstalls lists [source] path lines", () => {
    const detail = formatRemainingInstalls([
      {
        path: "/a/bin/x",
        source: "npm",
        version: "1.0.0",
        runnable: true,
        isPathDefault: true,
      },
      {
        path: "/b/bin/x",
        source: "path",
        version: null,
        runnable: true,
        isPathDefault: false,
      },
    ]);
    expect(detail).toBe("[npm] /a/bin/x (1.0.0)\n[path] /b/bin/x");
  });
});
