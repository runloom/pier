import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PierClient } from "@shared/contracts/permissions.ts";
import { DEFAULT_CAPABILITIES_BY_CLIENT_KIND } from "@shared/contracts/permissions.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}

async function initRepo(): Promise<string> {
  const repo = await makeTempDir("pier-app-core-worktree-repo-");
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.email", "pier@example.com"]);
  await git(repo, ["config", "user.name", "Pier Test"]);
  await writeFile(join(repo, "README.md"), "pier\n");
  await git(repo, ["add", "README.md"]);
  await git(repo, ["commit", "-m", "init"]);
  return repo;
}

function mockElectron(userDataDir: string): void {
  const appMock = {
    focus: vi.fn(),
    getLocale: vi.fn(() => "en-US"),
    getPath: vi.fn((name: string) => {
      if (name !== "userData") {
        throw new Error(`unexpected app.getPath(${name})`);
      }
      return userDataDir;
    }),
    getVersion: vi.fn(() => "0.1.0"),
    isPackaged: false,
    name: "Pier",
    on: vi.fn(),
    quit: vi.fn(),
  };

  const MockWindow = Object.assign(vi.fn(), {
    fromId: vi.fn(() => null),
    getAllWindows: vi.fn(() => []),
  });

  vi.doMock("electron", () => ({
    app: appMock,
    BaseWindow: MockWindow,
    BrowserWindow: MockWindow,
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
      removeHandler: vi.fn(),
      removeListener: vi.fn(),
    },
    nativeTheme: {
      off: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
      shouldUseDarkColors: false,
    },
    safeStorage: {
      decryptString: vi.fn(() => ""),
      encryptString: vi.fn((value: string) => Buffer.from(value)),
      isEncryptionAvailable: vi.fn(() => false),
    },
    shell: {
      openExternal: vi.fn(),
      openPath: vi.fn(),
      showItemInFolder: vi.fn(),
    },
    WebContentsView: MockWindow,
  }));
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.doUnmock("electron");
  vi.resetModules();
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("createPierAppCore worktree service graph", () => {
  it("carries worktreeRootPath preference into worktree.creationDefaults without a branchPrefix default", async () => {
    const userDataDir = await makeTempDir("pier-app-core-userdata-");
    const repo = await initRepo();
    const configuredRoot = await makeTempDir("pier-configured-worktree-root-");
    // This test exercises the worktree service graph, not local workspace
    // plugins. Keep per-worktree developer configuration out of its runtime.
    vi.stubEnv("PIER_PLUGIN_MODE", "release");
    mockElectron(userDataDir);

    // 惰性 app core 首次属性访问才构造，因此先安装每例独立的 Electron mock。
    const { appCore } = await import("@main/app-core/app-core.ts");
    await appCore.ready;
    const now = 1_772_000_000_000;
    const clientId = "app-core-worktree-test";
    appCore.clients.register({
      capabilities: DEFAULT_CAPABILITIES_BY_CLIENT_KIND["desktop-renderer"],
      createdAt: now,
      id: clientId,
      kind: "desktop-renderer",
      lastSeenAt: now,
    } satisfies PierClient);
    await appCore.services.preferences.update({
      worktreeBranchPrefix: "legacy/",
      worktreeRootPath: configuredRoot,
    } as never);

    const result = await appCore.commandRouter.execute({
      clientId,
      command: { path: repo, type: "worktree.creationDefaults" },
      protocolVersion: 1,
      requestId: "worktree-defaults-root",
    });

    expect(result).toMatchObject({
      data: { rootPath: configuredRoot },
      ok: true,
      requestId: "worktree-defaults-root",
    });
    expect(result.ok ? result.data : null).not.toHaveProperty("branchPrefix");
  }, 20_000);
});
