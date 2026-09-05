import type { NativeAddon } from "@main/ipc/terminal/native-addon.ts";
import { performTerminalOperation } from "@main/ipc/terminal/operations.ts";
import type { AppWindow } from "@main/windows/app-window.ts";
import { describe, expect, it, vi } from "vitest";

function fixture() {
  const addon = {
    performTerminalBindingAction: vi.fn(() => true),
    sendKeyPress: vi.fn(),
    sendText: vi.fn(),
  };
  return {
    addon,
    options: {
      addon: addon as unknown as NativeAddon,
      loadError: null,
      operation: "scrollToBottom",
      panelId: "terminal-1",
      win: { id: 7 } as AppWindow,
    },
  };
}

describe("scroll to bottom native operation", () => {
  it("scopes identical panel IDs to their windows without sending TUI input", () => {
    const { addon, options } = fixture();
    expect(performTerminalOperation(options)).toEqual({ ok: true });
    expect(
      performTerminalOperation({ ...options, win: { id: 8 } as AppWindow })
    ).toEqual({ ok: true });
    expect(addon.performTerminalBindingAction.mock.calls).toEqual([
      ["7::terminal-1", "scroll_to_bottom"],
      ["8::terminal-1", "scroll_to_bottom"],
    ]);
    expect(addon.sendText).not.toHaveBeenCalled();
    expect(addon.sendKeyPress).not.toHaveBeenCalled();
  });

  it.each([
    [{ addon: null, loadError: "addon unavailable" }, "addon unavailable"],
    [{ addon: null }, "native addon not loaded"],
    [{ win: null }, "window not found"],
    [{ panelId: "" }, "invalid panel id"],
    [{ operation: "scroll_to_bottom" }, "invalid terminal operation"],
  ])("rejects unavailable or invalid targets: %j", (overrides, error) => {
    const { addon, options } = fixture();
    expect(performTerminalOperation({ ...options, ...overrides })).toEqual({
      error,
      ok: false,
    });
    expect(addon.performTerminalBindingAction).not.toHaveBeenCalled();
  });

  it("reports a native action failure without retrying another panel", () => {
    const { addon, options } = fixture();
    addon.performTerminalBindingAction.mockReturnValue(false);
    expect(performTerminalOperation(options)).toEqual({
      error: "terminal operation failed",
      ok: false,
    });
    expect(addon.performTerminalBindingAction).toHaveBeenCalledExactlyOnceWith(
      "7::terminal-1",
      "scroll_to_bottom"
    );
  });

  it("preserves native exception details", () => {
    const { addon, options } = fixture();
    addon.performTerminalBindingAction.mockImplementation(() => {
      throw new Error("surface disposed");
    });
    expect(performTerminalOperation(options)).toEqual({
      error: "surface disposed",
      ok: false,
    });
  });
});
