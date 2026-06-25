import { createClientRegistry } from "@main/app-core/client-registry.ts";
import type { PierCoreServices } from "@main/app-core/command-router.ts";
import { createCommandRouter } from "@main/app-core/command-router.ts";
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

function services(rendererCommands: unknown[] = []): PierCoreServices {
  function rendererCommandData(
    command: Parameters<PierCoreServices["rendererCommand"]["execute"]>[0]
  ) {
    if (command.type === "terminal.open") {
      return { panelId: "terminal-from-renderer" };
    }
    if (command.type === "workspace.open") {
      return { path: command.path };
    }
    return null;
  }

  return {
    commandPaletteMru: {
      clear: async () => ({ entries: [], version: 1 }),
      read: async () => ({ entries: [], version: 1 }),
      recordUse: async () => undefined,
    },
    preferences: {
      read: async () => ({
        language: "zh-CN",
        monoFontFamily: "",
        monoFontSize: 13,
        stylePresetId: "pierre",
        theme: "system",
        uiFontFamily: "",
      }),
      update: async (patch) => ({
        language: "zh-CN",
        monoFontFamily: "",
        monoFontSize: 13,
        stylePresetId: "pierre",
        theme: patch.theme ?? "system",
        uiFontFamily: "",
      }),
    },
    workspace: {
      clearLayout: async (_recordId) => undefined,
      readLayout: async (_recordId) => null,
      saveLayout: async (_layout, _recordId) => undefined,
    },
    rendererCommand: {
      execute: (command) => {
        rendererCommands.push(command);
        return Promise.resolve({
          data: rendererCommandData(command),
          ok: true,
          requestId: "renderer-req",
        });
      },
      resolve: () => undefined,
    },
    terminalSessions: {
      listRecentClosed: async () => [],
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
    ).resolves.toEqual({
      error: {
        code: "permission_denied",
        message: "unknown client",
      },
      ok: false,
      requestId: "req-2",
    });
  });

  it("拒绝 malformed envelope 且不会读取不存在的 requestId", async () => {
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: services(),
    });

    await expect(router.execute(null)).resolves.toEqual({
      error: {
        code: "invalid_command",
        message: "invalid command",
      },
      ok: false,
      requestId: "unknown",
    });

    await expect(
      router.execute({ requestId: "req-malformed" })
    ).resolves.toEqual({
      error: {
        code: "invalid_command",
        message: "invalid command",
      },
      ok: false,
      requestId: "req-malformed",
    });
  });

  it("拒绝权限不足的命令", async () => {
    const mcpClient: PierClient = {
      capabilities: DEFAULT_CAPABILITIES_BY_CLIENT_KIND["mcp-local"],
      createdAt: now,
      id: "mcp-1",
      kind: "mcp-local",
      lastSeenAt: now,
    };
    const router = createCommandRouter({
      clients: registryWith(mcpClient),
      services: services(),
    });

    await expect(
      router.execute({
        clientId: "mcp-1",
        command: { type: "window.close", windowId: "main" },
        protocolVersion: 1,
        requestId: "req-3",
      })
    ).resolves.toEqual({
      error: {
        code: "permission_denied",
        message: "missing capability: window:close",
      },
      ok: false,
      requestId: "req-3",
    });
  });

  it("终端打开命令通过 renderer bridge 落地", async () => {
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: services(),
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { type: "terminal.open" },
        protocolVersion: 1,
        requestId: "req-terminal-open",
      })
    ).resolves.toEqual({
      data: { panelId: "terminal-from-renderer" },
      ok: true,
      requestId: "req-terminal-open",
    });
  });

  it("打开路径命令通过 renderer bridge 落地", async () => {
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
          path: ".",
          placement: "split-right",
          type: "workspace.open",
          windowId: "main",
        },
        protocolVersion: 1,
        requestId: "req-open",
      })
    ).resolves.toEqual({
      data: { path: "." },
      ok: true,
      requestId: "req-open",
    });
    expect(rendererCommands).toEqual([
      {
        path: ".",
        placement: "split-right",
        type: "workspace.open",
        windowId: "main",
      },
    ]);
  });

  it("panel 和 terminal 查询聚焦命令通过 renderer bridge 落地", async () => {
    const rendererCommands: unknown[] = [];
    const fakeServices = services(rendererCommands);
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await router.execute({
      clientId: "desktop-1",
      command: { type: "panel.list", windowId: "main" },
      protocolVersion: 1,
      requestId: "req-panel-list",
    });
    await router.execute({
      clientId: "desktop-1",
      command: { panelId: "terminal-1", type: "panel.focus", windowId: "main" },
      protocolVersion: 1,
      requestId: "req-panel-focus",
    });
    await router.execute({
      clientId: "desktop-1",
      command: { type: "terminal.list", windowId: "main" },
      protocolVersion: 1,
      requestId: "req-terminal-list",
    });
    await router.execute({
      clientId: "desktop-1",
      command: {
        panelId: "terminal-1",
        type: "terminal.focus",
        windowId: "main",
      },
      protocolVersion: 1,
      requestId: "req-terminal-focus",
    });

    expect(rendererCommands).toEqual([
      { type: "panel.list", windowId: "main" },
      { panelId: "terminal-1", type: "panel.focus", windowId: "main" },
      { type: "terminal.list", windowId: "main" },
      { panelId: "terminal-1", type: "terminal.focus", windowId: "main" },
    ]);
  });

  it("terminal.list without a window id aggregates all live windows", async () => {
    const rendererCommands: unknown[] = [];
    const fakeServices = services();
    fakeServices.window.list = () => [
      { focused: true, id: "main", recordId: "record-main" },
      { focused: false, id: "secondary", recordId: "record-secondary" },
    ];
    fakeServices.rendererCommand.execute = (command) => {
      rendererCommands.push(command);
      if (command.type !== "terminal.list") {
        throw new Error(`unexpected command: ${command.type}`);
      }
      return Promise.resolve({
        data:
          command.windowId === "main"
            ? [
                {
                  active: true,
                  cwd: "/Users/xyz/ABC/pier",
                  groupIndex: 0,
                  panelId: "terminal-main",
                  tabCount: 1,
                  tabIndex: 0,
                  title: "pier",
                },
              ]
            : [
                {
                  active: false,
                  cwd: "/Users/xyz/ABC/bay",
                  groupIndex: 1,
                  panelId: "terminal-bay",
                  tabCount: 2,
                  tabIndex: 1,
                  title: "bay",
                },
              ],
        ok: true,
        requestId: "renderer-req",
      });
    };
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { type: "terminal.list" },
        protocolVersion: 1,
        requestId: "req-terminal-list-all",
      })
    ).resolves.toEqual({
      data: {
        errors: [],
        open: [
          expect.objectContaining({
            panelId: "terminal-main",
            recordId: "record-main",
            windowFocused: true,
            windowId: "main",
          }),
          expect.objectContaining({
            panelId: "terminal-bay",
            recordId: "record-secondary",
            windowFocused: false,
            windowId: "secondary",
          }),
        ],
        recentClosed: [],
      },
      ok: true,
      requestId: "req-terminal-list-all",
    });
    expect(rendererCommands).toEqual([
      { type: "terminal.list", windowId: "main" },
      { type: "terminal.list", windowId: "secondary" },
    ]);
  });

  it("workspace layout commands require and pass through a durable window record id", async () => {
    const calls: unknown[] = [];
    const fakeServices = services();
    fakeServices.workspace = {
      clearLayout: (recordId) => {
        calls.push(["clear", recordId]);
        return Promise.resolve();
      },
      readLayout: (recordId) => {
        calls.push(["read", recordId]);
        return Promise.resolve({ layout: "from-record" });
      },
      saveLayout: (layout, recordId) => {
        calls.push(["save", recordId, layout]);
        return Promise.resolve();
      },
    };
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { recordId: "record-1", type: "workspace.layout.read" },
        protocolVersion: 1,
        requestId: "req-layout-read",
      })
    ).resolves.toEqual({
      data: { layout: "from-record" },
      ok: true,
      requestId: "req-layout-read",
    });
    await router.execute({
      clientId: "desktop-1",
      command: {
        layout: { grid: "updated" },
        recordId: "record-1",
        type: "workspace.layout.save",
      },
      protocolVersion: 1,
      requestId: "req-layout-save",
    });
    await router.execute({
      clientId: "desktop-1",
      command: { recordId: "record-1", type: "workspace.layout.clear" },
      protocolVersion: 1,
      requestId: "req-layout-clear",
    });

    expect(calls).toEqual([
      ["read", "record-1"],
      ["save", "record-1", { grid: "updated" }],
      ["clear", "record-1"],
    ]);
  });

  it("rejects legacy workspace layout commands without a record id", async () => {
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: services(),
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { type: "workspace.layout.read" },
        protocolVersion: 1,
        requestId: "req-layout-legacy",
      })
    ).resolves.toEqual({
      error: {
        code: "invalid_command",
        message: "invalid command",
      },
      ok: false,
      requestId: "req-layout-legacy",
    });
  });
});
