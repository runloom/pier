import { PIER } from "@shared/ipc-channels.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const handleMock = vi.hoisted(() => vi.fn());
const fromWebContentsMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  ipcMain: { handle: handleMock },
}));

vi.mock("@main/windows/window-manager.ts", () => ({
  windowManager: { fromWebContents: fromWebContentsMock },
}));

import { registerPluginRpcIpc } from "@main/plugins/plugin-rpc-ipc.ts";

type Handler = (
  event: { sender: { mainFrame: object }; senderFrame: object },
  payload: unknown
) => Promise<unknown>;

describe("registerPluginRpcIpc", () => {
  beforeEach(() => {
    handleMock.mockReset();
    fromWebContentsMock.mockReset();
  });

  function register(): { handler: Handler; invoke: ReturnType<typeof vi.fn> } {
    const invoke = vi.fn(async () => ({ data: "ok", ok: true as const }));
    registerPluginRpcIpc({
      clearPlugin: vi.fn(),
      emit: vi.fn(),
      handle: vi.fn(),
      invoke,
    });
    expect(handleMock).toHaveBeenCalledWith(
      PIER.PLUGIN_RPC_INVOKE,
      expect.any(Function)
    );
    return { handler: handleMock.mock.calls[0]?.[1] as Handler, invoke };
  }

  it("accepts RPC only from webContents owned by a Pier app window", async () => {
    const mainFrame = {};
    const sender = { mainFrame };
    fromWebContentsMock.mockReturnValue({ id: "main" });
    const { handler, invoke } = register();
    const request = {
      method: "accounts.snapshot",
      payload: null,
      pluginId: "pier.codex",
    };

    await expect(
      handler({ sender, senderFrame: mainFrame }, request)
    ).resolves.toEqual({
      data: "ok",
      ok: true,
    });
    expect(fromWebContentsMock).toHaveBeenCalledWith(sender);
    expect(invoke).toHaveBeenCalledWith(request);
  });

  it("rejects DevTools and unknown webContents before parsing or dispatch", async () => {
    const mainFrame = {};
    const sender = { mainFrame };
    fromWebContentsMock.mockReturnValue(null);
    const { handler, invoke } = register();

    await expect(
      handler({ sender, senderFrame: mainFrame }, { malformed: true })
    ).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "unrecognized webContents",
      },
      ok: false,
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects child frames from an otherwise owned Pier window", async () => {
    const mainFrame = {};
    const sender = { mainFrame };
    fromWebContentsMock.mockReturnValue({ id: "main" });
    const { handler, invoke } = register();

    await expect(
      handler(
        { sender, senderFrame: {} },
        { method: "accounts.snapshot", payload: null, pluginId: "pier.codex" }
      )
    ).resolves.toMatchObject({ ok: false });
    expect(invoke).not.toHaveBeenCalled();
  });
});
