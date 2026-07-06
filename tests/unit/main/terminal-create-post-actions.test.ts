import { sendInitialTerminalInput } from "@main/ipc/terminal-create-post-actions.ts";
import type { NativeAddon } from "@main/ipc/terminal-native-addon.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("terminal create post actions", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries initial input when the native terminal surface is not ready yet", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const sendText = vi
      .fn()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    sendInitialTerminalInput({
      addon: { sendText } as unknown as NativeAddon,
      initialInput: "修复终端焦点问题\r",
      nativePanelId: "7::terminal-1",
      panelId: "terminal-1",
    });

    expect(sendText).toHaveBeenCalledTimes(1);

    await vi.runOnlyPendingTimersAsync();

    expect(sendText).toHaveBeenCalledTimes(2);
    expect(sendText).toHaveBeenLastCalledWith(
      "7::terminal-1",
      "修复终端焦点问题\r"
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
