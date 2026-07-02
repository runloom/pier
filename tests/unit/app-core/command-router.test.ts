import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClientRegistry } from "@main/app-core/client-registry.ts";
import type { PierCoreServices } from "@main/app-core/command-router.ts";
import { createCommandRouter } from "@main/app-core/command-router.ts";
import { createGitService } from "@main/services/git-service.ts";
import { createGitWatchService } from "@main/services/git-watch-service.ts";
import { PluginServiceError } from "@main/services/plugin-service.ts";
import type {
  ProcessEnvironmentResolveRequest,
  ProcessEnvironmentResolveResult,
} from "@main/services/process-environment-service.ts";
import { createTaskService } from "@main/services/tasks/task-service.ts";
import { WorktreeServiceError } from "@main/services/worktree-service.ts";
import type { PanelContext, PanelSnapshot } from "@shared/contracts/panel.ts";
import {
  DEFAULT_CAPABILITIES_BY_CLIENT_KIND,
  type PierClient,
} from "@shared/contracts/permissions.ts";
import type {
  PluginRegistryEntry,
  PluginSourceKind,
} from "@shared/contracts/plugin.ts";
import { describe, expect, it, vi } from "vitest";

const now = 1_772_000_000_000;

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
    projectRoot: path,
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
      ...(request.profileEnv ?? {}),
      ...(request.explicitEnv ?? {}),
    },
  })
): PierCoreServices {
  let recentContexts: PanelContext[] = [];

  return {
    commandPaletteMru: {
      clear: async () => ({ entries: [], version: 1 }),
      read: async () => ({ entries: [], version: 1 }),
      recordUse: async () => undefined,
    },
    secrets: {
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined,
      list: async () => [],
      flush: async () => undefined,
    },
    preferences: {
      read: async () => ({
        language: "system",
        monoFontFamily: "",
        monoFontSize: 13,
        stylePresetId: "pierre",
        terminalCursorBlink: true,
        terminalCursorStyle: "block",
        terminalNewCwdPolicy: "activeTerminal",
        terminalPasteProtection: true,
        terminalScrollbackMb: 64,
        theme: "system",
        uiFontFamily: "",
        userKeymap: [],
        windowZoomLevel: 0,
        defaultAgentId: null,
        disabledAgentIds: [],
        agentDefaultArgs: {},
        agentDefaultEnv: {},
        agentCommandOverrides: {},
        agentStatusHooks: false,
        gitAutoFetchEnabled: true,
        gitAutoFetchIntervalMinutes: 5,
      }),
      update: async (patch) => ({
        language: "system",
        monoFontFamily: "",
        monoFontSize: 13,
        stylePresetId: "pierre",
        terminalCursorBlink: true,
        terminalCursorStyle: "block",
        terminalNewCwdPolicy: "activeTerminal",
        terminalPasteProtection: true,
        terminalScrollbackMb: 64,
        theme: patch.theme ?? "system",
        uiFontFamily: "",
        userKeymap: patch.userKeymap ?? [],
        windowZoomLevel: patch.windowZoomLevel ?? 0,
        defaultAgentId: null,
        disabledAgentIds: [],
        agentDefaultArgs: {},
        agentDefaultEnv: {},
        agentCommandOverrides: {},
        agentStatusHooks: false,
        gitAutoFetchEnabled: patch.gitAutoFetchEnabled ?? true,
        gitAutoFetchIntervalMinutes: patch.gitAutoFetchIntervalMinutes ?? 5,
      }),
    },
    processEnvironment: {
      resolve: resolveEnvironment,
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
      readRecentState: () => Promise.resolve({ entries: [], version: 1 }),
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
    window: {
      close: () => undefined,
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
    },
    git: createGitService(),
    gitWatch: createGitWatchService(),
  };
}

describe("createCommandRouter", () => {
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
        read: async () => ({
          language: "system",
          monoFontFamily: "",
          monoFontSize: 13,
          stylePresetId: "pierre",
          terminalCursorBlink: true,
          terminalCursorStyle: "block",
          terminalNewCwdPolicy: "activeTerminal",
          terminalPasteProtection: true,
          terminalScrollbackMb: 64,
          theme: "system",
          uiFontFamily: "",
          userKeymap: [],
          windowZoomLevel: 0,
          defaultAgentId: null,
          disabledAgentIds: [],
          agentDefaultArgs: { claude: "--dangerously-skip-permissions" },
          agentDefaultEnv: {},
          agentCommandOverrides: {},
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
      { command: "claude --dangerously-skip-permissions", cwd: "/tmp/pier" },
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
        read: async () => ({
          language: "system",
          monoFontFamily: "",
          monoFontSize: 13,
          stylePresetId: "pierre",
          terminalCursorBlink: true,
          terminalCursorStyle: "block",
          terminalNewCwdPolicy: "activeTerminal",
          terminalPasteProtection: true,
          terminalScrollbackMb: 64,
          theme: "system",
          uiFontFamily: "",
          userKeymap: [],
          windowZoomLevel: 0,
          defaultAgentId: null,
          disabledAgentIds: [],
          agentDefaultArgs: { claude: "--dangerously-skip-permissions" },
          agentDefaultEnv: {},
          agentCommandOverrides: {},
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
      { command: "echo explicit", cwd: "/tmp/pier" },
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
        projectRoot: process.cwd(),
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
        projectRoot: process.cwd(),
        taskId: "package-script:test",
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
        projectRoot: process.cwd(),
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
        projectRoot: process.cwd(),
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
          projectRoot: process.cwd(),
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
      projectRoot: process.cwd(),
      taskId: "package-script:test",
      windowId: "main",
    });
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    const spawnCommand = {
      projectRoot: process.cwd(),
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
          projectRoot,
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
        projectRoot,
        taskId: clientTask.id,
        windowId: "main",
      });

      await expect(
        router.execute({
          clientId: "desktop-1",
          command: {
            projectRoot,
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
            projectRoot,
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
          projectRoot,
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
        projectRoot,
        taskId: clientTask.id,
        windowId: "main",
      });

      await expect(
        router.execute({
          clientId: "desktop-1",
          command: {
            projectRoot,
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
            projectRoot,
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
        projectRoot: process.cwd(),
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
        projectRoot: process.cwd(),
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
