import { sendInitialTerminalInput } from "@main/ipc/terminal-create-post-actions.ts";
import {
  cancelPromptReady,
  signalPromptReady,
} from "@main/ipc/terminal-initial-input-gate.ts";
import type { NativeAddon } from "@main/ipc/terminal-native-addon.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("terminal create post actions", () => {
  afterEach(() => {
    // 清掉可能残留的 fallback timer，防止跨用例污染。
    cancelPromptReady("terminal-1");
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("gates injection on prompt-ready and retries when the surface is not ready yet", async () => {
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

    // Prompt 未就绪之前不写 stdin，避免 raw tty echo 打乱登录 banner。
    expect(sendText).not.toHaveBeenCalled();

    signalPromptReady("terminal-1");
    expect(sendText).toHaveBeenCalledTimes(1);

    await vi.runOnlyPendingTimersAsync();

    expect(sendText).toHaveBeenCalledTimes(2);
    expect(sendText).toHaveBeenLastCalledWith(
      "7::terminal-1",
      "修复终端焦点问题\r"
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back to a timer when the shell integration never emits OSC 7", async () => {
    vi.useFakeTimers();
    const sendText = vi.fn().mockReturnValue(true);

    sendInitialTerminalInput({
      addon: { sendText } as unknown as NativeAddon,
      initialInput: "hello\r",
      nativePanelId: "7::terminal-1",
      panelId: "terminal-1",
    });

    expect(sendText).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it("skips injection entirely when initialInput is empty", () => {
    const sendText = vi.fn();
    sendInitialTerminalInput({
      addon: { sendText } as unknown as NativeAddon,
      initialInput: undefined,
      nativePanelId: "7::terminal-1",
      panelId: "terminal-1",
    });
    expect(sendText).not.toHaveBeenCalled();
  });
});
