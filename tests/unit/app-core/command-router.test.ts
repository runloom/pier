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
        terminalCursorBlink: true,
        terminalCursorStyle: "block",
        terminalNewCwdPolicy: "activeTerminal",
        terminalPasteProtection: true,
        terminalScrollbackMb: 64,
        theme: "system",
        uiFontFamily: "",
      }),
      update: async (patch) => ({
        language: "zh-CN",
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

function focusedWindowServices(windowId: string): PierCoreServices {
  const fakeServices = services();
  fakeServices.window.list = () => [
    { focused: windowId === "main", id: "main", recordId: "record-main" },
    {
      focused: windowId === "secondary",
      id: "secondary",
      recordId: "record-secondary",
    },
  ];
  return fakeServices;
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
    const rendererCommands: unknown[] = [];
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: services(rendererCommands),
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { type: "terminal.open" },
        protocolVersion: 1,
        requestId: "req-terminal-open",
      })
    ).resolves.toEqual({
      data: { panelId: "terminal-from-renderer", windowId: "main" },
      ok: true,
      requestId: "req-terminal-open",
    });
    expect(rendererCommands).toEqual([
      { type: "terminal.open", windowId: "main" },
    ]);
  });

  it("terminal.open without a window id targets the currently focused window", async () => {
    const rendererCommands: unknown[] = [];
    const fakeServices = focusedWindowServices("secondary");
    fakeServices.rendererCommand.execute = (command) => {
      rendererCommands.push(command);
      return Promise.resolve({
        data: { panelId: "terminal-from-renderer" },
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
        command: { cwd: "/tmp/pier", type: "terminal.open" },
        protocolVersion: 1,
        requestId: "req-terminal-open-focused",
      })
    ).resolves.toEqual({
      data: {
        panelId: "terminal-from-renderer",
        windowId: "secondary",
      },
      ok: true,
      requestId: "req-terminal-open-focused",
    });
    expect(rendererCommands).toEqual([
      { cwd: "/tmp/pier", type: "terminal.open", windowId: "secondary" },
    ]);
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

  it("terminal.list with a missing explicit window id fails as not_found", async () => {
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: focusedWindowServices("main"),
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { type: "terminal.list", windowId: "missing" },
        protocolVersion: 1,
        requestId: "req-terminal-list-missing",
      })
    ).resolves.toEqual({
      error: {
        code: "not_found",
        message: "window not found: missing",
      },
      ok: false,
      requestId: "req-terminal-list-missing",
    });
  });

  it("terminal.list with an explicit window id fails when that renderer cannot answer", async () => {
    const fakeServices = focusedWindowServices("main");
    fakeServices.rendererCommand.execute = (command) => {
      expect(command).toEqual({ type: "terminal.list", windowId: "secondary" });
      return Promise.resolve({
        error: {
          code: "platform_unavailable",
          message: "renderer command timed out",
        },
        ok: false,
        requestId: "renderer-req-secondary",
      });
    };
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { type: "terminal.list", windowId: "secondary" },
        protocolVersion: 1,
        requestId: "req-terminal-list-renderer-failed",
      })
    ).resolves.toEqual({
      error: {
        code: "platform_unavailable",
        message: "renderer command timed out",
      },
      ok: false,
      requestId: "req-terminal-list-renderer-failed",
    });
  });

  it("panel.focus without a window id focuses the globally unique panel match", async () => {
    const rendererCommands: unknown[] = [];
    const fakeServices = focusedWindowServices("main");
    fakeServices.rendererCommand.execute = (command) => {
      rendererCommands.push(command);
      if (command.type === "panel.list") {
        return Promise.resolve({
          data:
            command.windowId === "secondary"
              ? [{ id: "panel-target", kind: "web" }]
              : [{ id: "panel-main", kind: "terminal" }],
          ok: true,
          requestId: `renderer-${command.windowId}`,
        });
      }
      if (command.type === "panel.focus") {
        return Promise.resolve({
          data: null,
          ok: true,
          requestId: "renderer-focus",
        });
      }
      throw new Error(`unexpected command: ${command.type}`);
    };
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { panelId: "panel-target", type: "panel.focus" },
        protocolVersion: 1,
        requestId: "req-panel-focus-global",
      })
    ).resolves.toEqual({
      data: { windowId: "secondary" },
      ok: true,
      requestId: "req-panel-focus-global",
    });
    expect(rendererCommands).toEqual([
      { type: "panel.list", windowId: "main" },
      { type: "panel.list", windowId: "secondary" },
      { panelId: "panel-target", type: "panel.focus", windowId: "secondary" },
    ]);
  });

  it("panel.focus without a window id rejects duplicate panel ids", async () => {
    const fakeServices = focusedWindowServices("main");
    fakeServices.rendererCommand.execute = (command) => {
      if (command.type !== "panel.list") {
        throw new Error(`unexpected command: ${command.type}`);
      }
      return Promise.resolve({
        data: [{ id: "terminal-1", kind: "terminal" }],
        ok: true,
        requestId: `renderer-${command.windowId}`,
      });
    };
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { panelId: "terminal-1", type: "panel.focus" },
        protocolVersion: 1,
        requestId: "req-panel-focus-ambiguous",
      })
    ).resolves.toEqual({
      error: {
        code: "invalid_command",
        message: "panel id is ambiguous: terminal-1; pass --window",
      },
      ok: false,
      requestId: "req-panel-focus-ambiguous",
    });
  });

  it("maps renderer focus not_found errors instead of flattening them", async () => {
    const fakeServices = services();
    fakeServices.rendererCommand.execute = (command) => {
      expect(command).toEqual({
        panelId: "missing",
        type: "panel.focus",
        windowId: "main",
      });
      return Promise.resolve({
        error: { code: "not_found", message: "panel not found: missing" },
        ok: false,
        requestId: "renderer-focus",
      });
    };
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { panelId: "missing", type: "panel.focus", windowId: "main" },
        protocolVersion: 1,
        requestId: "req-panel-focus-missing",
      })
    ).resolves.toEqual({
      error: {
        code: "not_found",
        message: "panel not found: missing",
      },
      ok: false,
      requestId: "req-panel-focus-missing",
    });
  });

  it("terminal.open without a window id uses the last focused live window when none is currently focused", async () => {
    const rendererCommands: unknown[] = [];
    const fakeServices = services();
    fakeServices.window.list = () => [
      {
        focused: false,
        id: "main",
        lastFocusedAt: 100,
        recordId: "record-main",
      },
      {
        focused: false,
        id: "secondary",
        lastFocusedAt: 200,
        recordId: "record-secondary",
      },
    ];
    fakeServices.rendererCommand.execute = (command) => {
      rendererCommands.push(command);
      return Promise.resolve({
        data: { panelId: "terminal-from-renderer" },
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
        command: { type: "terminal.open" },
        protocolVersion: 1,
        requestId: "req-terminal-open-last-focused",
      })
    ).resolves.toEqual({
      data: { panelId: "terminal-from-renderer", windowId: "secondary" },
      ok: true,
      requestId: "req-terminal-open-last-focused",
    });
    expect(rendererCommands).toEqual([
      { type: "terminal.open", windowId: "secondary" },
    ]);
  });

  it("terminal.open without a window id rejects ambiguous background windows", async () => {
    const fakeServices = services();
    fakeServices.window.list = () => [
      { focused: false, id: "main", recordId: "record-main" },
      { focused: false, id: "secondary", recordId: "record-secondary" },
    ];
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { type: "terminal.open" },
        protocolVersion: 1,
        requestId: "req-terminal-open-ambiguous",
      })
    ).resolves.toEqual({
      error: {
        code: "invalid_command",
        message: "multiple background windows available; pass --window",
      },
      ok: false,
      requestId: "req-terminal-open-ambiguous",
    });
  });

  it("terminal.focus without a window id rejects incomplete global terminal lists", async () => {
    const fakeServices = focusedWindowServices("main");
    fakeServices.rendererCommand.execute = (command) => {
      if (command.type !== "terminal.list") {
        throw new Error(`unexpected command: ${command.type}`);
      }
      if (command.windowId === "secondary") {
        return Promise.resolve({
          error: { message: "renderer command timed out" },
          ok: false,
          requestId: "renderer-req-secondary",
        });
      }
      return Promise.resolve({
        data: [
          {
            active: true,
            groupIndex: 0,
            panelId: "terminal-1",
            tabCount: 1,
            tabIndex: 0,
          },
        ],
        ok: true,
        requestId: "renderer-req-main",
      });
    };
    const router = createCommandRouter({
      clients: registryWith(desktopClient),
      services: fakeServices,
    });

    await expect(
      router.execute({
        clientId: "desktop-1",
        command: { panelId: "terminal-1", type: "terminal.focus" },
        protocolVersion: 1,
        requestId: "req-terminal-focus-partial",
      })
    ).resolves.toEqual({
      error: {
        code: "platform_unavailable",
        message: "terminal list incomplete; pass --window",
      },
      ok: false,
      requestId: "req-terminal-focus-partial",
    });
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
