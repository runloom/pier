import type {
  ChildProcess,
  spawn as nodeSpawn,
  SpawnOptionsWithoutStdio,
} from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { LocalEnvironmentScriptError } from "@main/services/local-environment-scripts.ts";
import { createLocalEnvironmentService } from "@main/services/local-environments-service.ts";
import type { ProcessEnvironmentService } from "@main/services/process-environment-service.ts";
import type { LocalEnvironmentProject } from "@shared/contracts/environment.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SpawnFunction = typeof nodeSpawn;

class FakeChildProcess extends EventEmitter {
  readonly pid = 1234;
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();

  kill = vi.fn(() => true);
}

function stubProject(
  overrides: Partial<LocalEnvironmentProject> = {}
): LocalEnvironmentProject {
  return {
    cleanupCommand: "",
    copyPatterns: [],
    env: { PIER_ENV: "test" },
    projectRootPath: "/stub/project",
    setupCommand: "",
    updatedAt: 1,
    ...overrides,
  };
}

function processEnvironment(): ProcessEnvironmentService {
  return {
    resolve: vi.fn(async ({ cwd, explicitEnv, source }) => ({
      diagnostics: {
        cacheHit: false,
        cwd,
        pathChanged: false,
        shellEnvStatus: "skipped" as const,
        source,
      },
      env: { PATH: "/usr/bin", SHELL: "/bin/sh", ...explicitEnv },
    })),
  };
}

function createScriptSpawn(): SpawnFunction {
  const spawn = vi.fn(
    (
      _command: string,
      args: readonly string[] = [],
      options: SpawnOptionsWithoutStdio = {}
    ) => {
      const child = new FakeChildProcess();
      const cwd = String(options.cwd ?? "");
      const script = args.at(-1) ?? "";

      queueMicrotask(() => {
        const runScript = async () => {
          let exitCode = 0;
          if (script === "printf setup > .pier-setup-marker") {
            await writeFile(join(cwd, ".pier-setup-marker"), "setup", "utf8");
          } else if (script === "printf cleanup > .pier-cleanup-marker") {
            await writeFile(
              join(cwd, ".pier-cleanup-marker"),
              "cleanup",
              "utf8"
            );
          } else if (script === "printf nope >&2; exit 7") {
            child.stderr.write("nope\n");
            exitCode = 7;
          }
          child.stdout.end();
          child.stderr.end();
          child.emit("exit", exitCode, null);
          child.emit("close", exitCode, null);
        };
        runScript().catch((error) => {
          child.emit("error", error);
        });
      });

      return child as unknown as ChildProcess;
    }
  );

  return spawn as unknown as SpawnFunction;
}

describe("local environment lifecycle scripts", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pier-local-environment-scripts-"));
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  it("runs setup with cwd set to the worktree path", async () => {
    const worktreePath = await mkdtemp(join(tempDir, "worktree-"));
    const spawn = createScriptSpawn();
    const service = createLocalEnvironmentService({
      filePath: join(tempDir, "state.json"),
      processEnvironment: processEnvironment(),
      spawn,
    });

    await service.runLifecycle({
      cwd: worktreePath,
      project: stubProject({
        setupCommand: "printf setup > .pier-setup-marker",
      }),
      phase: "setup",
    });

    await expect(
      readFile(join(worktreePath, ".pier-setup-marker"), "utf8")
    ).resolves.toBe("setup");
  });

  it("runs cleanup with cwd set to the worktree path", async () => {
    const worktreePath = await mkdtemp(join(tempDir, "worktree-"));
    const spawn = createScriptSpawn();
    const service = createLocalEnvironmentService({
      filePath: join(tempDir, "state.json"),
      processEnvironment: processEnvironment(),
      spawn,
    });

    await service.runLifecycle({
      cwd: worktreePath,
      project: stubProject({
        cleanupCommand: "printf cleanup > .pier-cleanup-marker",
      }),
      phase: "cleanup",
    });

    await expect(
      readFile(join(worktreePath, ".pier-cleanup-marker"), "utf8")
    ).resolves.toBe("cleanup");
  });

  it("rejects cleanup failure with phase, exit code and stderr", async () => {
    const worktreePath = await mkdtemp(join(tempDir, "worktree-"));
    const service = createLocalEnvironmentService({
      filePath: join(tempDir, "state.json"),
      processEnvironment: processEnvironment(),
      spawn: createScriptSpawn(),
    });

    let caught: unknown;
    try {
      await service.runLifecycle({
        cwd: worktreePath,
        project: stubProject({ cleanupCommand: "printf nope >&2; exit 7" }),
        phase: "cleanup",
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(LocalEnvironmentScriptError);
    expect(caught).toMatchObject({
      exitCode: 7,
      phase: "cleanup",
      stderr: expect.stringContaining("nope"),
    });
  });

  it("returns without spawning when the phase command is empty", async () => {
    const spawn = vi.fn() as unknown as SpawnFunction;
    const service = createLocalEnvironmentService({
      filePath: join(tempDir, "state.json"),
      processEnvironment: processEnvironment(),
      spawn,
    });

    await service.runLifecycle({
      cwd: tempDir,
      project: stubProject({ cleanupCommand: "" }),
      phase: "cleanup",
    });

    expect(spawn).not.toHaveBeenCalled();
  });
});
