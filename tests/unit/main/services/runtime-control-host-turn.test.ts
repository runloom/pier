import { createHostTerminalBackend } from "@main/services/runtime-control/host-backend.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendText = vi.fn(() => true);
const sendKeyPress = vi.fn(() => true);

vi.mock("../../../../src/main/ipc/terminal/index.ts", () => ({
  getTerminalAddon: () => ({
    sendText,
    sendKeyPress,
    readViewportText: () => "ok",
    closeTerminal: () => true,
  }),
}));

vi.mock("../../../../src/main/windows/identity.ts", () => ({
  findAppWindowByInternalId: () => ({
    id: 1,
    isDestroyed: () => false,
  }),
}));

vi.mock("../../../../src/main/ipc/terminal/panel-id.ts", () => ({
  toNativePanelKey: (_win: unknown, panelId: string) => `1::${panelId}`,
}));

describe("host backend turn submit", () => {
  beforeEach(() => {
    sendText.mockClear();
    sendKeyPress.mockClear();
  });

  it("pastes body then Return when text ends with newline", async () => {
    vi.useFakeTimers();
    const backend = createHostTerminalBackend({
      executeCommand: async () => ({
        ok: true,
        requestId: "r",
        data: { panelId: "p1", windowId: "win_1" },
      }),
    });
    await backend.create({ agentId: "codex" });
    const pending = backend.sendText("p1", "hello\n");
    await vi.advanceTimersByTimeAsync(100);
    const ok = await pending;
    expect(ok).toBe(true);
    expect(sendText).toHaveBeenCalledWith("1::p1", "hello");
    expect(sendKeyPress).toHaveBeenCalledWith("1::p1", 0x24, 0, "\r");
    vi.useRealTimers();
  });

  it("does not inject Return when no trailing newline", async () => {
    const backend = createHostTerminalBackend({
      executeCommand: async () => ({
        ok: true,
        requestId: "r",
        data: { panelId: "p1", windowId: "win_1" },
      }),
    });
    await backend.create({ agentId: "codex" });
    await backend.sendText("p1", "partial");
    expect(sendText).toHaveBeenCalledWith("1::p1", "partial");
    expect(sendKeyPress).not.toHaveBeenCalled();
  });
});
