import { createClientRegistry } from "@main/app-core/client-registry.ts";
import type { PierCoreServices } from "@main/app-core/command-router.ts";
import { createCommandRouter } from "@main/app-core/command-router.ts";
import type { PanelContext, PanelSnapshot } from "@shared/contracts/panel.ts";
import {
  DEFAULT_CAPABILITIES_BY_CLIENT_KIND,
  type PierClient,
} from "@shared/contracts/permissions.ts";
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

function services(
  rendererCommands: unknown[] = [],
  panelsByWindow: Record<string, PanelSnapshot[]> = {
    main: [
      panelSnapshot("terminal-1", panelContext("/Users/xyz/ABC/pier"), true),
    ],
  },
  terminalLaunches: unknown[] = []
): PierCoreServices {
  let recentContexts: PanelContext[] = [];

  return {
    commandPaletteMru: {
      clear: async () => ({ entries: [], version: 1 }),
      read: async () => ({ entries: [], version: 1 }),
      recordUse: async () => undefined,
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
      }),
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
});
