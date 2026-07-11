import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createLocalControlTransport } from "@main/adapters/cli/local-command-client.ts";
import {
  createPierLocalControlServer,
  resolveLocalControlSocketPath,
} from "@main/adapters/cli/local-control-server.ts";
import { createClientRegistry } from "@main/app-core/client-registry.ts";
import {
  createCommandRouter,
  type PierCoreServices,
} from "@main/app-core/command-router.ts";
import { PluginDisableTransitionCoordinator } from "@main/app-core/plugin-disable-transition.ts";
import { createGitService } from "@main/services/git-service.ts";
import { createGitWatchService } from "@main/services/git-watch-service.ts";
import { createTaskService } from "@main/services/tasks/task-service.ts";
import { createWorktreeService } from "@main/services/worktree-service.ts";
import {
  type PierCommandEnvelope,
  pierCommandEnvelopeSchema,
} from "@shared/contracts/commands.ts";
import { DEFAULT_CAPABILITIES_BY_CLIENT_KIND } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { afterEach, describe, expect, it } from "vitest";
import { makeFakePreferences } from "../../setup/preferences-fixture.ts";

const tempDirs: string[] = [];
const WINDOWS_NAMED_PIPE_PATTERN = /^\\\\\.\\pipe\\pier-control-[a-f0-9]{16}$/;
const execFileAsync = promisify(execFile);

function expectedFallbackSocketPath(userDataDir: string): string {
  const suffix = createHash("sha256")
    .update(userDataDir)
    .digest("hex")
    .slice(0, 16);
  return join(tmpdir(), `pier-control-${suffix}.sock`);
}

async function sendRawRequest(
  socketPath: string,
  payload: string
): Promise<string> {
  const net = await import("node:net");
  return new Promise<string>((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let body = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      body += chunk;
    });
    socket.on("error", reject);
    socket.on("end", () => resolve(body.trim()));
    socket.write(`${payload}\n`);
  });
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pier-local-control-"));
  tempDirs.push(dir);
  return dir;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}

async function initRepo(): Promise<string> {
  const repo = join(await makeTempDir(), "repo");
  await execFileAsync("git", ["init", "-b", "main", repo]);
  await git(repo, ["config", "user.email", "pier@example.com"]);
  await git(repo, ["config", "user.name", "Pier Test"]);
  await writeFile(join(repo, "README.md"), "pier\n");
  await git(repo, ["add", "README.md"]);
  await git(repo, ["commit", "-m", "init"]);
  return await realpath(repo);
}

function pluginEntry(id: string, enabled: boolean): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      missionControlWidgets: [],
      settingsPages: [],
      engines: { pier: ">=0.1.0" },
      id,
      name: id,
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: {
      canToggle: true,
      enabled,
      kind: "builtin",
    },
  };
}

function emptyEnvironmentState() {
  return { projects: [], version: 1 as const, worktreeBindings: [] };
}

function cliClientServices(): PierCoreServices {
  return {
    managedPlugins: {} as never,
    appUpdates: {
      check: async () => ({ currentVersion: "0.1.0", state: "disabled" }),
      download: async () => ({ currentVersion: "0.1.0", state: "disabled" }),
      getStatus: () => ({ currentVersion: "0.1.0", state: "disabled" }),
      quitAndInstall: () => undefined,
    },
    ai: {
      generateText: async () => ({
        message: "not configured",
        reason: "not_configured",
        status: "unavailable",
      }),
      status: async () => ({ agent: null, configured: false, label: "" }),
    },
    commandPaletteMru: {
      clear: async () => ({ entries: [], version: 1 }),
      read: async () => ({ entries: [], version: 1 }),
      recordUse: async () => undefined,
    },
    panelContexts: {
      listRecent: async () => [],
      recordRecent: async () => undefined,
      resolveForPath: async (path) => ({
        contextId: `ctx:${path}`,
        cwd: path,
        openedPath: path,
        projectRootPath: path,
        source: "command",
        updatedAt: 1_772_000_000_000,
        worktreeKey: path,
      }),
    },
    localEnvironments: {
      addProject: async () => emptyEnvironmentState(),
      bindWorktree: async () => undefined,
      clearWorktreeBinding: async () => undefined,
      projectSnapshot: async () => null,
      removeProject: async () => emptyEnvironmentState(),
      resolveProject: async () => null,
      resolveForWorktree: async () => null,
      runLifecycle: async () => undefined,
      snapshot: async () => emptyEnvironmentState(),
      updateProject: async () => emptyEnvironmentState(),
      worktreeBinding: async () => null,
    },
    secrets: {
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined,
      list: async () => [],
      flush: async () => undefined,
    },
    plugins: {
      inspect: async () => null,
      list: async () => ({ diagnostics: [], entries: [] }),
      setEnabled: async (id, enabled) => pluginEntry(id, enabled),
    },
    pluginDisableTransitions: new PluginDisableTransitionCoordinator(),
    pluginSettings: {
      getAll: async () => ({ values: {}, version: 1 }),
      getValues: () => ({}),
      init: async () => undefined,
      invalidateCache: () => undefined,
      onDidChange: () => () => undefined,
      reset: async () => ({ values: {}, version: 1 }),
      set: async () => ({ values: {}, version: 1 }),
    },
    preferences: {
      read: async () => makeFakePreferences({ agentStatusHooks: false }),
      update: async (patch) =>
        makeFakePreferences({ agentStatusHooks: false, ...patch }),
    },
    processEnvironment: {
      resolve: async (request) => ({
        diagnostics: {
          cacheHit: false,
          pathChanged: false,
          shellEnvStatus: "skipped",
          source: request.source,
        },
        env: {
          ...(request.clientEnv ?? {}),
          ...(request.profileEnv ?? {}),
          ...(request.explicitEnv ?? {}),
        },
      }),
    },
    rendererCommand: {
      execute: async () => ({
        error: {
          code: "platform_unavailable",
          message: "renderer unavailable",
        },
        ok: false,
        requestId: "renderer-unavailable",
      }),
      resolve: () => undefined,
    },
    tasks: createTaskService({
      readRecentState: () => Promise.resolve({ entries: [], version: 1 }),
      writeRecentState: () => Promise.resolve(),
    }),
    terminalLaunches: {
      consume: async () => null,
      discard: async () => undefined,
      read: async () => null,
      register: async () => "launch-1",
    },
    terminalProfiles: {
      delete: async () => false,
      list: async () => ({}),
      read: async () => null,
      resolve: async () => null,
      upsert: async (_profileId, profile) => profile,
    },
    terminalStatusBarPrefs: {
      applyOverrides: () => Promise.resolve({ items: {}, version: 1 }),
      getAll: () => Promise.resolve({ items: {}, version: 1 }),
      resetItem: () => Promise.resolve({ items: {}, version: 1 }),
      setItemOverride: () => Promise.resolve({ items: {}, version: 1 }),
    },
    window: {
      close: async () => "closed" as const,
      create: async () => ({ recordId: "record-main", windowId: "main" }),
      flushOpenWindows: async () => undefined,
      flushWindow: async () => undefined,
      focus: () => undefined,
      list: () => [{ focused: true, id: "main", recordId: "record-main" }],
      restoreMostRecentClosed: async () => null,
      restoreOpenWindows: async () => [],
    },
    workspace: {
      clearLayout: async () => undefined,
      readLayout: async () => null,
      saveLayout: async () => undefined,
    },
    worktrees: createWorktreeService(),
    git: createGitService(),
    gitWatch: createGitWatchService(),
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("resolveLocalControlSocketPath", () => {
  it("在 Unix 平台把 socket 放在 userData 下", () => {
    expect(resolveLocalControlSocketPath("/tmp/pier-user-data", "darwin")).toBe(
      "/tmp/pier-user-data/pier-control.sock"
    );
  });

  it("在 Unix socket 路径过长时回退到稳定短路径", () => {
    const userDataDir = `/Users/sheep/Library/Application Support/Pier-dev/${"very-long-worktree-name-".repeat(4)}`;

    expect(resolveLocalControlSocketPath(userDataDir, "darwin")).toBe(
      expectedFallbackSocketPath(userDataDir)
    );
  });

  it("在 Windows 平台使用稳定 named pipe 路径", () => {
    expect(resolveLocalControlSocketPath("C:/Users/me/Pier", "win32")).toMatch(
      WINDOWS_NAMED_PIPE_PATTERN
    );
  });
});

describe("local control socket", () => {
  it("aborts startup cleanly and leaves close idempotent", async () => {
    const userDataDir = await makeTempDir();
    const socketPath = resolveLocalControlSocketPath(userDataDir, "darwin");
    const server = createPierLocalControlServer({
      handleRequest: async () => ({
        data: null,
        ok: true,
        requestId: "unused",
      }),
      socketPath,
    });
    const abortController = new AbortController();
    abortController.abort();

    await expect(server.start(abortController.signal)).rejects.toThrow();
    await expect(server.close()).resolves.toBeUndefined();
    await expect(server.close()).resolves.toBeUndefined();
  });

  it("CLI transport 能向本机控制 server 发送命令信封并读取结果", async () => {
    const userDataDir = await makeTempDir();
    const socketPath = resolveLocalControlSocketPath(userDataDir, "darwin");
    const seen: PierCommandEnvelope[] = [];
    const server = createPierLocalControlServer({
      handleRequest(envelope) {
        const parsed = pierCommandEnvelopeSchema.parse(envelope);
        seen.push(parsed);
        return Promise.resolve({
          data: [{ focused: true, id: "main", recordId: "record-main" }],
          ok: true,
          requestId: parsed.requestId,
        });
      },
      socketPath,
    });

    await server.start();
    const transport = createLocalControlTransport({ socketPath });

    await expect(
      transport.request({
        clientId: "cli-local",
        command: { type: "window.list" },
        protocolVersion: 1,
        requestId: "req-1",
      })
    ).resolves.toEqual({
      data: [{ focused: true, id: "main", recordId: "record-main" }],
      ok: true,
      requestId: "req-1",
    });
    expect(seen).toEqual([
      {
        clientId: "cli-local",
        command: { type: "window.list" },
        protocolVersion: 1,
        requestId: "req-1",
      },
    ]);

    await server.close();
  });

  it("close 会主动终止未发送换行的半开连接", async () => {
    const userDataDir = await makeTempDir();
    const socketPath = resolveLocalControlSocketPath(userDataDir, "darwin");
    const server = createPierLocalControlServer({
      handleRequest: async () => ({
        data: null,
        ok: true,
        requestId: "unused",
      }),
      socketPath,
    });
    await server.start();
    const net = await import("node:net");
    const socket = net.createConnection(socketPath);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    socket.write('{"requestId":"half-open"');
    const socketClosed = new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
    });

    await expect(server.close()).resolves.toBeUndefined();
    await socketClosed;
    expect(socket.destroyed).toBe(true);
  });

  it("通过 socket 执行 worktree list/create/remove 的真实 Git 闭环", async () => {
    const userDataDir = await makeTempDir();
    const repo = await initRepo();
    const linked = join(`${repo}.worktree`, "feature-a");
    const socketPath = resolveLocalControlSocketPath(userDataDir, "darwin");
    const clients = createClientRegistry(() => 1_772_000_000_000);
    clients.register({
      capabilities: DEFAULT_CAPABILITIES_BY_CLIENT_KIND["cli-local"],
      createdAt: 1_772_000_000_000,
      id: "cli-local",
      kind: "cli-local",
      lastSeenAt: 1_772_000_000_000,
    });
    const router = createCommandRouter({
      clients,
      services: cliClientServices(),
    });
    const server = createPierLocalControlServer({
      handleRequest: (envelope) => router.execute(envelope),
      socketPath,
    });
    await server.start();
    const transport = createLocalControlTransport({ socketPath });

    try {
      await expect(
        transport.request({
          clientId: "cli-local",
          command: { path: repo, type: "worktree.list" },
          protocolVersion: 1,
          requestId: "req-worktree-list",
        })
      ).resolves.toMatchObject({
        data: { status: "available", worktrees: [{ path: repo }] },
        ok: true,
        requestId: "req-worktree-list",
      });

      await expect(
        transport.request({
          clientId: "cli-local",
          command: {
            base: "main",
            branch: "feature/a",
            name: "feature-a",
            path: repo,
            type: "worktree.create",
          },
          protocolVersion: 1,
          requestId: "req-worktree-create",
        })
      ).resolves.toMatchObject({
        data: {
          created: { branch: "feature/a", path: linked },
          targetPath: linked,
        },
        ok: true,
        requestId: "req-worktree-create",
      });

      await expect(
        transport.request({
          clientId: "cli-local",
          command: {
            currentPath: linked,
            path: linked,
            type: "worktree.remove",
          },
          protocolVersion: 1,
          requestId: "req-worktree-remove-current",
        })
      ).resolves.toEqual({
        error: {
          code: "current_worktree",
          message: "cannot remove the current worktree",
        },
        ok: false,
        requestId: "req-worktree-remove-current",
      });

      await expect(
        transport.request({
          clientId: "cli-local",
          command: {
            currentPath: repo,
            path: linked,
            type: "worktree.remove",
          },
          protocolVersion: 1,
          requestId: "req-worktree-remove",
        })
      ).resolves.toMatchObject({
        data: {
          removedPath: linked,
          worktrees: [{ isMain: true, path: repo }],
        },
        ok: true,
        requestId: "req-worktree-remove",
      });
      expect(
        await git(repo, ["worktree", "list", "--porcelain"])
      ).not.toContain(linked);
    } finally {
      await server.close();
    }
  });

  it("server 对非法 JSON 返回 invalid_command", async () => {
    const userDataDir = await makeTempDir();
    const socketPath = resolveLocalControlSocketPath(userDataDir, "darwin");
    const server = createPierLocalControlServer({
      handleRequest() {
        throw new Error("should not be called");
      },
      socketPath,
    });
    await server.start();

    const response = await sendRawRequest(socketPath, "{not json}");

    expect(JSON.parse(response)).toEqual({
      error: {
        code: "invalid_command",
        message: "invalid JSON request",
      },
      ok: false,
      requestId: "unknown",
    });

    await server.close();
  });

  it("server 对同步抛错的 handler 返回 internal_error", async () => {
    const userDataDir = await makeTempDir();
    const socketPath = resolveLocalControlSocketPath(userDataDir, "darwin");
    const server = createPierLocalControlServer({
      handleRequest() {
        throw new Error("boom");
      },
      socketPath,
    });
    await server.start();

    const response = await sendRawRequest(
      socketPath,
      JSON.stringify({ requestId: "req-sync-throw" })
    );

    expect(JSON.parse(response)).toEqual({
      error: {
        code: "internal_error",
        message: "boom",
      },
      ok: false,
      requestId: "req-sync-throw",
    });

    await server.close();
  });
});
