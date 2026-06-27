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
