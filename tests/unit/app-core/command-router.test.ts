import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClientRegistry } from "@main/app-core/client-registry.ts";
import type { PierCoreServices } from "@main/app-core/command-router.ts";
import { createCommandRouter } from "@main/app-core/command-router.ts";
import { PluginDisableTransitionCoordinator } from "@main/app-core/plugin-disable-transition.ts";
import { createFileService } from "@main/services/file-service.ts";
import { createGitService } from "@main/services/git-service.ts";
import { createGitWatchService } from "@main/services/git-watch-service.ts";
import { LocalEnvironmentServiceError } from "@main/services/local-environments-service.ts";
import { PluginServiceError } from "@main/services/plugin-service.ts";
import type {
  ProcessEnvironmentResolveRequest,
  ProcessEnvironmentResolveResult,
} from "@main/services/process-environment-service.ts";
import { createTaskService } from "@main/services/tasks/task-service.ts";
import { WorktreeServiceError } from "@main/services/worktree-service.ts";
import { agentTabIconId } from "@shared/contracts/agent-session.ts";
import { fileWriteCommitReceiptStorageKey } from "@shared/contracts/file.ts";
import type { PanelContext, PanelSnapshot } from "@shared/contracts/panel.ts";
import {
  DEFAULT_CAPABILITIES_BY_CLIENT_KIND,
  type PierClient,
} from "@shared/contracts/permissions.ts";
import type {
  PluginRegistryEntry,
  PluginSourceKind,
} from "@shared/contracts/plugin.ts";
import type { TaskListResult } from "@shared/contracts/tasks.ts";
import { describe, expect, it, vi } from "vitest";
import { makeFakePreferences } from "../../setup/preferences-fixture.ts";

const now = 1_772_000_000_000;
interface LocalEnvironmentProjectFixture {
  cleanupCommand: string;
  env: Record<string, string>;
  projectRootPath: string;
  setupCommand: string;
  updatedAt: number;
}

interface LocalEnvironmentsFixture {
  addProject: (request: unknown) => Promise<unknown>;
  bindWorktree: (request: unknown) => Promise<void>;
  clearWorktreeBinding: (worktreePath: string) => Promise<void>;
  projectSnapshot: (projectRootPath: string) => Promise<unknown>;
  removeProject: (request: unknown) => Promise<unknown>;
  resolveForWorktree: (worktreePath: string) => Promise<{
    project: LocalEnvironmentProjectFixture;
    projectRootPath: string;
  } | null>;
  resolveProject: (
    projectRootPath: string
  ) => Promise<LocalEnvironmentProjectFixture | null>;
  runLifecycle: (request: unknown) => Promise<void>;
  snapshot: (request?: unknown) => Promise<unknown>;
  updateProject: (request: unknown) => Promise<unknown>;
  worktreeBinding: (request: unknown) => Promise<unknown>;
}

interface WorktreeRemoveHookFixture {
  beforeRemove?: (target: {
    mainPath: string;
    targetPath: string;
  }) => Promise<void>;
}

function emptyEnvironmentState() {
  return { projects: [], version: 1 as const, worktreeBindings: [] };
}

function pierProject(
  overrides: Partial<LocalEnvironmentProjectFixture> = {}
): LocalEnvironmentProjectFixture {
  return {
    cleanupCommand: "pnpm cleanup:worktree",
    env: { NODE_ENV: "development" },
    projectRootPath: "/repo",
    setupCommand: "pnpm setup:worktree",
    updatedAt: now,
    ...overrides,
  };
}

function localEnvironmentsOf(
  services: PierCoreServices
): LocalEnvironmentsFixture {
  const servicesWithLocalEnvironments = services as PierCoreServices & {
    localEnvironments: LocalEnvironmentsFixture;
  };
  return servicesWithLocalEnvironments.localEnvironments;
}

function localEnvironmentScriptError(
  phase: "setup" | "cleanup",
  message = `local environment ${phase} script failed`
) {
  return Object.assign(new Error(message), {
    exitCode: 7,
    phase,
    stderr: "nope\n",
    stdout: "",
  });
}

function registryWith(client: PierClient) {
  const registry = createClientRegistry(() => now);
  registry.register(client);
  return registry;
}

const desktopClient: PierClient = {
  capabilities: DEFAULT_CAPABILITIES_BY_CLIENT_KIND["desktop-renderer"],
  createdAt: now,
  id: "desktop-1",
  kind: "desktop-renderer",
  lastSeenAt: now,
};

function panelContext(path = "/Users/xyz/ABC/pier"): PanelContext {
  return {
    contextId: `ctx:${path}`,
    cwd: path,
    openedPath: path,
    projectRootPath: path,
    source: "command",
    updatedAt: now,
    worktreeKey: path,
  };
}

function panelSnapshot(
  id: string,
  context = panelContext(`/tmp/${id}`),
  active = false
): PanelSnapshot {
  return {
    active,
    context,
    display: { short: id },
    id,
    kind: "terminal",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function pluginEntry(
  id: string,
  enabled: boolean,
  sourceKind: PluginSourceKind = "builtin"
): PluginRegistryEntry {
  const commands = [
    {
      id: "sample.command",
      permissions: [],
      title: "Sample Command",
    },
  ];
  const panels = [
    {
      id: "sample.panel",
      permissions: [],
      title: "Sample Panel",
    },
  ];
  const canToggle = sourceKind === "builtin";
  return {
    effectivePermissions: ["plugin:read"],
    enabled,
    manifest: {
      apiVersion: 1,
      commands,
      missionControlWidgets: [],
      settingsPages: [],
      engines: { pier: ">=0.1.0" },
      id,
      name: id,
      panels,
      permissions: ["plugin:read"],
      source: { kind: sourceKind },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: {
      canToggle,
      enabled: canToggle && enabled,
      kind: canToggle ? "builtin" : "manifest-only",
    },
  };
}

function services(
  rendererCommands: unknown[] = [],
  panelsByWindow: Record<string, PanelSnapshot[]> = {
    main: [
      panelSnapshot("terminal-1", panelContext("/Users/xyz/ABC/pier"), true),
    ],
  },
  terminalLaunches: unknown[] = [],
  resolveEnvironment: (
    request: ProcessEnvironmentResolveRequest
  ) => Promise<ProcessEnvironmentResolveResult> = async (request) => ({
    diagnostics: {
      cacheHit: false,
      pathChanged: Boolean(
        request.clientEnv?.PATH ||
          request.profileEnv?.PATH ||
          request.explicitEnv?.PATH
      ),
      shellEnvStatus: "skipped",
      source: request.source,
    },
    env: {
      ...(request.clientEnv ?? {}),
      ...(request.agentEnv ?? {}),
      ...(request.profileEnv ?? {}),
      ...(request.explicitEnv ?? {}),
    },
  })
): PierCoreServices {
  let recentContexts: PanelContext[] = [];

  return {
    agentDetection: {} as never,
    agentUsage: {
      flush: async () => undefined,
      read: async () => ({ entries: [], version: 1 }),
      recordSuccessfulLaunch: async () => ({ entries: [], version: 1 }),
    },
    usageData: {} as never,
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
    secrets: {
      get: async () => null,
      getEncrypted: async () => null,
      set: async () => undefined,
      setEncrypted: async () => undefined,
      delete: async () => undefined,
      list: async () => [],
      flush: async () => undefined,
    },
    preferences: {
      read: async () => makeFakePreferences({ agentStatusHooks: false }),
      update: async (patch) =>
        makeFakePreferences({ agentStatusHooks: false, ...patch }),
    },
    processEnvironment: {
      resolve: resolveEnvironment,
    },
    localEnvironments: {
      addProject: vi.fn(async () => emptyEnvironmentState()),
      bindWorktree: vi.fn(async () => undefined),
      clearWorktreeBinding: vi.fn(async () => undefined),
      projectSnapshot: vi.fn(async () => null),
      removeProject: vi.fn(async () => emptyEnvironmentState()),
      resolveProject: vi.fn(async () => null),
      resolveForWorktree: vi.fn(async () => null),
      runLifecycle: vi.fn(async () => undefined),
      snapshot: vi.fn(async () => emptyEnvironmentState()),
      updateProject: vi.fn(async () => emptyEnvironmentState()),
      worktreeBinding: vi.fn(async () => null),
    },
    plugins: {
      inspect: async (id) =>
        id === "sample.local"
          ? pluginEntry("sample.local", true, "local")
          : null,
      list: async () => ({
        diagnostics: [],
        entries: [pluginEntry("sample.local", true, "local")],
      }),
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
    panelContexts: {
      listRecent: async () => recentContexts,
      recordRecent: (context) => {
        recentContexts = [
          context,
          ...recentContexts.filter(
            (recent) => recent.worktreeKey !== context.worktreeKey
          ),
        ];
        return Promise.resolve();
      },
      resolveForPath: async (path) => panelContext(path),
    },
    rendererCommand: {
      execute: (command) => {
        rendererCommands.push(command);
        if (command.type === "panel.open" || command.type === "terminal.open") {
          return Promise.resolve({
            data: {
              context: command.context,
              panelId: "terminal-from-renderer",
            },
            ok: true,
            requestId: "renderer-req",
          });
        }
        if (command.type === "panel.list") {
          return Promise.resolve({
            data: panelsByWindow[command.windowId ?? "main"] ?? [],
            ok: true,
            requestId: "renderer-req",
          });
        }
        return Promise.resolve({
          data: null,
          ok: true,
          requestId: "renderer-req",
        });
      },
      resolve: () => undefined,
    },
    tasks: createTaskService({
      processEnvironment: {
        resolve: resolveEnvironment,
      },
      readRecentState: () => Promise.resolve({ entries: [], version: 1 }),
      spawnBackgroundTask: () => ({ kill: () => true }),
      writeRecentState: () => Promise.resolve(),
    }),
    terminalLaunches: {
      consume: async () => null,
      discard: async () => undefined,
      read: async () => null,
      register: (launch) => {
        terminalLaunches.push(launch);
        return "launch-1";
      },
    },
    terminalProfiles: {
      delete: async () => false,
      list: async () => ({ default: {} }),
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
      create: async () => ({ recordId: "record-1", windowId: "w-1" }),
      focus: () => undefined,
      flushOpenWindows: async () => undefined,
      flushWindow: async () => undefined,
      list: () => [{ focused: true, id: "main", recordId: "record-main" }],
      restoreMostRecentClosed: async () => ({
        recordId: "record-closed",
        windowId: "main",
      }),
      restoreOpenWindows: async () => [
        { recordId: "record-open", windowId: "main" },
      ],
    },
    workspace: {
      clearLayout: async () => undefined,
      readLayout: async () => null,
      saveLayout: async () => undefined,
    },
    worktrees: {
      check: async (args) => ({
        currentPath: args.path,
        mainPath: "/repo",
        path: args.path,
        status: "supported",
      }),
      create: async (args) => ({
        created: {
          bare: false,
          branch: args.branch,
          detached: false,
          head: "def456",
          isCurrent: false,
          isMain: false,
          locked: false,
          lockedReason: null,
          path: `/repo/.worktrees/${args.name}`,
          prunable: false,
          prunableReason: null,
        },
        targetPath: `/repo/.worktrees/${args.name}`,
        worktrees: [],
      }),
      list: async (args) => ({
        currentPath: args.path,
        mainPath: "/repo",
        path: args.path,
        status: "available",
        worktrees: [
          {
            bare: false,
            branch: "main",
            detached: false,
            head: "abc123",
            isCurrent: args.path === "/repo",
            isMain: true,
            locked: false,
            lockedReason: null,
            path: "/repo",
            prunable: false,
            prunableReason: null,
          },
          {
            bare: false,
            branch: "feature/a",
            detached: false,
            head: "def456",
            isCurrent: args.path === "/repo/.worktrees/feature-a",
            isMain: false,
            locked: false,
            lockedReason: null,
            path: "/repo/.worktrees/feature-a",
            prunable: false,
            prunableReason: null,
          },
        ],
      }),
      prune: async (args) => ({
        currentPath: args.path,
        mainPath: "/repo",
        path: args.path,
        status: "available",
        worktrees: [],
      }),
      remove: async (args) => ({
        removedPath: args.path,
        worktrees: [],
      }),
      resolveRootPath: async () => "/repo.worktree",
    },
    git: createGitService(),
    gitWatch: createGitWatchService(),
  };
}

describe("createCommandRouter", () => {
  it("routes revision-safe file document commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "pier-file-router-"));
    try {
      await writeFile(join(root, "notes.txt"), "old\n");
      const fakeServices = services();
      fakeServices.files = createFileService();
      const storeCommitReceipt = vi.fn(async () => ({
        generation: 1,
        kind: "stored" as const,
      }));
      fakeServices.fileDrafts = {
        set: storeCommitReceipt,
      } as never;
      const router = createCommandRouter({
        clients: registryWith(desktopClient),
        services: fakeServices,
      });
      await expect(
        router.execute({
          clientId: "desktop-1",
          command: {
            path: "missing.txt",
            root,
            type: "file.readDocument",
          },
          protocolVersion: 1,
          requestId: "req-file-missing-document",
        })
      ).resolves.toMatchObject({
        error: { code: "not_found" },
        ok: false,
      });
      const read = await router.execute({
        clientId: "desktop-1",
        command: { path: "notes.txt", root, type: "file.readDocument" },
        protocolVersion: 1,
        requestId: "req-file-read-document",
      });
      expect(read).toMatchObject({
        data: { contents: "old\n", kind: "text" },
        ok: true,
      });
      if (!(read.ok && typeof read.data === "object" && read.data)) {
        throw new Error("expected file document result");
      }
      const revision = Reflect.get(read.data, "revision");
      if (typeof revision !== "string") {
        throw new Error("expected file revision");
      }

      const write = await router.execute(
        {
          clientId: "desktop-1",
          command: {
            contents: "new\n",
            eol: "lf",
            expected: { kind: "revision", revision },
            format: { bom: false, encoding: "utf8" },
            operationId: "00000000-0000-4000-8000-000000000001",
            path: "notes.txt",
            root,
            type: "file.writeDocument",
          },
          protocolVersion: 1,
          requestId: "req-file-write-document",
        },
        { windowRecordId: "record-main" }
      );
      expect(write).toMatchObject({
        data: { durability: "confirmed", kind: "written" },
        ok: true,
      });
      if (!(write.ok && typeof write.data === "object" && write.data)) {
        throw new Error("expected file write result");
      }
      const writtenRevision = Reflect.get(write.data, "revision");
      if (typeof writtenRevision !== "string") {
        throw new Error("expected written file revision");
      }
      expect(storeCommitReceipt).toHaveBeenCalledWith(
        "record-main",
        fileWriteCommitReceiptStorageKey(
          "00000000-0000-4000-8000-000000000001"
        ),
        1,
        expect.stringContaining(writtenRevision)
      );
      await expect(
        router.execute({
          clientId: "desktop-1",
          command: {
            path: "notes.txt",
            root,
            type: "file.inspectWriteTarget",
          },
          protocolVersion: 1,
          requestId: "req-file-inspect-target",
        })
      ).resolves.toMatchObject({
        data: { kind: "existing", revision: writtenRevision },
        ok: true,
      });
      await expect(
        router.execute({
          clientId: "desktop-1",
          command: {
            expectedRevision: writtenRevision,
            path: "notes.txt",
            root,
            type: "file.confirmDurability",
          },
          protocolVersion: 1,
          requestId: "req-file-confirm-durability",
        })
      ).resolves.toMatchObject({
        data: { kind: "confirmed", revision: writtenRevision },
        ok: true,
      });

      const receiptError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      storeCommitReceipt.mockRejectedValueOnce(new Error("receipt disk full"));
      await expect(
        router.execute(
          {
            clientId: "desktop-1",
            command: {
              contents: "committed despite receipt failure\n",
              eol: "lf",
              expected: { kind: "revision", revision: writtenRevision },
              format: { bom: false, encoding: "utf8" },
              operationId: "00000000-0000-4000-8000-000000000002",
              path: "notes.txt",
              root,
              type: "file.writeDocument",
            },
            protocolVersion: 1,
            requestId: "req-file-write-receipt-failure",
          },
          { windowRecordId: "record-main" }
        )
      ).resolves.toMatchObject({
        data: { committed: true, kind: "written" },
        ok: true,
      });
      expect(receiptError).toHaveBeenCalledWith(
        "[files] file write committed, but its recovery receipt failed:",
        expect.objectContaining({ message: "receipt disk full" })
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("分发通过授权的命令", async () => {
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: services(),
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { type: "window.list" },
        protocolVersion: 1,
        requestId: "req-1",
      })
    ).resolves.toEqual({
      data: [{ focused: true, id: "main", recordId: "record-main" }],
      ok: true,
      requestId: "req-1",
    });
  });

  it("preferences.update 切默认智能体时不覆盖权限确认方式", async () => {
    const patches: unknown[] = [];
    const fakeServices = services();
    fakeServices.preferences.update = (patch) => {
      patches.push(patch);
      return Promise.resolve(
        makeFakePreferences({
          agentPermissionMode: "yolo",
          defaultAgentId: "claude",
        })
      );
    };
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          patch: { defaultAgentId: "claude" },
          type: "preferences.update",
        },
        protocolVersion: 1,
        requestId: "req-default-agent",
      })
    ).resolves.toMatchObject({ ok: true });

    expect(patches).toEqual([{ defaultAgentId: "claude" }]);
  });

  it("preferences.update 切权限确认方式时不覆盖默认智能体", async () => {
    const patches: unknown[] = [];
    const fakeServices = services();
    fakeServices.preferences.update = (patch) => {
      patches.push(patch);
      return Promise.resolve(
        makeFakePreferences({
          agentPermissionMode: "yolo",
          defaultAgentId: "claude",
        })
      );
    };
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          patch: {
            agentDefaultArgs: {},
            agentDefaultEnv: {},
            agentPermissionMode: "yolo",
          },
          type: "preferences.update",
        },
        protocolVersion: 1,
        requestId: "req-agent-permission-mode",
      })
    ).resolves.toMatchObject({ ok: true });

    expect(patches).toEqual([
      {
        agentDefaultArgs: {},
        agentDefaultEnv: {},
        agentPermissionMode: "yolo",
      },
    ]);
  });

  it("ai.generateText 透传 prompt 与项目根路径到 AI service", async () => {
    const generateText = vi.fn(async () => ({
      text: "feature/fix-focus\n",
      status: "ok" as const,
    }));
    const coreServices = services();
    coreServices.ai = {
      status: async () => ({
        agent: "codex",
        configured: true,
        label: "Codex",
      }),
      generateText,
    };
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: coreServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          projectRootPath: "/repo",
          prompt: "修复终端焦点",
          type: "ai.generateText",
        },
        protocolVersion: 1,
        requestId: "req-ai",
      })
    ).resolves.toEqual({
      data: { status: "ok", text: "feature/fix-focus\n" },
      ok: true,
      requestId: "req-ai",
    });
    expect(generateText).toHaveBeenCalledWith({
      projectRootPath: "/repo",
      prompt: "修复终端焦点",
    });
  });

  it("拒绝未知客户端", async () => {
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: services(),
    });

    await expect(
      router.execute({
        clientId: "missing",
        command: { type: "window.list" },
        protocolVersion: 1,
        requestId: "req-2",
      })
    ).resolves.toMatchObject({
      error: { code: "permission_denied", message: "unknown client" },
      ok: false,
      requestId: "req-2",
    });
  });

  it("拒绝 malformed envelope 且保留 requestId", async () => {
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: services(),
    });

    await expect(
      router.execute({ requestId: "req-malformed" })
    ).resolves.toMatchObject({
      error: { code: "invalid_command" },
      ok: false,
      requestId: "req-malformed",
    });
  });

  it("panel.open 在 main 解析 context 后发给 renderer 并记录 recent", async () => {
    const rendererCommands: unknown[] = [];
    const fakeServices = services(rendererCommands);
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          path: "/Users/xyz/ABC/pier",
          placement: "split-right",
          type: "panel.open",
        },
        protocolVersion: 1,
        requestId: "req-open",
      })
    ).resolves.toEqual({
      data: {
        context: panelContext("/Users/xyz/ABC/pier"),
        panelId: "terminal-from-renderer",
      },
      ok: true,
      requestId: "req-open",
    });

    expect(rendererCommands).toEqual([
      {
        context: panelContext("/Users/xyz/ABC/pier"),
        placement: "split-right",
        type: "panel.open",
        windowId: "main",
      },
    ]);

    await expect(fakeServices.panelContexts.listRecent()).resolves.toEqual([
      panelContext("/Users/xyz/ABC/pier"),
    ]);
  });

  it("panel.open 保留 focus:false", async () => {
    const rendererCommands: unknown[] = [];
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: services(rendererCommands),
    });

    await router.execute({
      clientId: "desktop-1",
      command: {
        focus: false,
        path: "/tmp/pier",
        type: "panel.open",
      },
      protocolVersion: 1,
      requestId: "req-open-background",
    });

    expect(rendererCommands[0]).toMatchObject({
      focus: false,
      type: "panel.open",
      windowId: "main",
    });
  });

  it("terminal.open 注册 launch 后发 renderer terminal.open", async () => {
    const rendererCommands: unknown[] = [];
    const terminalLaunches: unknown[] = [];
    const fakeServices = services(
      rendererCommands,
      {
        main: [
          panelSnapshot(
            "terminal-1",
            panelContext("/Users/xyz/ABC/pier"),
            true
          ),
        ],
      },
      terminalLaunches
    );
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          focus: false,
          launch: {
            command: "pnpm test",
            cwd: "/tmp/pier",
            env: {
              PIER_MODE: "dev",
            },
          },
          placement: "split-below",
          type: "terminal.open",
        },
        protocolVersion: 1,
        requestId: "req-terminal-open",
      })
    ).resolves.toEqual({
      data: {
        context: panelContext("/tmp/pier"),
        panelId: "terminal-from-renderer",
        windowId: "main",
      },
      ok: true,
      requestId: "req-terminal-open",
    });

    expect(terminalLaunches).toEqual([
      {
        command: "pnpm test",
        cwd: "/tmp/pier",
        env: {
          PIER_MODE: "dev",
        },
      },
    ]);
    expect(rendererCommands).toEqual([
      {
        context: panelContext("/tmp/pier"),
        focus: false,
        launchId: "launch-1",
        placement: "split-below",
        type: "terminal.open",
        windowId: "main",
      },
    ]);
    await expect(fakeServices.panelContexts.listRecent()).resolves.toEqual([
      panelContext("/tmp/pier"),
    ]);
  });

  it("terminal.open 在注册 launch 前合并 shell、CLI、profile 和显式环境", async () => {
    const rendererCommands: unknown[] = [];
    const terminalLaunches: unknown[] = [];
    const resolveEnvironment = vi.fn(
      async (
        request: ProcessEnvironmentResolveRequest
      ): Promise<ProcessEnvironmentResolveResult> => ({
        diagnostics: {
          cacheHit: false,
          pathChanged: true,
          shellEnvStatus: "resolved",
          source: request.source,
        },
        env: {
          FROM_CLI: request.clientEnv?.FROM_CLI ?? "",
          FROM_EXPLICIT: request.explicitEnv?.FROM_EXPLICIT ?? "",
          FROM_PROFILE: request.profileEnv?.FROM_PROFILE ?? "",
          FROM_SHELL: "shell",
          PATH: request.explicitEnv?.PATH ?? "",
        },
      })
    );
    const fakeServices = services(
      rendererCommands,
      undefined,
      terminalLaunches,
      resolveEnvironment
    );
    Object.assign(fakeServices, {
      terminalProfiles: {
        resolve: vi.fn(async (profileId: string) =>
          profileId === "codex"
            ? {
                command: "codex",
                cwd: "/Users/xyz/ABC/profile-cwd",
                env: { FROM_PROFILE: "profile", PATH: "/profile/bin" },
              }
            : null
        ),
      },
    });
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientEnv: { FROM_CLI: "cli", PATH: "/cli/bin" },
        clientId: "desktop-1",
        command: {
          launch: {
            cwd: "/tmp/pier",
            env: { FROM_EXPLICIT: "explicit", PATH: "/explicit/bin" },
            profileId: "codex",
          },
          type: "terminal.open",
        },
        protocolVersion: 1,
        requestId: "req-terminal-open-env",
      })
    ).resolves.toMatchObject({
      ok: true,
      requestId: "req-terminal-open-env",
    });

    expect(resolveEnvironment).toHaveBeenCalledWith({
      clientEnv: { FROM_CLI: "cli", PATH: "/cli/bin" },
      cwd: "/tmp/pier",
      explicitEnv: { FROM_EXPLICIT: "explicit", PATH: "/explicit/bin" },
      profileEnv: { FROM_PROFILE: "profile", PATH: "/profile/bin" },
      source: "terminal",
    });
    expect(terminalLaunches).toEqual([
      {
        command: "codex",
        cwd: "/tmp/pier",
        env: {
          FROM_CLI: "cli",
          FROM_EXPLICIT: "explicit",
          FROM_PROFILE: "profile",
          FROM_SHELL: "shell",
          PATH: "/explicit/bin",
        },
      },
    ]);
  });

  it("terminal.open 在 renderer command 失败时清理已注册 launch", async () => {
    const rendererCommands: unknown[] = [];
    const terminalLaunches: unknown[] = [];
    const fakeServices = services(
      rendererCommands,
      undefined,
      terminalLaunches
    );
    const discardLaunch = vi.fn();
    Object.assign(fakeServices.terminalLaunches, { discard: discardLaunch });
    fakeServices.rendererCommand.execute = vi.fn((command) => {
      rendererCommands.push(command);
      return Promise.resolve({
        error: {
          code: "platform_unavailable" as const,
          message: "renderer unavailable",
        },
        ok: false as const,
        requestId: "renderer-req",
      });
    });
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          launch: {
            command: "printenv SECRET",
            cwd: "/tmp/pier",
            env: { SECRET: "token" },
          },
          type: "terminal.open",
        },
        protocolVersion: 1,
        requestId: "req-terminal-open-fail",
      })
    ).resolves.toMatchObject({
      error: { message: "renderer unavailable" },
      ok: false,
      requestId: "req-terminal-open-fail",
    });

    expect(terminalLaunches).toEqual([
      {
        command: "printenv SECRET",
        cwd: "/tmp/pier",
        env: { SECRET: "token" },
      },
    ]);
    expect(discardLaunch).toHaveBeenCalledWith("launch-1");
  });

  it("terminal.open 在注册 launch 前解析 profileId 为实际启动参数", async () => {
    const rendererCommands: unknown[] = [];
    const terminalLaunches: unknown[] = [];
    const fakeServices = services(
      rendererCommands,
      undefined,
      terminalLaunches
    );
    Object.assign(fakeServices, {
      terminalProfiles: {
        resolve: vi.fn(async (profileId: string) =>
          profileId === "codex"
            ? {
                command: "codex",
                cwd: "/Users/xyz/ABC/profile-cwd",
                env: { PIER_PROFILE: "codex" },
              }
            : null
        ),
      },
    });
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          launch: {
            cwd: "/tmp/pier",
            env: { PIER_MODE: "dev" },
            profileId: "codex",
          },
          type: "terminal.open",
        },
        protocolVersion: 1,
        requestId: "req-terminal-open-profile",
      })
    ).resolves.toMatchObject({
      ok: true,
      requestId: "req-terminal-open-profile",
    });

    expect(terminalLaunches).toEqual([
      {
        command: "codex",
        cwd: "/tmp/pier",
        env: {
          PIER_MODE: "dev",
          PIER_PROFILE: "codex",
        },
      },
    ]);
  });

  it("terminal.open 用显式 agentId + agentDefaultArgs 解析为命令", async () => {
    const terminalLaunches: unknown[] = [];
    const fakeServices = services([], undefined, terminalLaunches);
    Object.assign(fakeServices, {
      preferences: {
        read: async () =>
          makeFakePreferences({
            agentDefaultArgs: { claude: "--dangerously-skip-permissions" },
          }),
      },
    });
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });
    await router.execute({
      clientId: "desktop-1",
      command: {
        type: "terminal.open",
        launch: { agentId: "claude", cwd: "/tmp/pier" },
      },
      protocolVersion: 1,
      requestId: "r",
    });
    expect(terminalLaunches).toEqual([
      {
        agentId: "claude",
        command: "claude --dangerously-skip-permissions",
        cwd: "/tmp/pier",
      },
    ]);
  });

  it("terminal.open 用显式 agentId 时带上 agentDefaultEnv", async () => {
    const terminalLaunches: unknown[] = [];
    const fakeServices = services([], undefined, terminalLaunches);
    Object.assign(fakeServices, {
      preferences: {
        read: async () =>
          makeFakePreferences({
            agentDefaultEnv: { goose: { GOOSE_MODE: "auto" } },
          }),
      },
    });
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });
    await router.execute({
      clientId: "desktop-1",
      command: {
        type: "terminal.open",
        launch: { agentId: "goose", cwd: "/tmp/pier" },
      },
      protocolVersion: 1,
      requestId: "r-agent-env",
    });
    expect(terminalLaunches).toEqual([
      {
        agentId: "goose",
        command: "goose",
        cwd: "/tmp/pier",
        env: { GOOSE_MODE: "auto" },
      },
    ]);
  });

  it("terminal.open 无 agentId 时保持纯 shell（无命令注入）", async () => {
    const terminalLaunches: unknown[] = [];
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: services([], undefined, terminalLaunches),
    });
    await router.execute({
      clientId: "desktop-1",
      command: { type: "terminal.open", launch: { cwd: "/tmp/pier" } },
      protocolVersion: 1,
      requestId: "r-shell",
    });
    expect(terminalLaunches).toEqual([{ cwd: "/tmp/pier" }]);
  });

  it("terminal.open 显式 launch.command 优先于 agentId", async () => {
    const terminalLaunches: unknown[] = [];
    const fakeServices = services([], undefined, terminalLaunches);
    Object.assign(fakeServices, {
      preferences: {
        read: async () =>
          makeFakePreferences({
            agentDefaultArgs: { claude: "--dangerously-skip-permissions" },
          }),
      },
    });
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });
    await router.execute({
      clientId: "desktop-1",
      command: {
        type: "terminal.open",
        launch: {
          agentId: "claude",
          command: "echo explicit",
          cwd: "/tmp/pier",
        },
      },
      protocolVersion: 1,
      requestId: "r-priority",
    });
    // explicit command wins; the agent's resolved command is NOT used
    expect(terminalLaunches).toEqual([
      { agentId: "claude", command: "echo explicit", cwd: "/tmp/pier" },
    ]);
  });

  it("terminal.open 非法 agentId 在 envelope schema 校验阶段被拒（invalid_command）", async () => {
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: services(),
    });
    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          type: "terminal.open",
          // "not-a-real-agent" is outside agentKindSchema's enum, so the
          // command envelope fails Zod validation before reaching the handler.
          // (The catalog-null branch inside the handler is unreachable because
          // every AgentKind enum member has a catalog entry.)
          launch: { agentId: "not-a-real-agent" as "claude", cwd: "/tmp" },
        },
        protocolVersion: 1,
        requestId: "r-unknown",
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_command" } });
  });

  it("run.list schedules task shell environment prewarm without awaiting it", async () => {
    const projectRootPath = "/repo";
    const listResult = {
      errors: [],
      projectRootPath,
      tasks: [
        {
          commandSpec: { command: "pnpm run test", kind: "shell" },
          concurrencyPolicy: "dedupe",
          cwd: projectRootPath,
          id: "package-script:test",
          label: "test",
          source: "package-script",
        },
      ],
    } satisfies TaskListResult;
    const listReady = deferred<TaskListResult>();
    const listStarted = deferred<void>();
    const prewarmReady = deferred<ProcessEnvironmentResolveResult>();
    const resolveEnvironment = vi.fn(() => prewarmReady.promise);
    const fakeServices = services([], undefined, [], resolveEnvironment);
    fakeServices.tasks = {
      ...fakeServices.tasks,
      list: vi.fn(() => {
        listStarted.resolve();
        return listReady.promise;
      }),
    };
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    const result = router.execute({
      clientId: "desktop-1",
      command: {
        projectRootPath,
        type: "run.list",
      },
      protocolVersion: 1,
      requestId: "req-run-list-prewarm",
    });
    await listStarted.promise;
    expect(fakeServices.tasks.list).toHaveBeenCalledWith({ projectRootPath });
    expect(resolveEnvironment).not.toHaveBeenCalled();

    listReady.resolve(listResult);
    await expect(result).resolves.toEqual({
      data: listResult,
      ok: true,
      requestId: "req-run-list-prewarm",
    });

    expect(resolveEnvironment).toHaveBeenCalledWith({
      cwd: projectRootPath,
      source: "task",
    });

    prewarmReady.resolve({
      diagnostics: {
        cacheHit: false,
        pathChanged: false,
        shellEnvStatus: "resolved",
        source: "task",
      },
      env: {},
    });
  });

  it("run.spawn falls back to a fresh terminal when an already-running panel is stale", async () => {
    const rendererCommands: unknown[] = [];
    const terminalLaunches: unknown[] = [];
    const fakeServices = services(
      rendererCommands,
      undefined,
      terminalLaunches
    );
    fakeServices.tasks.recordStarted({
      panelId: "terminal-stale",
      projectRootPath: process.cwd(),
      taskId: "package-script:test",
      windowId: "main",
    });
    const executeRendererCommand = fakeServices.rendererCommand.execute;
    fakeServices.rendererCommand.execute = vi.fn((command) => {
      rendererCommands.push(command);
      if (command.type === "panel.focus") {
        return Promise.resolve({
          error: {
            code: "not_found" as const,
            message: "panel not found: terminal-stale",
          },
          ok: false as const,
          requestId: "renderer-focus-missing",
        });
      }
      if (command.type === "terminal.open") {
        return Promise.resolve({
          data: {
            context: command.context,
            panelId: "terminal-fresh",
          },
          ok: true as const,
          requestId: "renderer-terminal-open",
        });
      }
      return executeRendererCommand(command);
    });
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    const spawnResult = await router.execute({
      clientId: "desktop-1",
      command: {
        focus: true,
        forceRestart: false,
        placement: "active-tab",
        projectRootPath: process.cwd(),
        taskId: "package-script:test",
        type: "run.spawn",
        windowId: "main",
      },
      protocolVersion: 1,
      requestId: "req-run-spawn-stale-running",
    });

    expect(spawnResult).toMatchObject({
      data: {
        panelIds: ["terminal-fresh"],
        primaryPanelId: "terminal-fresh",
        status: "started",
      },
      ok: true,
      requestId: "req-run-spawn-stale-running",
    });
    expect(rendererCommands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          panelId: "terminal-stale",
          type: "panel.focus",
          windowId: "main",
        }),
        expect.objectContaining({
          type: "terminal.open",
          windowId: "main",
        }),
      ])
    );
    const terminalOpenCommand = rendererCommands.find(
      (command) =>
        typeof command === "object" &&
        command !== null &&
        "type" in command &&
        command.type === "terminal.open"
    );
    expect(terminalOpenCommand).not.toHaveProperty("panelId");
    expect(terminalLaunches).toHaveLength(1);
  });

  it("run.spawn background starts without opening a terminal panel", async () => {
    const rendererCommands: unknown[] = [];
    const terminalLaunches: unknown[] = [];
    const fakeServices = services(
      rendererCommands,
      undefined,
      terminalLaunches
    );
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    const spawnResult = await router.execute({
      clientEnv: { FROM_CLI: "cli" },
      clientId: "desktop-1",
      command: {
        mode: "background",
        projectRootPath: process.cwd(),
        taskId: "package-script:test",
        type: "run.spawn",
        windowId: "main",
      },
      protocolVersion: 1,
      requestId: "req-run-spawn-background",
    });

    expect(spawnResult).toMatchObject({
      data: {
        panelIds: [],
        runId: expect.any(String),
        snapshot: {
          nodes: {
            "package-script:test": {
              status: "running",
              taskId: "package-script:test",
              windowId: "main",
            },
          },
          status: "running",
        },
        status: "started",
      },
      ok: true,
      requestId: "req-run-spawn-background",
    });
    expect(rendererCommands).not.toContainEqual(
      expect.objectContaining({ type: "terminal.open" })
    );
    expect(terminalLaunches).toHaveLength(0);
    expect(fakeServices.tasks.backgroundSnapshot()).toMatchObject({
      runs: {
        [process.cwd()]: {
          "package-script:test": {
            status: "running",
            taskId: "package-script:test",
          },
        },
      },
    });
  });

  it("run.spawn background closes a prior terminal task panel before restarting", async () => {
    const rendererCommands: unknown[] = [];
    const fakeServices = services(rendererCommands);
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await router.execute({
      clientId: "desktop-1",
      command: {
        projectRootPath: process.cwd(),
        taskId: "package-script:test",
        type: "run.spawn",
        windowId: "main",
      },
      protocolVersion: 1,
      requestId: "req-run-spawn-terminal-before-background",
    });
    rendererCommands.length = 0;

    await router.execute({
      clientId: "desktop-1",
      command: {
        mode: "background",
        projectRootPath: process.cwd(),
        taskId: "package-script:test",
        type: "run.spawn",
        windowId: "main",
      },
      protocolVersion: 1,
      requestId: "req-run-spawn-background-restart-terminal",
    });

    expect(rendererCommands).toContainEqual(
      expect.objectContaining({
        panelId: "terminal-from-renderer",
        type: "panel.close",
        windowId: "main",
      })
    );
  });

  it("run.spawn 重新解析任务并复用运行中和已完成的 terminal.open", async () => {
    const rendererCommands: unknown[] = [];
    const terminalLaunches: unknown[] = [];
    const newPanelIdsRequested: string[] = [];
    const resolveEnvironment = vi.fn(
      async (
        request: ProcessEnvironmentResolveRequest
      ): Promise<ProcessEnvironmentResolveResult> => ({
        diagnostics: {
          cacheHit: false,
          pathChanged: true,
          shellEnvStatus: "resolved",
          source: request.source,
        },
        env: {
          FROM_CLI: request.clientEnv?.FROM_CLI ?? "",
          FROM_SHELL: "shell",
          ...(request.explicitEnv ?? {}),
        },
      })
    );
    const fakeServices = services(
      rendererCommands,
      undefined,
      terminalLaunches,
      resolveEnvironment
    );
    fakeServices.terminalLaunches.register = (launch) => {
      terminalLaunches.push(launch);
      return `launch-${terminalLaunches.length}`;
    };
    const executeRendererCommand = fakeServices.rendererCommand.execute;
    fakeServices.rendererCommand.execute = vi.fn((command) => {
      rendererCommands.push(command);
      if (command.type === "terminal.open") {
        if (command.panelId) {
          return Promise.resolve({
            data: {
              context: command.context,
              panelId: command.panelId,
            },
            ok: true as const,
            requestId: "renderer-terminal-reuse",
          });
        }
        const panelId = "terminal-from-renderer";
        newPanelIdsRequested.push(panelId);
        return Promise.resolve({
          data: {
            context: command.context,
            panelId,
          },
          ok: true as const,
          requestId: "renderer-terminal-open",
        });
      }
      return executeRendererCommand(command);
    });
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    const listResult = await router.execute({
      clientId: "desktop-1",
      command: {
        projectRootPath: process.cwd(),
        type: "run.list",
      },
      protocolVersion: 1,
      requestId: "req-run-list",
    });

    expect(listResult).toMatchObject({ ok: true });
    const spawnResult = await router.execute({
      clientEnv: { FROM_CLI: "cli" },
      clientId: "desktop-1",
      command: {
        focus: true,
        projectRootPath: process.cwd(),
        taskId: "package-script:test",
        targetGroupId: "source-group",
        type: "run.spawn",
        windowId: "main",
      },
      protocolVersion: 1,
      requestId: "req-run-spawn",
    });

    expect(spawnResult).toMatchObject({
      data: {
        panelIds: ["terminal-from-renderer"],
        primaryPanelId: "terminal-from-renderer",
        runId: expect.any(String),
        snapshot: {
          nodes: {
            "package-script:test": {
              panelId: "terminal-from-renderer",
              status: "running",
              windowId: "main",
            },
          },
          status: "running",
        },
        status: "started",
      },
      ok: true,
      requestId: "req-run-spawn",
    });
    const spawnData =
      spawnResult.ok &&
      typeof spawnResult.data === "object" &&
      spawnResult.data !== null
        ? spawnResult.data
        : null;
    if (
      !(spawnData && "runId" in spawnData) ||
      typeof spawnData.runId !== "string"
    ) {
      throw new Error("run.spawn did not return a runId");
    }
    const runId = spawnData.runId;
    expect(rendererCommands.at(-1)).toMatchObject({
      launchId: "launch-1",
      targetGroupId: "source-group",
      placement: "active-tab",
      tab: {
        badge: { label: "package.json" },
        icon: { id: "pier.task", label: "Task" },
        state: { label: "Running", status: "running" },
        title: "test",
      },
      task: {
        runId,
        status: "running",
        taskId: "package-script:test",
      },
      type: "terminal.open",
      windowId: "main",
    });
    expect(rendererCommands.at(-1)).not.toHaveProperty("panelId");

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          runId,
          type: "run.status",
        },
        protocolVersion: 1,
        requestId: "req-run-status",
      })
    ).resolves.toMatchObject({
      data: {
        nodes: {
          "package-script:test": {
            panelId: "terminal-from-renderer",
            status: "running",
            windowId: "main",
          },
        },
        runId,
        status: "running",
      },
      ok: true,
      requestId: "req-run-status",
    });

    const secondSpawnResult = await router.execute({
      clientEnv: { FROM_CLI: "cli" },
      clientId: "desktop-1",
      command: {
        projectRootPath: process.cwd(),
        taskId: "package-script:test",
        type: "run.spawn",
        windowId: "main",
      },
      protocolVersion: 1,
      requestId: "req-run-spawn-reuse",
    });

    expect(secondSpawnResult).toMatchObject({
      data: {
        panelIds: ["terminal-from-renderer"],
        primaryPanelId: "terminal-from-renderer",
        runId: expect.any(String),
        snapshot: {
          nodes: {
            "package-script:test": {
              panelId: "terminal-from-renderer",
              status: "running",
              windowId: "main",
            },
          },
          status: "running",
        },
        status: "started",
      },
      ok: true,
      requestId: "req-run-spawn-reuse",
    });
    const secondSpawnData =
      secondSpawnResult.ok &&
      typeof secondSpawnResult.data === "object" &&
      secondSpawnResult.data !== null
        ? secondSpawnResult.data
        : null;
    if (
      !(secondSpawnData && "runId" in secondSpawnData) ||
      typeof secondSpawnData.runId !== "string"
    ) {
      throw new Error("second run.spawn did not return a runId");
    }
    const secondRunId = secondSpawnData.runId;
    expect(secondRunId).not.toBe(runId);
    expect(rendererCommands.at(-1)).toMatchObject({
      launchId: "launch-2",
      panelId: "terminal-from-renderer",
      placement: "active-tab",
      tab: {
        badge: { label: "package.json" },
        icon: { id: "pier.task", label: "Task" },
        state: { label: "Running", status: "running" },
        title: "test",
      },
      task: {
        runId: secondRunId,
        status: "running",
        taskId: "package-script:test",
      },
      type: "terminal.open",
      windowId: "main",
    });

    await expect(
      fakeServices.tasks.completePanel("terminal-from-renderer", 0, "main")
    ).resolves.toMatchObject({
      nodes: {
        "package-script:test": {
          panelId: "terminal-from-renderer",
          status: "succeeded",
          windowId: "main",
        },
      },
      runId: secondRunId,
      status: "succeeded",
    });

    const thirdSpawnResult = await router.execute({
      clientEnv: { FROM_CLI: "cli" },
      clientId: "desktop-1",
      command: {
        projectRootPath: process.cwd(),
        taskId: "package-script:test",
        type: "run.spawn",
        windowId: "main",
      },
      protocolVersion: 1,
      requestId: "req-run-spawn-completed-reuse",
    });

    expect(thirdSpawnResult).toMatchObject({
      data: {
        panelIds: ["terminal-from-renderer"],
        primaryPanelId: "terminal-from-renderer",
        runId: expect.any(String),
        snapshot: {
          nodes: {
            "package-script:test": {
              panelId: "terminal-from-renderer",
              status: "running",
              windowId: "main",
            },
          },
          status: "running",
        },
        status: "started",
      },
      ok: true,
      requestId: "req-run-spawn-completed-reuse",
    });
    const thirdSpawnData =
      thirdSpawnResult.ok &&
      typeof thirdSpawnResult.data === "object" &&
      thirdSpawnResult.data !== null
        ? thirdSpawnResult.data
        : null;
    if (
      !(thirdSpawnData && "runId" in thirdSpawnData) ||
      typeof thirdSpawnData.runId !== "string"
    ) {
      throw new Error("third run.spawn did not return a runId");
    }
    const thirdRunId = thirdSpawnData.runId;
    expect(thirdRunId).not.toBe(secondRunId);
    expect(rendererCommands.at(-1)).toMatchObject({
      launchId: "launch-3",
      panelId: "terminal-from-renderer",
      placement: "active-tab",
      tab: {
        badge: { label: "package.json" },
        icon: { id: "pier.task", label: "Task" },
        state: { label: "Running", status: "running" },
        title: "test",
      },
      task: {
        runId: thirdRunId,
        status: "running",
        taskId: "package-script:test",
      },
      type: "terminal.open",
      windowId: "main",
    });
    expect(newPanelIdsRequested).toEqual(["terminal-from-renderer"]);
    expect(terminalLaunches).toEqual([
      expect.objectContaining({
        command: expect.stringContaining("pnpm run test"),
        cwd: process.cwd(),
        env: expect.objectContaining({
          FROM_CLI: "cli",
          FROM_SHELL: "shell",
        }),
      }),
      expect.objectContaining({
        command: expect.stringContaining("pnpm run test"),
        cwd: process.cwd(),
        env: expect.objectContaining({
          FROM_CLI: "cli",
          FROM_SHELL: "shell",
        }),
      }),
      expect.objectContaining({
        command: expect.stringContaining("pnpm run test"),
        cwd: process.cwd(),
        env: expect.objectContaining({
          FROM_CLI: "cli",
          FROM_SHELL: "shell",
        }),
      }),
    ]);
    expect(resolveEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({
        clientEnv: { FROM_CLI: "cli" },
        cwd: process.cwd(),
        source: "task",
      })
    );
  });

  it("run.spawn 复用调用方指定的任务 terminal panel", async () => {
    const rendererCommands: unknown[] = [];
    const terminalLaunches: unknown[] = [];
    const fakeServices = services(
      rendererCommands,
      undefined,
      terminalLaunches
    );
    const executeRendererCommand = fakeServices.rendererCommand.execute;
    fakeServices.rendererCommand.execute = vi.fn((command) => {
      rendererCommands.push(command);
      if (command.type === "terminal.open") {
        return Promise.resolve({
          data: {
            context: command.context,
            panelId: command.panelId ?? "terminal-from-renderer",
          },
          ok: true as const,
          requestId: "renderer-terminal-open",
        });
      }
      return executeRendererCommand(command);
    });
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          projectRootPath: process.cwd(),
          taskId: "package-script:test",
          terminalPanelId: "terminal-restored-task",
          type: "run.spawn",
          windowId: "main",
        },
        protocolVersion: 1,
        requestId: "req-run-spawn-explicit-panel",
      })
    ).resolves.toMatchObject({
      data: {
        panelIds: ["terminal-restored-task"],
        primaryPanelId: "terminal-restored-task",
        status: "started",
      },
      ok: true,
      requestId: "req-run-spawn-explicit-panel",
    });

    expect(rendererCommands.at(-1)).toMatchObject({
      panelId: "terminal-restored-task",
      type: "terminal.open",
      windowId: "main",
    });
  });

  it("run.spawn 透传 terminal.open 的稳定错误码", async () => {
    const rendererCommands: unknown[] = [];
    const terminalLaunches: unknown[] = [];
    const fakeServices = services(
      rendererCommands,
      undefined,
      terminalLaunches
    );
    fakeServices.rendererCommand.execute = vi.fn((command) => {
      rendererCommands.push(command);
      if (command.type === "terminal.open") {
        return Promise.resolve({
          error: {
            code: "platform_unavailable" as const,
            message: "renderer unavailable",
          },
          ok: false as const,
          requestId: "renderer-terminal-open-failed",
        });
      }
      return Promise.resolve({
        data: [],
        ok: true as const,
        requestId: "renderer-req",
      });
    });
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          projectRootPath: process.cwd(),
          taskId: "package-script:test",
          type: "run.spawn",
          windowId: "main",
        },
        protocolVersion: 1,
        requestId: "req-run-spawn-open-failed",
      })
    ).resolves.toMatchObject({
      error: {
        code: "platform_unavailable",
        message: "renderer unavailable",
      },
      ok: false,
      requestId: "req-run-spawn-open-failed",
    });
  });

  it("run.spawn 在 stale reusable panel not_found 时重试新 terminal.open", async () => {
    const rendererCommands: unknown[] = [];
    const terminalLaunches: unknown[] = [];
    const freshPanelIdsRequested: string[] = [];
    const fakeServices = services(
      rendererCommands,
      undefined,
      terminalLaunches
    );
    fakeServices.terminalLaunches.register = (launch) => {
      terminalLaunches.push(launch);
      return `launch-${terminalLaunches.length}`;
    };
    const executeRendererCommand = fakeServices.rendererCommand.execute;
    fakeServices.rendererCommand.execute = vi.fn((command) => {
      rendererCommands.push(command);
      if (command.type === "terminal.open") {
        if (command.panelId === "missing-panel") {
          return Promise.resolve({
            error: {
              code: "not_found" as const,
              message: "panel not found: missing-panel",
            },
            ok: false as const,
            requestId: "renderer-terminal-reuse-missing",
          });
        }
        const panelId = "terminal-after-stale-retry";
        freshPanelIdsRequested.push(panelId);
        return Promise.resolve({
          data: {
            context: command.context,
            panelId,
          },
          ok: true as const,
          requestId: "renderer-terminal-open",
        });
      }
      return executeRendererCommand(command);
    });
    fakeServices.tasks.recordStarted({
      panelId: "missing-panel",
      projectRootPath: process.cwd(),
      taskId: "package-script:test",
      windowId: "main",
    });
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    const spawnCommand = {
      projectRootPath: process.cwd(),
      taskId: "package-script:test",
      type: "run.spawn" as const,
      windowId: "main",
    };

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: spawnCommand,
        protocolVersion: 1,
        requestId: "req-run-stale-reuse",
      })
    ).resolves.toMatchObject({
      data: {
        primaryPanelId: "terminal-after-stale-retry",
        status: "started",
      },
      ok: true,
      requestId: "req-run-stale-reuse",
    });

    expect(rendererCommands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          launchId: "launch-1",
          panelId: "missing-panel",
          type: "terminal.open",
          windowId: "main",
        }),
        expect.objectContaining({
          launchId: "launch-2",
          type: "terminal.open",
          windowId: "main",
        }),
      ])
    );
    expect(rendererCommands.at(-1)).toMatchObject({
      launchId: "launch-2",
      type: "terminal.open",
      windowId: "main",
    });
    expect(rendererCommands.at(-1)).not.toHaveProperty("panelId");
    expect(freshPanelIdsRequested).toEqual(["terminal-after-stale-retry"]);

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: spawnCommand,
        protocolVersion: 1,
        requestId: "req-run-reuse-after-stale-retry",
      })
    ).resolves.toMatchObject({
      data: {
        primaryPanelId: "terminal-after-stale-retry",
        status: "started",
      },
      ok: true,
      requestId: "req-run-reuse-after-stale-retry",
    });

    expect(rendererCommands.at(-1)).toMatchObject({
      launchId: "launch-3",
      panelId: "terminal-after-stale-retry",
      type: "terminal.open",
      windowId: "main",
    });
    expect(freshPanelIdsRequested).toEqual([
      "terminal-after-stale-retry",
      "terminal-after-stale-retry",
    ]);
  });

  it("run.spawn 在后续 terminal.open 失败时关闭已重启的任务 panel", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "pier-run-partial-"));
    try {
      await mkdir(join(projectRoot, ".vscode"));
      await writeFile(
        join(projectRoot, ".vscode", "tasks.json"),
        JSON.stringify({
          tasks: [
            {
              command: "echo client",
              label: "client",
              type: "shell",
            },
            {
              command: "echo server",
              label: "server",
              type: "shell",
            },
            {
              command: "echo verify",
              dependsOn: ["client", "server"],
              dependsOrder: "parallel",
              label: "verify",
              type: "shell",
            },
          ],
          version: "2.0.0",
        })
      );
      const rendererCommands: unknown[] = [];
      const terminalLaunches: unknown[] = [];
      const fakeServices = services(
        rendererCommands,
        undefined,
        terminalLaunches
      );
      fakeServices.terminalLaunches.register = (launch) => {
        terminalLaunches.push(launch);
        return `launch-${terminalLaunches.length}`;
      };
      const executeRendererCommand = fakeServices.rendererCommand.execute;
      fakeServices.rendererCommand.execute = vi.fn((command) => {
        rendererCommands.push(command);
        if (command.type === "terminal.open") {
          if (command.panelId === "panel-client-reuse") {
            return Promise.resolve({
              data: {
                context: command.context,
                panelId: command.panelId,
              },
              ok: true as const,
              requestId: "renderer-terminal-reuse",
            });
          }
          if (command.launchId === "launch-2") {
            return Promise.resolve({
              error: {
                code: "platform_unavailable" as const,
                message: "renderer unavailable",
              },
              ok: false as const,
              requestId: "renderer-terminal-open-failed",
            });
          }
          return Promise.resolve({
            data: {
              context: command.context,
              panelId: `panel-${command.launchId}`,
            },
            ok: true as const,
            requestId: "renderer-terminal-open",
          });
        }
        return executeRendererCommand(command);
      });
      const router = createCommandRouter({
        clients: registryWith(desktopClient),
        services: fakeServices,
      });
      const listResult = await router.execute({
        clientId: "desktop-1",
        command: {
          projectRootPath: projectRoot,
          type: "run.list",
        },
        protocolVersion: 1,
        requestId: "req-run-partial-list",
      });
      const tasks =
        listResult.ok &&
        typeof listResult.data === "object" &&
        listResult.data &&
        "tasks" in listResult.data &&
        Array.isArray(listResult.data.tasks)
          ? listResult.data.tasks
          : [];
      const verifyTask = tasks.find(
        (task) =>
          task &&
          typeof task === "object" &&
          "label" in task &&
          task.label === "verify" &&
          "id" in task &&
          typeof task.id === "string"
      );
      const clientTask = tasks.find(
        (task) =>
          task &&
          typeof task === "object" &&
          "label" in task &&
          task.label === "client" &&
          "id" in task &&
          typeof task.id === "string"
      );
      if (typeof clientTask?.id !== "string") {
        throw new Error("client task not found");
      }
      fakeServices.tasks.recordStarted({
        panelId: "panel-client-reuse",
        projectRootPath: projectRoot,
        taskId: clientTask.id,
        windowId: "main",
      });

      await expect(
        router.execute({
          clientId: "desktop-1",
          command: {
            projectRootPath: projectRoot,
            taskId: verifyTask?.id ?? "",
            type: "run.spawn",
            windowId: "main",
          },
          protocolVersion: 1,
          requestId: "req-run-partial-spawn",
        })
      ).resolves.toMatchObject({
        error: {
          code: "platform_unavailable",
          message: "renderer unavailable",
        },
        ok: false,
        requestId: "req-run-partial-spawn",
      });

      expect(rendererCommands).toContainEqual(
        expect.objectContaining({
          launchId: "launch-1",
          panelId: "panel-client-reuse",
          type: "terminal.open",
          windowId: "main",
        })
      );
      expect(rendererCommands).toContainEqual(
        expect.objectContaining({
          panelId: "panel-client-reuse",
          type: "panel.close",
          windowId: "main",
        })
      );
      expect(rendererCommands).not.toContainEqual(
        expect.objectContaining({
          panelId: "panel-launch-1",
          type: "panel.close",
          windowId: "main",
        })
      );
      await expect(
        router.execute({
          clientId: "desktop-1",
          command: {
            projectRootPath: projectRoot,
            taskId: clientTask.id,
            type: "run.spawn",
            windowId: "main",
          },
          protocolVersion: 1,
          requestId: "req-run-partial-client",
        })
      ).resolves.toMatchObject({
        data: { status: "started" },
        ok: true,
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  it("run.spawn 在重启后的 panel.close 失败时保留任务登记", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "pier-run-close-fail-"));
    try {
      await mkdir(join(projectRoot, ".vscode"));
      await writeFile(
        join(projectRoot, ".vscode", "tasks.json"),
        JSON.stringify({
          tasks: [
            {
              command: "echo client",
              label: "client",
              type: "shell",
            },
            {
              command: "echo server",
              label: "server",
              type: "shell",
            },
            {
              command: "echo verify",
              dependsOn: ["client", "server"],
              dependsOrder: "parallel",
              label: "verify",
              type: "shell",
            },
          ],
          version: "2.0.0",
        })
      );
      const rendererCommands: unknown[] = [];
      const terminalLaunches: unknown[] = [];
      const fakeServices = services(
        rendererCommands,
        undefined,
        terminalLaunches
      );
      fakeServices.terminalLaunches.register = (launch) => {
        terminalLaunches.push(launch);
        return `launch-${terminalLaunches.length}`;
      };
      const executeRendererCommand = fakeServices.rendererCommand.execute;
      fakeServices.rendererCommand.execute = vi.fn((command) => {
        rendererCommands.push(command);
        if (command.type === "terminal.open") {
          if (command.panelId === "panel-client-reuse") {
            return Promise.resolve({
              data: {
                context: command.context,
                panelId: command.panelId,
              },
              ok: true as const,
              requestId: "renderer-terminal-reuse",
            });
          }
          if (command.launchId === "launch-2") {
            return Promise.resolve({
              error: {
                code: "platform_unavailable" as const,
                message: "renderer unavailable",
              },
              ok: false as const,
              requestId: "renderer-terminal-open-failed",
            });
          }
          return Promise.resolve({
            data: {
              context: command.context,
              panelId: `panel-${command.launchId}`,
            },
            ok: true as const,
            requestId: "renderer-terminal-open",
          });
        }
        if (command.type === "panel.close") {
          return Promise.resolve({
            error: {
              code: "platform_unavailable" as const,
              message: "close failed",
            },
            ok: false as const,
            requestId: "renderer-close-failed",
          });
        }
        return executeRendererCommand(command);
      });
      const router = createCommandRouter({
        clients: registryWith(desktopClient),
        services: fakeServices,
      });
      const listResult = await router.execute({
        clientId: "desktop-1",
        command: {
          projectRootPath: projectRoot,
          type: "run.list",
        },
        protocolVersion: 1,
        requestId: "req-run-close-fail-list",
      });
      const tasks =
        listResult.ok &&
        typeof listResult.data === "object" &&
        listResult.data &&
        "tasks" in listResult.data &&
        Array.isArray(listResult.data.tasks)
          ? listResult.data.tasks
          : [];
      const verifyTask = tasks.find(
        (task) =>
          task &&
          typeof task === "object" &&
          "label" in task &&
          task.label === "verify" &&
          "id" in task &&
          typeof task.id === "string"
      );
      const clientTask = tasks.find(
        (task) =>
          task &&
          typeof task === "object" &&
          "label" in task &&
          task.label === "client" &&
          "id" in task &&
          typeof task.id === "string"
      );
      if (typeof clientTask?.id !== "string") {
        throw new Error("client task not found");
      }
      fakeServices.tasks.recordStarted({
        panelId: "panel-client-reuse",
        projectRootPath: projectRoot,
        taskId: clientTask.id,
        windowId: "main",
      });

      await expect(
        router.execute({
          clientId: "desktop-1",
          command: {
            projectRootPath: projectRoot,
            taskId: verifyTask?.id ?? "",
            type: "run.spawn",
            windowId: "main",
          },
          protocolVersion: 1,
          requestId: "req-run-close-fail-spawn",
        })
      ).resolves.toMatchObject({
        error: {
          code: "platform_unavailable",
          message: "close failed",
        },
        ok: false,
        requestId: "req-run-close-fail-spawn",
      });

      expect(rendererCommands).toContainEqual(
        expect.objectContaining({
          panelId: "panel-client-reuse",
          type: "panel.close",
          windowId: "main",
        })
      );
      await expect(
        router.execute({
          clientId: "desktop-1",
          command: {
            projectRootPath: projectRoot,
            taskId: clientTask.id,
            type: "run.spawn",
            windowId: "main",
          },
          protocolVersion: 1,
          requestId: "req-run-close-fail-client",
        })
      ).resolves.toMatchObject({
        data: {
          primaryPanelId: "panel-client-reuse",
          status: "started",
        },
        ok: true,
      });
      expect(rendererCommands.at(-1)).toMatchObject({
        panelId: "panel-client-reuse",
        type: "terminal.open",
        windowId: "main",
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  it("run.cancel 使用启动时记录的窗口关闭面板", async () => {
    const rendererCommands: unknown[] = [];
    const fakeServices = services(rendererCommands);
    fakeServices.window.list = () => [
      { focused: true, id: "main", recordId: "record-main" },
      { focused: false, id: "secondary", recordId: "record-secondary" },
    ];
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    const spawnResult = await router.execute({
      clientId: "desktop-1",
      command: {
        projectRootPath: process.cwd(),
        taskId: "package-script:test",
        type: "run.spawn",
        windowId: "secondary",
      },
      protocolVersion: 1,
      requestId: "req-run-spawn-secondary",
    });
    const spawnData =
      spawnResult.ok &&
      typeof spawnResult.data === "object" &&
      spawnResult.data !== null
        ? spawnResult.data
        : null;
    if (
      !(spawnData && "runId" in spawnData) ||
      typeof spawnData.runId !== "string"
    ) {
      throw new Error("run.spawn did not return a runId");
    }

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          runId: spawnData.runId,
          type: "run.cancel",
          windowId: "main",
        },
        protocolVersion: 1,
        requestId: "req-run-cancel-secondary",
      })
    ).resolves.toMatchObject({
      ok: true,
      requestId: "req-run-cancel-secondary",
    });

    expect(rendererCommands.at(-1)).toMatchObject({
      panelId: "terminal-from-renderer",
      type: "panel.close",
      windowId: "secondary",
    });
  });

  it("run.cancel 在 renderer 关闭失败时不提前改写任务状态", async () => {
    const rendererCommands: unknown[] = [];
    const fakeServices = services(rendererCommands);
    const executeRendererCommand = fakeServices.rendererCommand.execute;
    fakeServices.rendererCommand.execute = vi.fn((command) => {
      if (command.type === "panel.close") {
        rendererCommands.push(command);
        return Promise.resolve({
          error: {
            code: "platform_unavailable" as const,
            message: "close failed",
          },
          ok: false as const,
          requestId: "renderer-close-failed",
        });
      }
      return executeRendererCommand(command);
    });
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    const spawnResult = await router.execute({
      clientId: "desktop-1",
      command: {
        projectRootPath: process.cwd(),
        taskId: "package-script:test",
        type: "run.spawn",
        windowId: "main",
      },
      protocolVersion: 1,
      requestId: "req-cancel-failure-spawn",
    });
    const spawnData =
      spawnResult.ok &&
      typeof spawnResult.data === "object" &&
      spawnResult.data !== null
        ? spawnResult.data
        : null;
    if (
      !(spawnData && "runId" in spawnData) ||
      typeof spawnData.runId !== "string"
    ) {
      throw new Error("run.spawn did not return a runId");
    }

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          runId: spawnData.runId,
          type: "run.cancel",
          windowId: "main",
        },
        protocolVersion: 1,
        requestId: "req-cancel-failure",
      })
    ).resolves.toMatchObject({
      error: {
        code: "platform_unavailable",
        message: "close failed",
      },
      ok: false,
      requestId: "req-cancel-failure",
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          runId: spawnData.runId,
          type: "run.status",
        },
        protocolVersion: 1,
        requestId: "req-cancel-failure-status",
      })
    ).resolves.toMatchObject({
      data: {
        nodes: {
          "package-script:test": {
            status: "running",
          },
        },
        status: "running",
      },
      ok: true,
    });
  });

  it("terminal.open 遇到未知 profileId 时失败且不注册 launch", async () => {
    const rendererCommands: unknown[] = [];
    const terminalLaunches: unknown[] = [];
    const fakeServices = services(
      rendererCommands,
      undefined,
      terminalLaunches
    );
    Object.assign(fakeServices, {
      terminalProfiles: {
        resolve: vi.fn(async () => null),
      },
    });
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          launch: {
            profileId: "missing",
          },
          type: "terminal.open",
        },
        protocolVersion: 1,
        requestId: "req-terminal-open-missing-profile",
      })
    ).resolves.toMatchObject({
      error: {
        code: "invalid_command",
        message: "unknown terminal profile: missing",
      },
      ok: false,
      requestId: "req-terminal-open-missing-profile",
    });

    expect(terminalLaunches).toEqual([]);
    expect(rendererCommands).toEqual([]);
  });

  it("terminal profile commands dispatch to the terminal profile service", async () => {
    const fakeServices = services();
    const savedProfiles = new Map<string, unknown>([
      ["codex", { command: "codex", env: { PIER_MODE: "dev" } }],
    ]);
    Object.assign(fakeServices.terminalProfiles, {
      delete: vi.fn((profileId: string) => {
        const existed = savedProfiles.delete(profileId);
        return Promise.resolve(existed);
      }),
      list: vi.fn(() => Promise.resolve(Object.fromEntries(savedProfiles))),
      read: vi.fn((profileId: string) =>
        Promise.resolve(savedProfiles.get(profileId) ?? null)
      ),
      upsert: vi.fn((profileId: string, profile: unknown) => {
        savedProfiles.set(profileId, profile);
        return Promise.resolve(profile);
      }),
    });
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { type: "terminal.profile.list" },
        protocolVersion: 1,
        requestId: "req-profile-list",
      })
    ).resolves.toMatchObject({
      data: { codex: { command: "codex", env: { PIER_MODE: "dev" } } },
      ok: true,
      requestId: "req-profile-list",
    });
    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          profile: { command: "aider", cwd: "/tmp/pier" },
          profileId: "aider",
          type: "terminal.profile.upsert",
        },
        protocolVersion: 1,
        requestId: "req-profile-upsert",
      })
    ).resolves.toMatchObject({
      data: { command: "aider", cwd: "/tmp/pier" },
      ok: true,
      requestId: "req-profile-upsert",
    });
    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          profileId: "aider",
          type: "terminal.profile.read",
        },
        protocolVersion: 1,
        requestId: "req-profile-read",
      })
    ).resolves.toMatchObject({
      data: { command: "aider", cwd: "/tmp/pier" },
      ok: true,
      requestId: "req-profile-read",
    });
    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          profileId: "aider",
          type: "terminal.profile.delete",
        },
        protocolVersion: 1,
        requestId: "req-profile-delete",
      })
    ).resolves.toMatchObject({
      data: true,
      ok: true,
      requestId: "req-profile-delete",
    });
  });

  it("app.status 从当前 focused window 的 active panel snapshot 派生 active context", async () => {
    const active = panelContext("/Users/xyz/ABC/active");
    const recent = panelContext("/Users/xyz/ABC/recent");
    const fakeServices = services([], {
      main: [panelSnapshot("terminal-active", active, true)],
    });
    await fakeServices.panelContexts.recordRecent(recent);
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { type: "app.status" },
        protocolVersion: 1,
        requestId: "req-status",
      })
    ).resolves.toMatchObject({
      data: {
        panelContext: {
          active,
          recent: [recent],
        },
      },
      ok: true,
      requestId: "req-status",
    });
  });

  it("panel.list without window id aggregates live windows", async () => {
    const fakeServices = services([], {
      main: [panelSnapshot("terminal-main", panelContext("/tmp/main"), true)],
      secondary: [
        panelSnapshot(
          "terminal-secondary",
          panelContext("/tmp/secondary"),
          true
        ),
      ],
    });
    fakeServices.window.list = () => [
      { focused: true, id: "main", recordId: "record-main" },
      { focused: false, id: "secondary", recordId: "record-secondary" },
    ];
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { type: "panel.list" },
        protocolVersion: 1,
        requestId: "req-panel-list",
      })
    ).resolves.toMatchObject({
      data: {
        errors: [],
        panels: [
          {
            context: panelContext("/tmp/main"),
            id: "terminal-main",
            recordId: "record-main",
            windowFocused: true,
            windowId: "main",
          },
          {
            context: panelContext("/tmp/secondary"),
            id: "terminal-secondary",
            recordId: "record-secondary",
            windowFocused: false,
            windowId: "secondary",
          },
        ],
      },
      ok: true,
      requestId: "req-panel-list",
    });
  });

  it("panel.focus without window id focuses the matching live panel", async () => {
    const rendererCommands: unknown[] = [];
    const fakeServices = services(rendererCommands, {
      main: [panelSnapshot("terminal-1", panelContext("/tmp/main"), true)],
    });
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { panelId: "terminal-1", type: "panel.focus" },
        protocolVersion: 1,
        requestId: "req-panel-focus",
      })
    ).resolves.toEqual({
      data: { windowId: "main" },
      ok: true,
      requestId: "req-panel-focus",
    });

    expect(rendererCommands.at(-1)).toEqual({
      panelId: "terminal-1",
      type: "panel.focus",
      windowId: "main",
    });
  });

  it("分发 environment.* 命令到 local environment service", async () => {
    const fakeServices = services();
    const localEnvironments = localEnvironmentsOf(fakeServices);
    const projectRequest = { projectRootPath: "/repo" };
    const updateRequest = {
      cleanupCommand: "pnpm cleanup:worktree",
      copyPatterns: [".env*"],
      env: { NODE_ENV: "development" },
      projectRootPath: "/repo",
      setupCommand: "pnpm setup:worktree",
    };
    const bindingRequest = { worktreePath: "/repo/.worktrees/feature-a" };
    const bindingSnapshot = {
      cleanupCommand: "pnpm cleanup:worktree",
      copyPatterns: [".env*"],
      env: { NODE_ENV: "development" },
      hasCleanupScript: true,
      projectRootPath: "/repo",
      setupCommand: "pnpm setup:worktree",
      worktreePath: "/repo/.worktrees/feature-a",
    };
    localEnvironments.worktreeBinding = vi.fn(async () => bindingSnapshot);

    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { ...projectRequest, type: "environment.snapshot" },
        protocolVersion: 1,
        requestId: "req-environment-snapshot",
      })
    ).resolves.toEqual({
      data: emptyEnvironmentState(),
      ok: true,
      requestId: "req-environment-snapshot",
    });
    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { ...projectRequest, type: "environment.project.add" },
        protocolVersion: 1,
        requestId: "req-environment-project-add",
      })
    ).resolves.toEqual({
      data: emptyEnvironmentState(),
      ok: true,
      requestId: "req-environment-project-add",
    });
    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { ...projectRequest, type: "environment.project.remove" },
        protocolVersion: 1,
        requestId: "req-environment-project-remove",
      })
    ).resolves.toEqual({
      data: emptyEnvironmentState(),
      ok: true,
      requestId: "req-environment-project-remove",
    });
    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { ...updateRequest, type: "environment.update" },
        protocolVersion: 1,
        requestId: "req-environment-update",
      })
    ).resolves.toEqual({
      data: emptyEnvironmentState(),
      ok: true,
      requestId: "req-environment-update",
    });
    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { ...bindingRequest, type: "environment.worktreeBinding" },
        protocolVersion: 1,
        requestId: "req-environment-worktree-binding",
      })
    ).resolves.toEqual({
      data: bindingSnapshot,
      ok: true,
      requestId: "req-environment-worktree-binding",
    });

    expect(localEnvironments.snapshot).toHaveBeenCalledWith(projectRequest);
    expect(localEnvironments.addProject).toHaveBeenCalledWith(projectRequest);
    expect(localEnvironments.removeProject).toHaveBeenCalledWith(
      projectRequest
    );
    expect(localEnvironments.updateProject).toHaveBeenCalledWith(updateRequest);
    expect(localEnvironments.worktreeBinding).toHaveBeenCalledWith(
      bindingRequest
    );
  });

  it("maps missing local environment service errors to not_found with project_not_found reason", async () => {
    const fakeServices = services();
    const localEnvironments = localEnvironmentsOf(fakeServices);
    localEnvironments.updateProject = vi.fn(() =>
      Promise.reject(
        new LocalEnvironmentServiceError("project not found: /repo")
      )
    );
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          cleanupCommand: "",
          copyPatterns: [],
          env: {},
          projectRootPath: "/repo",
          setupCommand: "",
          type: "environment.update",
        },
        protocolVersion: 1,
        requestId: "req-environment-update-missing",
      })
    ).resolves.toMatchObject({
      error: {
        code: "not_found",
        message: expect.stringContaining("project_not_found"),
      },
      ok: false,
      requestId: "req-environment-update-missing",
    });
  });

  it("分发 worktree.list 和 worktree.create", async () => {
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: services(),
    });

    const listResult = await router.execute({
      clientId: "desktop-1",
      command: { path: "/repo", type: "worktree.list" },
      protocolVersion: 1,
      requestId: "req-worktree-list",
    });
    expect(listResult).toMatchObject({
      data: {
        mainPath: "/repo",
        status: "available",
      },
      ok: true,
      requestId: "req-worktree-list",
    });
    expect(listResult.ok ? listResult.data : null).toMatchObject({
      worktrees: expect.arrayContaining([
        expect.objectContaining({ branch: "main", path: "/repo" }),
      ]),
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          base: "origin/main",
          branch: "feature/a",
          name: "feature-a",
          path: "/repo",
          type: "worktree.create",
        },
        protocolVersion: 1,
        requestId: "req-worktree-create",
      })
    ).resolves.toMatchObject({
      data: {
        created: {
          branch: "feature/a",
          path: "/repo/.worktrees/feature-a",
        },
        targetPath: "/repo/.worktrees/feature-a",
      },
      ok: true,
      requestId: "req-worktree-create",
    });
  });

  it("worktree.create 编排 resolveProject、bind、copy 和 setup", async () => {
    const operations: string[] = [];
    const progress: string[] = [];
    const fakeServices = services();
    const localEnvironments = localEnvironmentsOf(fakeServices);
    const project = pierProject({ projectRootPath: "/repo-main" });
    fakeServices.gitWatch.pulse = vi.fn((path: string) => {
      operations.push(`pulse:${path}`);
    });
    fakeServices.preferences.read = vi.fn(() =>
      Promise.resolve(
        makeFakePreferences({
          agentStatusHooks: false,
        })
      )
    );
    fakeServices.worktrees.check = vi.fn((args) => {
      operations.push(`check:${args.path}`);
      return Promise.resolve({
        currentPath: args.path,
        mainPath: "/repo-main",
        path: args.path,
        status: "supported" as const,
      });
    });
    fakeServices.worktrees.create = vi.fn((args) => {
      operations.push(`create:${args.name}`);
      return Promise.resolve({
        created: {
          bare: false,
          branch: args.branch,
          detached: false,
          head: "def456",
          isCurrent: false,
          isMain: false,
          locked: false,
          lockedReason: null,
          path: "/repo-main.worktree/feature-a",
          prunable: false,
          prunableReason: null,
        },
        targetPath: "/repo-main.worktree/feature-a",
        worktrees: [
          {
            bare: false,
            branch: "main",
            detached: false,
            head: "abc123",
            isCurrent: true,
            isMain: true,
            locked: false,
            lockedReason: null,
            path: "/repo-main",
            prunable: false,
            prunableReason: null,
          },
        ],
      });
    });
    localEnvironments.resolveProject = vi.fn(() => {
      operations.push("resolve-project");
      return Promise.resolve(project);
    });
    localEnvironments.bindWorktree = vi.fn(() => {
      operations.push("bind-worktree");
      return Promise.resolve();
    });
    localEnvironments.runLifecycle = vi.fn(() => {
      operations.push("setup");
      return Promise.resolve();
    });
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      onWorktreeCreateProgress: (event) => {
        progress.push(`${event.operationId}:${event.phase}`);
      },
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          base: "origin/main",
          branch: "feature/a",
          name: "feature-a",
          operationId: "00000000-0000-4000-8000-000000000001",
          path: "/repo",
          type: "worktree.create",
        },
        protocolVersion: 1,
        requestId: "req-worktree-create-environment",
      })
    ).resolves.toMatchObject({
      data: {
        copiedFiles: [],
        targetPath: "/repo-main.worktree/feature-a",
      },
      ok: true,
      requestId: "req-worktree-create-environment",
    });

    expect(localEnvironments.resolveProject).toHaveBeenCalledWith("/repo-main");
    expect(localEnvironments.bindWorktree).toHaveBeenCalledWith({
      projectRootPath: "/repo-main",
      worktreePath: "/repo-main.worktree/feature-a",
    });
    expect(localEnvironments.runLifecycle).toHaveBeenCalledWith({
      cwd: "/repo-main.worktree/feature-a",
      project,
      phase: "setup",
    });
    expect(operations).toEqual([
      "check:/repo",
      "resolve-project",
      "create:feature-a",
      "bind-worktree",
      "setup",
      "pulse:/repo",
    ]);
    expect(progress).toEqual([
      "00000000-0000-4000-8000-000000000001:creating",
      "00000000-0000-4000-8000-000000000001:initializing",
    ]);
  });

  it("worktree.create setup 失败时保留 worktree 和 binding 但不开 terminal 或 agent", async () => {
    const rendererCommands: unknown[] = [];
    const terminalLaunches: unknown[] = [];
    const fakeServices = services(
      rendererCommands,
      undefined,
      terminalLaunches
    );
    const localEnvironments = localEnvironmentsOf(fakeServices);
    const project = pierProject({ projectRootPath: "/repo-main" });
    fakeServices.gitWatch.pulse = vi.fn();
    fakeServices.preferences.read = vi.fn(() =>
      Promise.resolve(
        makeFakePreferences({
          agentStatusHooks: false,
        })
      )
    );
    fakeServices.worktrees.check = vi.fn((args) =>
      Promise.resolve({
        currentPath: args.path,
        mainPath: "/repo-main",
        path: args.path,
        status: "supported" as const,
      })
    );
    fakeServices.worktrees.create = vi.fn((args) =>
      Promise.resolve({
        created: {
          bare: false,
          branch: args.branch,
          detached: false,
          head: "def456",
          isCurrent: false,
          isMain: false,
          locked: false,
          lockedReason: null,
          path: "/repo-main.worktree/feature-a",
          prunable: false,
          prunableReason: null,
        },
        targetPath: "/repo-main.worktree/feature-a",
        worktrees: [
          {
            bare: false,
            branch: "main",
            detached: false,
            head: "abc123",
            isCurrent: true,
            isMain: true,
            locked: false,
            lockedReason: null,
            path: "/repo-main",
            prunable: false,
            prunableReason: null,
          },
        ],
      })
    );
    localEnvironments.resolveProject = vi.fn(() => Promise.resolve(project));
    localEnvironments.bindWorktree = vi.fn(() => Promise.resolve(undefined));
    localEnvironments.runLifecycle = vi.fn(() =>
      Promise.reject(localEnvironmentScriptError("setup"))
    );
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          branch: "feature/a",
          name: "feature-a",
          path: "/repo",
          type: "worktree.create",
        },
        protocolVersion: 1,
        requestId: "req-worktree-create-setup-failed",
      })
    ).resolves.toEqual({
      error: {
        code: "environment_script_failed",
        message: expect.stringContaining(
          "local environment setup script failed"
        ),
      },
      ok: false,
      requestId: "req-worktree-create-setup-failed",
    });

    expect(fakeServices.worktrees.create).toHaveBeenCalled();
    expect(localEnvironments.bindWorktree).toHaveBeenCalledWith({
      projectRootPath: "/repo-main",
      worktreePath: "/repo-main.worktree/feature-a",
    });
    expect(fakeServices.gitWatch.pulse).toHaveBeenCalledWith("/repo");
    expect(rendererCommands).toEqual([]);
    expect(terminalLaunches).toEqual([]);
  });

  it("worktree.creationDefaults omits the removed branchPrefix even if legacy preferences contain one", async () => {
    const fakeServices = services();
    fakeServices.preferences.read = async () =>
      ({
        ...makeFakePreferences({ agentStatusHooks: false }),
        worktreeBranchPrefix: "legacy/",
      }) as never;
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    const result = await router.execute({
      clientId: "desktop-1",
      command: { path: "/repo", type: "worktree.creationDefaults" },
      protocolVersion: 1,
      requestId: "req-worktree-defaults",
    });

    expect(result).toMatchObject({
      data: {
        rootPath: "/repo.worktree",
      },
      ok: true,
      requestId: "req-worktree-defaults",
    });
    expect(result.ok ? result.data : null).not.toHaveProperty("branchPrefix");
  });

  it("worktree.open 复用 panel.open 的 context 解析和 renderer 命令", async () => {
    const rendererCommands: unknown[] = [];
    const fakeServices = services(rendererCommands);
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          focus: false,
          path: "/repo/.worktrees/feature-a",
          type: "worktree.open",
        },
        protocolVersion: 1,
        requestId: "req-worktree-open",
      })
    ).resolves.toEqual({
      data: {
        context: panelContext("/repo/.worktrees/feature-a"),
        panelId: "terminal-from-renderer",
      },
      ok: true,
      requestId: "req-worktree-open",
    });

    expect(rendererCommands.at(-1)).toEqual({
      context: panelContext("/repo/.worktrees/feature-a"),
      focus: false,
      type: "panel.open",
      windowId: "main",
    });
  });

  it("worktree.openTerminal 带 agentId 时在目标工作树打开 agent 对话", async () => {
    const rendererCommands: unknown[] = [];
    const terminalLaunches: unknown[] = [];
    const fakeServices = services(
      rendererCommands,
      undefined,
      terminalLaunches
    );
    fakeServices.preferences.read = async () =>
      makeFakePreferences({
        agentDefaultArgs: {
          codex: "--dangerously-bypass-approvals-and-sandbox",
        },
        agentStatusHooks: false,
      });
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          agentId: "codex",
          path: "/repo/.worktrees/feature-a",
          taskPrompt: "修复终端焦点问题",
          targetGroupId: "source-group",
          windowId: "main",
          type: "worktree.openTerminal",
        },
        protocolVersion: 1,
        requestId: "req-worktree-agent-terminal",
      })
    ).resolves.toEqual({
      data: {
        context: panelContext("/repo/.worktrees/feature-a"),
        panelId: "terminal-from-renderer",
        windowId: "main",
      },
      ok: true,
      requestId: "req-worktree-agent-terminal",
    });

    expect(terminalLaunches).toEqual([
      {
        agentId: "codex",
        command: "codex --dangerously-bypass-approvals-and-sandbox",
        cwd: "/repo/.worktrees/feature-a",
      },
    ]);
    expect(rendererCommands.at(-1)).toEqual({
      context: panelContext("/repo/.worktrees/feature-a"),
      focus: true,
      initialInput: "修复终端焦点问题\r",
      launchId: "launch-1",
      tab: {
        icon: { id: agentTabIconId("codex") },
        title: "Codex",
      },
      targetGroupId: "source-group",
      type: "terminal.open",
      windowId: "main",
    });
  });

  it("worktree.openTerminal merges bound environment env into the terminal launch", async () => {
    const rendererCommands: unknown[] = [];
    const terminalLaunches: unknown[] = [];
    const fakeServices = services(
      rendererCommands,
      undefined,
      terminalLaunches
    );
    const localEnvironments = localEnvironmentsOf(fakeServices);
    const project = pierProject({
      env: { PIER_ENVIRONMENT: "local" },
      projectRootPath: "/repo",
    });
    localEnvironments.resolveForWorktree = vi.fn(async () => ({
      project,
      projectRootPath: "/repo",
    }));
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          path: "/repo/.worktrees/feature-a",
          type: "worktree.openTerminal",
        },
        protocolVersion: 1,
        requestId: "req-worktree-env-terminal",
      })
    ).resolves.toEqual({
      data: {
        context: panelContext("/repo/.worktrees/feature-a"),
        panelId: "terminal-from-renderer",
        windowId: "main",
      },
      ok: true,
      requestId: "req-worktree-env-terminal",
    });

    expect(terminalLaunches).toEqual([
      {
        cwd: "/repo/.worktrees/feature-a",
        env: { PIER_ENVIRONMENT: "local" },
      },
    ]);
    expect(localEnvironments.resolveForWorktree).toHaveBeenCalledWith(
      "/repo/.worktrees/feature-a"
    );
    expect(rendererCommands.at(-1)).toEqual({
      context: panelContext("/repo/.worktrees/feature-a"),
      focus: true,
      launchId: "launch-1",
      type: "terminal.open",
      windowId: "main",
    });
  });

  it("worktree.openTerminal ignores stale environment bindings and opens a cwd-only terminal", async () => {
    const rendererCommands: unknown[] = [];
    const terminalLaunches: unknown[] = [];
    const fakeServices = services(
      rendererCommands,
      undefined,
      terminalLaunches
    );
    const localEnvironments = localEnvironmentsOf(fakeServices);
    localEnvironments.resolveForWorktree = vi.fn(() =>
      Promise.reject(
        new LocalEnvironmentServiceError("bound environment not found: pier")
      )
    );
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          path: "/repo/.worktrees/feature-a",
          type: "worktree.openTerminal",
        },
        protocolVersion: 1,
        requestId: "req-worktree-stale-env-terminal",
      })
    ).resolves.toEqual({
      data: {
        context: panelContext("/repo/.worktrees/feature-a"),
        panelId: "terminal-from-renderer",
        windowId: "main",
      },
      ok: true,
      requestId: "req-worktree-stale-env-terminal",
    });

    expect(terminalLaunches).toEqual([{ cwd: "/repo/.worktrees/feature-a" }]);
    expect(localEnvironments.resolveForWorktree).toHaveBeenCalledWith(
      "/repo/.worktrees/feature-a"
    );
    expect(rendererCommands.at(-1)).toEqual({
      context: panelContext("/repo/.worktrees/feature-a"),
      focus: true,
      launchId: "launch-1",
      type: "terminal.open",
      windowId: "main",
    });
  });

  it("worktree.open 拒绝打开当前仓库 worktree 列表之外的路径", async () => {
    const rendererCommands: unknown[] = [];
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: services(rendererCommands),
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          path: "/tmp/not-a-known-worktree",
          type: "worktree.open",
        },
        protocolVersion: 1,
        requestId: "req-worktree-open-invalid",
      })
    ).resolves.toEqual({
      error: {
        code: "invalid_path",
        message:
          "path is not a known worktree for this repository: /tmp/not-a-known-worktree",
      },
      ok: false,
      requestId: "req-worktree-open-invalid",
    });
    expect(rendererCommands).toEqual([]);
  });

  it("worktree.open 在目标仓库之外调用时按目标路径自身校验", async () => {
    const rendererCommands: unknown[] = [];
    const fakeServices = services(rendererCommands);
    const baseList = fakeServices.worktrees.list;
    // 模拟真实行为:非 /repo 内的路径(如 CLI 的 cwd)不是 git 仓库
    fakeServices.worktrees = {
      ...fakeServices.worktrees,
      list: async (args) =>
        args.path.startsWith("/repo")
          ? await baseList(args)
          : {
              path: args.path,
              reason: "not_git_repo",
              status: "unavailable",
              worktrees: [],
            },
    };
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          focus: false,
          path: "/repo/.worktrees/feature-a",
          type: "worktree.open",
        },
        protocolVersion: 1,
        requestId: "req-worktree-open-outside",
      })
    ).resolves.toEqual({
      data: {
        context: panelContext("/repo/.worktrees/feature-a"),
        panelId: "terminal-from-renderer",
      },
      ok: true,
      requestId: "req-worktree-open-outside",
    });
  });

  it("worktree.open 通过符号链接路径能匹配 realpath 后的 worktree", async () => {
    const linkedPath = await mkdtemp(join(tmpdir(), "pier-wt-"));
    const canonicalPath = await realpath(linkedPath);
    try {
      const rendererCommands: unknown[] = [];
      const fakeServices = services(rendererCommands);
      // git worktree list 报告的是 realpath 化的路径
      fakeServices.worktrees = {
        ...fakeServices.worktrees,
        list: async (args) => ({
          currentPath: args.path,
          mainPath: canonicalPath,
          path: args.path,
          status: "available",
          worktrees: [
            {
              bare: false,
              branch: "main",
              detached: false,
              head: "abc123",
              isCurrent: true,
              isMain: true,
              locked: false,
              lockedReason: null,
              path: canonicalPath,
              prunable: false,
              prunableReason: null,
            },
          ],
        }),
      };
      const router = createCommandRouter({
        clients: registryWith(desktopClient),
        services: fakeServices,
      });

      await expect(
        router.execute({
          clientId: "desktop-1",
          command: {
            focus: false,
            path: linkedPath,
            type: "worktree.open",
          },
          protocolVersion: 1,
          requestId: "req-worktree-open-symlink",
        })
      ).resolves.toEqual({
        data: {
          context: panelContext(canonicalPath),
          panelId: "terminal-from-renderer",
        },
        ok: true,
        requestId: "req-worktree-open-symlink",
      });
    } finally {
      await rm(linkedPath, { force: true, recursive: true });
    }
  });

  it("分发 worktree.remove 到 worktree service", async () => {
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: services(),
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          path: "/repo/.worktrees/feature-a",
          type: "worktree.remove",
        },
        protocolVersion: 1,
        requestId: "req-worktree-remove",
      })
    ).resolves.toEqual({
      data: {
        removedPath: "/repo/.worktrees/feature-a",
        worktrees: [],
      },
      ok: true,
      requestId: "req-worktree-remove",
    });
  });

  it("worktree.remove 在 fake deletion 前为 bound worktree 运行 cleanup", async () => {
    const operations: string[] = [];
    const fakeServices = services();
    const localEnvironments = localEnvironmentsOf(fakeServices);
    const project = pierProject();
    fakeServices.worktrees.remove = vi.fn(
      async (args, hooks?: WorktreeRemoveHookFixture) => {
        operations.push("remove-requested");
        await hooks?.beforeRemove?.({
          mainPath: "/repo",
          targetPath: args.path,
        });
        operations.push("delete-worktree");
        return { removedPath: args.path, worktrees: [] };
      }
    );
    localEnvironments.resolveForWorktree = vi.fn(() => {
      operations.push("resolve-binding");
      return Promise.resolve({ project, projectRootPath: "/repo" });
    });
    localEnvironments.runLifecycle = vi.fn(() => {
      operations.push("cleanup");
      return Promise.resolve();
    });
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          path: "/repo/.worktrees/feature-a",
          type: "worktree.remove",
        },
        protocolVersion: 1,
        requestId: "req-worktree-remove-cleanup",
      })
    ).resolves.toEqual({
      data: {
        removedPath: "/repo/.worktrees/feature-a",
        worktrees: [],
      },
      ok: true,
      requestId: "req-worktree-remove-cleanup",
    });

    expect(localEnvironments.resolveForWorktree).toHaveBeenCalledWith(
      "/repo/.worktrees/feature-a"
    );
    expect(localEnvironments.runLifecycle).toHaveBeenCalledWith({
      cwd: "/repo/.worktrees/feature-a",
      project,
      phase: "cleanup",
    });
    expect(operations).toEqual([
      "remove-requested",
      "resolve-binding",
      "cleanup",
      "delete-worktree",
    ]);
  });

  it("worktree.remove cleanup 失败时返回 environment_script_failed 并阻止删除", async () => {
    const operations: string[] = [];
    const fakeServices = services();
    const localEnvironments = localEnvironmentsOf(fakeServices);
    fakeServices.worktrees.remove = vi.fn(
      async (args, hooks?: WorktreeRemoveHookFixture) => {
        operations.push("remove-requested");
        await hooks?.beforeRemove?.({
          mainPath: "/repo",
          targetPath: args.path,
        });
        operations.push("delete-worktree");
        return { removedPath: args.path, worktrees: [] };
      }
    );
    localEnvironments.resolveForWorktree = vi.fn(() =>
      Promise.resolve({
        project: pierProject(),
        projectRootPath: "/repo",
      })
    );
    localEnvironments.runLifecycle = vi.fn(() =>
      Promise.reject(localEnvironmentScriptError("cleanup"))
    );
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          path: "/repo/.worktrees/feature-a",
          type: "worktree.remove",
        },
        protocolVersion: 1,
        requestId: "req-worktree-remove-cleanup-failed",
      })
    ).resolves.toEqual({
      error: {
        code: "environment_script_failed",
        message: expect.stringContaining(
          "local environment cleanup script failed"
        ),
      },
      ok: false,
      requestId: "req-worktree-remove-cleanup-failed",
    });

    expect(operations).toEqual(["remove-requested"]);
  });

  it("worktree.remove 对 unbound worktree 不运行 cleanup", async () => {
    const operations: string[] = [];
    const fakeServices = services();
    const localEnvironments = localEnvironmentsOf(fakeServices);
    fakeServices.worktrees.remove = vi.fn(
      async (args, hooks?: WorktreeRemoveHookFixture) => {
        operations.push("remove-requested");
        await hooks?.beforeRemove?.({
          mainPath: "/repo",
          targetPath: args.path,
        });
        operations.push("delete-worktree");
        return { removedPath: args.path, worktrees: [] };
      }
    );
    localEnvironments.resolveForWorktree = vi.fn(() => {
      operations.push("resolve-binding");
      return Promise.resolve(null);
    });
    localEnvironments.runLifecycle = vi.fn(() => {
      operations.push("cleanup");
      return Promise.resolve();
    });
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          path: "/repo/.worktrees/feature-a",
          type: "worktree.remove",
        },
        protocolVersion: 1,
        requestId: "req-worktree-remove-unbound",
      })
    ).resolves.toMatchObject({
      data: {
        removedPath: "/repo/.worktrees/feature-a",
      },
      ok: true,
      requestId: "req-worktree-remove-unbound",
    });

    expect(localEnvironments.runLifecycle).not.toHaveBeenCalled();
    expect(operations).toEqual([
      "remove-requested",
      "resolve-binding",
      "delete-worktree",
    ]);
  });

  it("分发 worktree.check 到 worktree service", async () => {
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: services(),
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { path: "/repo", type: "worktree.check" },
        protocolVersion: 1,
        requestId: "req-worktree-check",
      })
    ).resolves.toEqual({
      data: {
        currentPath: "/repo",
        mainPath: "/repo",
        path: "/repo",
        status: "supported",
      },
      ok: true,
      requestId: "req-worktree-check",
    });
  });

  it("把 worktree service 错误映射为稳定命令错误", async () => {
    const fakeServices = services();
    fakeServices.worktrees.create = () =>
      Promise.reject(
        new WorktreeServiceError(
          "invalid_branch",
          "invalid worktree branch: bad branch"
        )
      );
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: {
          branch: "bad branch",
          name: "feature-a",
          path: "/repo",
          type: "worktree.create",
        },
        protocolVersion: 1,
        requestId: "req-worktree-invalid-branch",
      })
    ).resolves.toEqual({
      error: {
        code: "invalid_branch",
        message: "invalid worktree branch: bad branch",
      },
      ok: false,
      requestId: "req-worktree-invalid-branch",
    });
  });

  it("分发 plugin.list 和 plugin.inspect", async () => {
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: services(),
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { type: "plugin.list" },
        protocolVersion: 1,
        requestId: "req-plugin-list",
      })
    ).resolves.toMatchObject({
      data: {
        diagnostics: [],
        entries: [
          {
            effectivePermissions: ["plugin:read"],
            enabled: true,
            manifest: {
              commands: [{ id: "sample.command" }],
              id: "sample.local",
              panels: [{ id: "sample.panel" }],
            },
            runtime: {
              enabled: false,
              kind: "manifest-only",
            },
          },
        ],
      },
      ok: true,
      requestId: "req-plugin-list",
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { id: "sample.local", type: "plugin.inspect" },
        protocolVersion: 1,
        requestId: "req-plugin-inspect",
      })
    ).resolves.toMatchObject({
      data: {
        effectivePermissions: ["plugin:read"],
        enabled: true,
        manifest: {
          commands: [{ id: "sample.command" }],
          id: "sample.local",
          panels: [{ id: "sample.panel" }],
        },
        runtime: {
          enabled: false,
          kind: "manifest-only",
        },
      },
      ok: true,
      requestId: "req-plugin-inspect",
    });
  });

  it("分发 plugin.enable 和 plugin.disable", async () => {
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: services(),
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { id: "sample.builtin", type: "plugin.disable" },
        protocolVersion: 1,
        requestId: "req-plugin-disable",
      })
    ).resolves.toMatchObject({
      data: {
        enabled: false,
        manifest: { id: "sample.builtin" },
        runtime: { enabled: false, kind: "builtin" },
      },
      ok: true,
      requestId: "req-plugin-disable",
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { id: "sample.builtin", type: "plugin.enable" },
        protocolVersion: 1,
        requestId: "req-plugin-enable",
      })
    ).resolves.toMatchObject({
      data: {
        enabled: true,
        manifest: { id: "sample.builtin" },
        runtime: { enabled: true, kind: "builtin" },
      },
      ok: true,
      requestId: "req-plugin-enable",
    });
  });

  it("local plugin enable/disable 暂不支持时返回 unsupported", async () => {
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: {
        ...services(),
        plugins: {
          inspect: async () => null,
          list: async () => ({ diagnostics: [], entries: [] }),
          setEnabled: () =>
            Promise.reject(
              new PluginServiceError(
                "unsupported",
                "plugin source kind cannot be enabled yet: local"
              )
            ),
        },
      },
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { id: "sample.local", type: "plugin.enable" },
        protocolVersion: 1,
        requestId: "req-plugin-enable-local",
      })
    ).resolves.toEqual({
      error: {
        code: "unsupported",
        message: "plugin source kind cannot be enabled yet: local",
      },
      ok: false,
      requestId: "req-plugin-enable-local",
    });
  });

  it("plugin.inspect 未命中时返回 not_found", async () => {
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: services(),
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { id: "missing.plugin", type: "plugin.inspect" },
        protocolVersion: 1,
        requestId: "req-plugin-missing",
      })
    ).resolves.toEqual({
      error: {
        code: "not_found",
        message: "plugin not found: missing.plugin",
      },
      ok: false,
      requestId: "req-plugin-missing",
    });
  });
});
