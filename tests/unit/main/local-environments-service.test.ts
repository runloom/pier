import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createLocalEnvironmentService,
  type LocalEnvironmentService,
  LocalEnvironmentServiceError,
} from "@main/services/local-environments-service.ts";
import type { ProcessEnvironmentService } from "@main/services/process-environment-service.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function fakeProcessEnvironment(): ProcessEnvironmentService {
  return {
    resolve: vi.fn(async ({ cwd, explicitEnv, source }) => ({
      diagnostics: {
        cacheHit: false,
        cwd,
        pathChanged: false,
        shellEnvStatus: "skipped" as const,
        source,
      },
      env: { SHELL: "/bin/sh", ...explicitEnv },
    })),
  };
}

describe("createLocalEnvironmentService", () => {
  let now: number;
  let service: LocalEnvironmentService;
  let stateFilePath: string;
  let tempDir: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    now = 1000;
    tempDir = await mkdtemp(join(tmpdir(), "pier-local-environments-"));
    stateFilePath = join(tempDir, "local-environments.json");
    service = createLocalEnvironmentService({
      filePath: stateFilePath,
      now: () => now,
      processEnvironment: fakeProcessEnvironment(),
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await rm(tempDir, { force: true, recursive: true });
  });

  async function makeDir(name: string): Promise<string> {
    const path = join(tempDir, name);
    await mkdir(path);
    return path;
  }

  async function readWrittenState(): Promise<unknown> {
    await vi.runOnlyPendingTimersAsync();
    return JSON.parse(await readFile(stateFilePath, "utf8"));
  }

  async function readProjectFileFor(projectRootPath: string): Promise<unknown> {
    await vi.runOnlyPendingTimersAsync();
    return JSON.parse(
      await readFile(join(projectRootPath, ".pier", "environment.json"), "utf8")
    );
  }

  async function existsProjectFile(projectRootPath: string): Promise<boolean> {
    try {
      await readFile(
        join(projectRootPath, ".pier", "environment.json"),
        "utf8"
      );
      return true;
    } catch {
      return false;
    }
  }

  it("addProject creates a new flat project", async () => {
    const projectRootPath = await makeDir("repo");
    const canonical = await realpath(projectRootPath);

    await expect(
      service.addProject({ projectRootPath })
    ).resolves.toMatchObject({
      projects: [
        {
          cleanupCommand: "",
          env: {},
          projectRootPath: canonical,
          setupCommand: "",
          updatedAt: 1000,
        },
      ],
      version: 1,
      worktreeBindings: [],
    });

    await expect(readWrittenState()).resolves.toMatchObject({
      projects: [{ projectRootPath: canonical }],
      version: 1,
      worktreeBindings: [],
    });
    await expect(readProjectFileFor(projectRootPath)).resolves.toMatchObject({
      cleanupCommand: "",
      copyPatterns: [".env*"],
      env: {},
      setupCommand: "",
      updatedAt: 1000,
      version: 1,
    });
    await expect(readdir(projectRootPath)).resolves.toEqual([".pier"]);
  });

  it("addProject preserves an existing .pier/environment.json (team-shared file)", async () => {
    const projectRootPath = await makeDir("repo");
    const canonical = await realpath(projectRootPath);
    await mkdir(join(projectRootPath, ".pier"));
    await writeFile(
      join(projectRootPath, ".pier", "environment.json"),
      JSON.stringify({
        cleanupCommand: "team cleanup",
        copyPatterns: ["dist/**"],
        env: { TEAM: "yes" },
        setupCommand: "team setup",
        updatedAt: 999,
        version: 1,
      }),
      "utf8"
    );

    const result = await service.addProject({ projectRootPath });

    expect(result.projects[0]).toMatchObject({
      cleanupCommand: "team cleanup",
      copyPatterns: ["dist/**"],
      env: { TEAM: "yes" },
      projectRootPath: canonical,
      setupCommand: "team setup",
      updatedAt: 999,
    });
  });

  it("addProject is idempotent and preserves the existing config file", async () => {
    const projectRootPath = await makeDir("repo");
    const canonical = await realpath(projectRootPath);

    await service.addProject({ projectRootPath });
    now = 2000;
    const result = await service.addProject({ projectRootPath });

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toMatchObject({
      projectRootPath: canonical,
      // 文件已存在 -> 不重写, updatedAt 停留在首次 seed 的时间戳.
      updatedAt: 1000,
    });
  });

  it("addProject seeds copyPatterns with .env* default", async () => {
    const projectRootPath = await makeDir("repo");

    const result = await service.addProject({ projectRootPath });

    expect(result.projects[0]?.copyPatterns).toEqual([".env*"]);
  });

  it("updateProject trims setup/cleanup and drops empty env keys", async () => {
    const projectRootPath = await makeDir("repo");
    await service.addProject({ projectRootPath });
    now = 2000;

    await service.updateProject({
      cleanupCommand: "  pnpm cleanup  ",
      copyPatterns: [" .env* ", ".env*", "*.local", "  "],
      env: { "": "drop-me", " TRIM_KEY ": "val", NODE_ENV: "dev" },
      projectRootPath,
      setupCommand: "  pnpm setup  ",
    });

    await expect(readProjectFileFor(projectRootPath)).resolves.toMatchObject({
      cleanupCommand: "pnpm cleanup",
      copyPatterns: [".env*", "*.local"],
      env: { NODE_ENV: "dev", TRIM_KEY: "val" },
      setupCommand: "pnpm setup",
      updatedAt: 2000,
      version: 1,
    });
  });

  it("updateProject throws project_not_found", async () => {
    const projectRootPath = await makeDir("repo");

    let error: unknown;
    try {
      await service.updateProject({
        cleanupCommand: "",
        copyPatterns: [],
        env: {},
        projectRootPath,
        setupCommand: "",
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(LocalEnvironmentServiceError);
    expect((error as LocalEnvironmentServiceError).reason).toBe(
      "project_not_found"
    );
  });

  it("bindWorktree records only projectRootPath and worktreePath", async () => {
    const projectRootPath = await makeDir("repo");
    const worktreePath = await makeDir("repo-feature");

    await service.bindWorktree({ projectRootPath, worktreePath });

    const written = (await readWrittenState()) as {
      worktreeBindings: Record<string, unknown>[];
    };
    expect(written.worktreeBindings).toHaveLength(1);
    expect(written.worktreeBindings[0]).toMatchObject({
      createdAt: 1000,
      projectRootPath: await realpath(projectRootPath),
      worktreePath: await realpath(worktreePath),
    });
    expect(written.worktreeBindings[0]).not.toHaveProperty("environmentId");
  });

  it("bindWorktree replaces existing binding", async () => {
    const projectRootPath1 = await makeDir("repo-1");
    const projectRootPath2 = await makeDir("repo-2");
    const worktreePath = await makeDir("worktree");

    await service.bindWorktree({
      projectRootPath: projectRootPath1,
      worktreePath,
    });
    now = 2000;
    await service.bindWorktree({
      projectRootPath: projectRootPath2,
      worktreePath,
    });

    const written = (await readWrittenState()) as {
      worktreeBindings: Record<string, unknown>[];
    };
    expect(written.worktreeBindings).toHaveLength(1);
    expect(written.worktreeBindings[0]).toMatchObject({
      createdAt: 2000,
      projectRootPath: await realpath(projectRootPath2),
      worktreePath: await realpath(worktreePath),
    });
  });

  it("resolveForWorktree returns bound project", async () => {
    const projectRootPath = await makeDir("repo");
    const worktreePath = await makeDir("repo-feature");
    const canonical = await realpath(projectRootPath);

    await service.addProject({ projectRootPath });
    await service.updateProject({
      cleanupCommand: "rm -rf tmp",
      copyPatterns: [],
      env: { NODE_ENV: "dev" },
      projectRootPath,
      setupCommand: "pnpm install",
    });
    await service.bindWorktree({ projectRootPath, worktreePath });

    const result = await service.resolveForWorktree(worktreePath);
    expect(result).not.toBeNull();
    expect(result?.projectRootPath).toBe(canonical);
    expect(result?.project.setupCommand).toBe("pnpm install");
    expect(result?.project.cleanupCommand).toBe("rm -rf tmp");
    expect(result?.project.env).toEqual({ NODE_ENV: "dev" });
  });

  it("resolveForWorktree returns null", async () => {
    await expect(
      service.resolveForWorktree("/nonexistent/path")
    ).resolves.toBeNull();
  });

  it("worktreeBinding returns flat snapshot with hasCleanupScript flag", async () => {
    const projectRootPath = await makeDir("repo");
    const worktreePath = await makeDir("repo-feature");
    const canonicalProject = await realpath(projectRootPath);
    const canonicalWorktree = await realpath(worktreePath);

    await service.addProject({ projectRootPath });
    await service.updateProject({
      cleanupCommand: "pnpm cleanup",
      copyPatterns: [".env*"],
      env: { NODE_ENV: "dev" },
      projectRootPath,
      setupCommand: "pnpm setup",
    });
    await service.bindWorktree({ projectRootPath, worktreePath });

    await expect(
      service.worktreeBinding({ worktreePath })
    ).resolves.toStrictEqual({
      cleanupCommand: "pnpm cleanup",
      copyPatterns: [".env*"],
      env: { NODE_ENV: "dev" },
      hasCleanupScript: true,
      projectRootPath: canonicalProject,
      setupCommand: "pnpm setup",
      worktreePath: canonicalWorktree,
    });
  });

  it("worktreeBinding returns null when missing", async () => {
    await expect(
      service.worktreeBinding({ worktreePath: "/nonexistent" })
    ).resolves.toBeNull();
  });

  it("removeProject removes project, bindings and .pier/environment.json", async () => {
    const projectRootPath = await makeDir("repo");
    const worktreePath = await makeDir("worktree");

    await service.addProject({ projectRootPath });
    await service.bindWorktree({ projectRootPath, worktreePath });
    expect(await existsProjectFile(projectRootPath)).toBe(true);

    const result = await service.removeProject({ projectRootPath });
    expect(result.projects).toHaveLength(0);
    expect(result.worktreeBindings).toHaveLength(0);
    expect(await existsProjectFile(projectRootPath)).toBe(false);
  });

  it("resolveProject reads .pier/environment.json directly bypassing registration", async () => {
    const projectRootPath = await makeDir("repo");
    const canonical = await realpath(projectRootPath);
    await mkdir(join(projectRootPath, ".pier"));
    await writeFile(
      join(projectRootPath, ".pier", "environment.json"),
      JSON.stringify({
        cleanupCommand: "cleanup",
        copyPatterns: [".env"],
        env: {},
        setupCommand: "setup",
        updatedAt: 42,
        version: 1,
      }),
      "utf8"
    );

    // Not registered globally, yet resolveProject returns the file contents.
    const result = await service.resolveProject(projectRootPath);
    expect(result).toMatchObject({
      cleanupCommand: "cleanup",
      copyPatterns: [".env"],
      projectRootPath: canonical,
      setupCommand: "setup",
      updatedAt: 42,
    });
  });

  it("resolveProject returns null when .pier/environment.json is missing", async () => {
    const projectRootPath = await makeDir("repo");

    // Even after addProject seeds the file, deleting it yields null on resolve.
    await service.addProject({ projectRootPath });
    const filePath = join(projectRootPath, ".pier", "environment.json");
    await rm(filePath);

    await expect(service.resolveProject(projectRootPath)).resolves.toBeNull();
  });

  it("concurrent first reads of a corrupt state file wait for initialization", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await writeFile(stateFilePath, "{ malformed", "utf8");

    await expect(
      Promise.all([service.snapshot(), service.snapshot()])
    ).resolves.toStrictEqual([
      { projects: [], version: 1, worktreeBindings: [] },
      { projects: [], version: 1, worktreeBindings: [] },
    ]);
    expect(warn).toHaveBeenCalled();
  });

  it("malformed JSON resets to defaults and does not block later writes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await writeFile(stateFilePath, "{ malformed", "utf8");

    await expect(service.snapshot()).resolves.toStrictEqual({
      projects: [],
      version: 1,
      worktreeBindings: [],
    });
    expect(warn).toHaveBeenCalled();

    const projectRootPath = await makeDir("repo");
    await service.addProject({ projectRootPath });

    await expect(readWrittenState()).resolves.toMatchObject({
      projects: [
        expect.objectContaining({
          projectRootPath: await realpath(projectRootPath),
        }),
      ],
      version: 1,
      worktreeBindings: [],
    });
  });
});
