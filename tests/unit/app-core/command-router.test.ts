import { createClientRegistry } from "@main/app-core/client-registry.ts";
import type { PierCoreServices } from "@main/app-core/command-router.ts";
import { createCommandRouter } from "@main/app-core/command-router.ts";
import type { PanelContext, PanelSnapshot } from "@shared/contracts/panel.ts";
import {
  DEFAULT_CAPABILITIES_BY_CLIENT_KIND,
  type PierClient,
} from "@shared/contracts/permissions.ts";
import { describe, expect, it } from "vitest";

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
  }
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
        if (command.type === "panel.open") {
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
