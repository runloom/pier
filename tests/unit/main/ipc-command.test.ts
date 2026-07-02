import { PIER } from "@shared/ipc-channels.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() =>
  vi.fn(async (envelope: { requestId: string }) => ({
    data: { envelope },
    ok: true,
    requestId: envelope.requestId,
  }))
);
const heartbeatMock = vi.hoisted(() => vi.fn(() => null));
const registerMock = vi.hoisted(() => vi.fn());

vi.mock("@main/app-core/app-core.ts", () => ({
  appCore: {
    clients: {
      heartbeat: heartbeatMock,
      register: registerMock,
    },
    commandRouter: {
      execute: executeMock,
    },
  },
}));

vi.mock("@main/windows/window-manager.ts", () => ({
  windowManager: {
    findInternalIdByWindow: vi.fn(() => "main"),
    fromWebContents: vi.fn(() => ({ id: 100 })),
  },
}));

describe("registerCommandIpc", () => {
  beforeEach(() => {
    executeMock.mockClear();
    heartbeatMock.mockClear();
    registerMock.mockClear();
  });

  it("把 renderer facade 命令包装成 desktop-renderer 客户端信封后交给 command router", async () => {
    const { registerCommandIpc } = await import("@main/ipc/command.ts");
    const handlers = new Map<
      string,
      (...args: unknown[]) => Promise<unknown>
    >();
    const ipcMain = {
      handle: vi.fn(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(channel, (...args) => Promise.resolve(handler(...args)));
        }
      ),
    };

    registerCommandIpc(ipcMain as never);

    const handler = handlers.get(PIER.COMMAND_EXECUTE);
    if (!handler) {
      throw new Error("expected command handler");
    }

    await handler(
      { sender: { id: "web-contents" } },
      { path: "/repo", type: "worktree.check" }
    );

    expect(registerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "desktop-renderer:main",
        kind: "desktop-renderer",
      })
    );
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "desktop-renderer:main",
        command: { path: "/repo", type: "worktree.check" },
        protocolVersion: 1,
        requestId: expect.any(String),
      })
    );
  });

  it("给 renderer run.spawn 注入 sender windowId", async () => {
    const { registerCommandIpc } = await import("@main/ipc/command.ts");
    const handlers = new Map<
      string,
      (...args: unknown[]) => Promise<unknown>
    >();
    const ipcMain = {
      handle: vi.fn(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(channel, (...args) => Promise.resolve(handler(...args)));
        }
      ),
    };

    registerCommandIpc(ipcMain as never);

    const handler = handlers.get(PIER.COMMAND_EXECUTE);
    if (!handler) {
      throw new Error("expected command handler");
    }

    await handler(
      { sender: { id: "web-contents" } },
      { projectRoot: "/repo", taskId: "package-script:test", type: "run.spawn" }
    );

    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: {
          projectRoot: "/repo",
          taskId: "package-script:test",
          type: "run.spawn",
          windowId: "main",
        },
      })
    );
  });

  it("允许 renderer facade 调用 run.status 和 run.cancel", async () => {
    const { registerCommandIpc } = await import("@main/ipc/command.ts");
    const handlers = new Map<
      string,
      (...args: unknown[]) => Promise<unknown>
    >();
    const ipcMain = {
      handle: vi.fn(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(channel, (...args) => Promise.resolve(handler(...args)));
        }
      ),
    };

    registerCommandIpc(ipcMain as never);

    const handler = handlers.get(PIER.COMMAND_EXECUTE);
    if (!handler) {
      throw new Error("expected command handler");
    }

    await expect(
      handler(
        { sender: { id: "web-contents" } },
        { runId: "run-1", type: "run.status" }
      )
    ).resolves.toMatchObject({ ok: true });
    await expect(
      handler(
        { sender: { id: "web-contents" } },
        { runId: "run-1", type: "run.cancel" }
      )
    ).resolves.toMatchObject({ ok: true });
  });

  it("允许 renderer facade 调用 git.searchBranches", async () => {
    const { registerCommandIpc } = await import("@main/ipc/command.ts");
    const handlers = new Map<
      string,
      (...args: unknown[]) => Promise<unknown>
    >();
    const ipcMain = {
      handle: vi.fn(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(channel, (...args) => Promise.resolve(handler(...args)));
        }
      ),
    };

    registerCommandIpc(ipcMain as never);

    const handler = handlers.get(PIER.COMMAND_EXECUTE);
    if (!handler) {
      throw new Error("expected command handler");
    }

    await expect(
      handler(
        { sender: { id: "web-contents" } },
        {
          cwd: "/repo",
          options: { limit: 50, query: "" },
          type: "git.searchBranches",
        }
      )
    ).resolves.toMatchObject({ ok: true });
    expect(executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: {
          cwd: "/repo",
          options: { limit: 50, query: "" },
          type: "git.searchBranches",
        },
      })
    );
  });

  it("允许 renderer facade 调用 worktree.creationDefaults 和 worktree.openTerminal", async () => {
    const { registerCommandIpc } = await import("@main/ipc/command.ts");
    const handlers = new Map<
      string,
      (...args: unknown[]) => Promise<unknown>
    >();
    const ipcMain = {
      handle: vi.fn(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(channel, (...args) => Promise.resolve(handler(...args)));
        }
      ),
    };

    registerCommandIpc(ipcMain as never);

    const handler = handlers.get(PIER.COMMAND_EXECUTE);
    if (!handler) {
      throw new Error("expected command handler");
    }

    await expect(
      handler(
        { sender: { id: "web-contents" } },
        { type: "worktree.creationDefaults" }
      )
    ).resolves.toMatchObject({ ok: true });
    await expect(
      handler(
        { sender: { id: "web-contents" } },
        { path: "/repo", runSetup: false, type: "worktree.openTerminal" }
      )
    ).resolves.toMatchObject({ ok: true });
  });

  it("拒绝 renderer 侧任意 command 直通", async () => {
    const { registerCommandIpc } = await import("@main/ipc/command.ts");
    const handlers = new Map<
      string,
      (...args: unknown[]) => Promise<unknown>
    >();
    const ipcMain = {
      handle: vi.fn(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(channel, (...args) => Promise.resolve(handler(...args)));
        }
      ),
    };

    registerCommandIpc(ipcMain as never);

    const handler = handlers.get(PIER.COMMAND_EXECUTE);
    if (!handler) {
      throw new Error("expected command handler");
    }

    await expect(
      handler(
        { sender: { id: "web-contents" } },
        { path: "/repo", type: "panel.open" }
      )
    ).rejects.toThrow("unsupported renderer command");
    expect(executeMock).not.toHaveBeenCalled();
  });
});
