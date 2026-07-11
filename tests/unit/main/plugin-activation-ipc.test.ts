import { PIER } from "@shared/ipc-channels.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const handleMock = vi.hoisted(() => vi.fn());
const fromWebContentsMock = vi.hoisted(() => vi.fn());
const findInternalIdMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({ ipcMain: { handle: handleMock } }));
vi.mock("@main/windows/window-manager.ts", () => ({
  windowManager: {
    findInternalIdByWindow: findInternalIdMock,
    fromWebContents: fromWebContentsMock,
  },
}));

import { registerPluginActivationIpc } from "@main/plugins/plugin-activation-ipc.ts";

type Handler = (
  event: { sender: { mainFrame: object }; senderFrame: object },
  payload: unknown
) => Promise<void>;

describe("registerPluginActivationIpc", () => {
  beforeEach(() => {
    handleMock.mockReset();
    fromWebContentsMock.mockReset();
    findInternalIdMock.mockReset();
  });

  function register() {
    const recordActivationResult = vi.fn(async () => undefined);
    registerPluginActivationIpc({ recordActivationResult } as never);
    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === PIER.PLUGIN_RENDERER_ACTIVATION_REPORT
    )?.[1] as Handler;
    return { handler, recordActivationResult };
  }

  it("injects the owned Pier window id into a validated renderer report", async () => {
    const mainFrame = {};
    const sender = { mainFrame };
    const window = {};
    fromWebContentsMock.mockReturnValue(window);
    findInternalIdMock.mockReturnValue("window-main");
    const { handler, recordActivationResult } = register();

    await handler(
      { sender, senderFrame: mainFrame },
      { ok: true, pluginId: "pier.codex", version: "1.0.3" }
    );
    expect(recordActivationResult).toHaveBeenCalledWith({
      ok: true,
      phase: "renderer",
      pluginId: "pier.codex",
      version: "1.0.3",
      windowId: "window-main",
    });
  });

  it("rejects unknown senders and malformed reports", async () => {
    fromWebContentsMock.mockReturnValue(null);
    const first = register();
    const mainFrame = {};
    await expect(
      first.handler({ sender: { mainFrame }, senderFrame: mainFrame }, {})
    ).rejects.toThrow("not a Pier window");

    fromWebContentsMock.mockReturnValue({});
    findInternalIdMock.mockReturnValue("window-main");
    const second = register();
    const secondMainFrame = {};
    await expect(
      second.handler(
        {
          sender: { mainFrame: secondMainFrame },
          senderFrame: secondMainFrame,
        },
        { ok: true, pluginId: "" }
      )
    ).rejects.toThrow();
  });

  it("rejects renderer reports from child frames", async () => {
    fromWebContentsMock.mockReturnValue({});
    findInternalIdMock.mockReturnValue("window-main");
    const { handler, recordActivationResult } = register();

    await expect(
      handler(
        { sender: { mainFrame: {} }, senderFrame: {} },
        { ok: true, pluginId: "pier.codex", version: "1.0.0" }
      )
    ).rejects.toThrow("not the main frame");
    expect(recordActivationResult).not.toHaveBeenCalled();
  });
});
