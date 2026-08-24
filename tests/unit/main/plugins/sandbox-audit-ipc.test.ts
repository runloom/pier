import { PIER } from "@shared/ipc-channels.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const handleMock = vi.hoisted(() => vi.fn());
const fromWebContentsMock = vi.hoisted(() => vi.fn());
const findInternalIdMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({ ipcMain: { handle: handleMock } }));
vi.mock("@main/windows/manager.ts", () => ({
  windowManager: {
    findInternalIdByWindow: findInternalIdMock,
    fromWebContents: fromWebContentsMock,
  },
}));

import { registerSandboxAuditIpc } from "@main/plugins/sandbox-audit-ipc.ts";

type Handler = (
  event: {
    sender: { id: number; mainFrame: object };
    senderFrame: object;
  },
  payload: unknown
) => Promise<void>;

describe("registerSandboxAuditIpc", () => {
  beforeEach(() => {
    handleMock.mockReset();
    fromWebContentsMock.mockReset();
    findInternalIdMock.mockReset();
  });

  function register() {
    const append = vi.fn(async () => undefined);
    registerSandboxAuditIpc({ append } as never);
    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === PIER.PLUGIN_SANDBOX_AUDIT
    )?.[1] as Handler;
    return { append, handler };
  }

  it("appends a validated frozen audit with the owning window", async () => {
    const mainFrame = {};
    const sender = { id: 11, mainFrame };
    fromWebContentsMock.mockReturnValue({});
    findInternalIdMock.mockReturnValue("window-main");
    const { append, handler } = register();

    await handler(
      { sender, senderFrame: mainFrame },
      {
        detail: "token mismatch",
        event: "frozen",
        pluginId: "third.demo",
        version: "1.0.0",
      }
    );
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        actorKind: "desktop-renderer",
        diagnosticId: "token mismatch",
        operation: "sandbox.frozen",
        pluginId: "third.demo",
        result: "denied",
        toVersion: "1.0.0",
      })
    );
  });

  it("rejects child frames and unknown windows", async () => {
    fromWebContentsMock.mockReturnValue({});
    findInternalIdMock.mockReturnValue("window-main");
    const { append, handler } = register();
    await expect(
      handler(
        { sender: { id: 1, mainFrame: {} }, senderFrame: {} },
        { event: "frozen", pluginId: "third.demo" }
      )
    ).rejects.toThrow("not the main frame");
    expect(append).not.toHaveBeenCalled();

    fromWebContentsMock.mockReturnValue(null);
    const second = register();
    const mainFrame = {};
    await expect(
      second.handler(
        { sender: { id: 2, mainFrame }, senderFrame: mainFrame },
        { event: "frozen", pluginId: "third.demo" }
      )
    ).rejects.toThrow("not a Pier window");
  });

  it("drops audits after the per-sender cap", async () => {
    const mainFrame = {};
    const sender = { id: 3, mainFrame };
    fromWebContentsMock.mockReturnValue({});
    findInternalIdMock.mockReturnValue("window-main");
    const { append, handler } = register();
    const payload = { event: "call-denied" as const, pluginId: "third.demo" };
    for (let i = 0; i < 50; i += 1) {
      await handler({ sender, senderFrame: mainFrame }, payload);
    }
    await handler({ sender, senderFrame: mainFrame }, payload);
    expect(append).toHaveBeenCalledTimes(50);
  });
});
