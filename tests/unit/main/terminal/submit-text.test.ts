import { describe, expect, it, vi } from "vitest";
import type { NativeAddon } from "../../../../src/main/ipc/terminal/native-addon.ts";
import {
  pasteTerminalText,
  SUBMIT_ENTER_SETTLE_MS,
  sendTerminalSubmitReturn,
} from "../../../../src/main/ipc/terminal/submit-text.ts";
import { APPKIT_KEYCODE } from "../../../../src/shared/terminal-appkit-keys.ts";

function fakeAddon(handlers: {
  sendKeyPress?: () => boolean;
  sendText: () => boolean;
}): NativeAddon {
  return {
    sendKeyPress: vi.fn(handlers.sendKeyPress ?? (() => true)),
    sendText: vi.fn(handlers.sendText),
  } as unknown as NativeAddon;
}

describe("pasteTerminalText", () => {
  it("pastes then submits Return after settle", async () => {
    vi.useFakeTimers();
    try {
      const addon = fakeAddon({ sendText: () => true });
      const pending = pasteTerminalText({
        addon,
        nativePanelId: "7::t1",
        submit: true,
        text: "pnpm setup:worktree",
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(addon.sendText).toHaveBeenCalledWith(
        "7::t1",
        "pnpm setup:worktree"
      );
      expect(addon.sendKeyPress).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(SUBMIT_ENTER_SETTLE_MS);
      await expect(pending).resolves.toEqual({ ok: true });
      expect(addon.sendKeyPress).toHaveBeenCalledWith(
        "7::t1",
        APPKIT_KEYCODE.return,
        0,
        "\r"
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not inject Return when submit is false", async () => {
    const addon = fakeAddon({ sendText: () => true });
    await expect(
      pasteTerminalText({
        addon,
        nativePanelId: "7::t1",
        submit: false,
        text: "partial",
      })
    ).resolves.toEqual({ ok: true });
    expect(addon.sendKeyPress).not.toHaveBeenCalled();
  });

  it("empty text with submit only sends Return", async () => {
    vi.useFakeTimers();
    try {
      const addon = fakeAddon({ sendText: () => true });
      const pending = pasteTerminalText({
        addon,
        nativePanelId: "7::t1",
        submit: true,
        text: "",
      });
      await vi.advanceTimersByTimeAsync(SUBMIT_ENTER_SETTLE_MS);
      await expect(pending).resolves.toEqual({ ok: true });
      expect(addon.sendText).not.toHaveBeenCalled();
      expect(addon.sendKeyPress).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves textDelivered when Return throws after a successful paste", async () => {
    vi.useFakeTimers();
    try {
      const addon = fakeAddon({
        sendKeyPress: () => {
          throw new Error("key exploded");
        },
        sendText: () => true,
      });
      const pending = pasteTerminalText({
        addon,
        nativePanelId: "7::t1",
        submit: true,
        text: "echo hi",
      });
      await vi.advanceTimersByTimeAsync(SUBMIT_ENTER_SETTLE_MS);
      await expect(pending).resolves.toEqual({
        error: "key exploded",
        ok: false,
        textDelivered: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks textDelivered when paste succeeds but Return fails", async () => {
    vi.useFakeTimers();
    try {
      const addon = fakeAddon({
        sendKeyPress: () => false,
        sendText: () => true,
      });
      const pending = pasteTerminalText({
        addon,
        nativePanelId: "7::t1",
        submit: true,
        text: "echo hi",
      });
      await vi.advanceTimersByTimeAsync(SUBMIT_ENTER_SETTLE_MS);
      await expect(pending).resolves.toEqual({
        error: "terminal surface not ready",
        ok: false,
        textDelivered: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("sendTerminalSubmitReturn", () => {
  it("only injects Return", async () => {
    const addon = fakeAddon({ sendText: () => true });
    await expect(sendTerminalSubmitReturn(addon, "7::t1")).resolves.toBe(true);
    expect(addon.sendText).not.toHaveBeenCalled();
    expect(addon.sendKeyPress).toHaveBeenCalledWith(
      "7::t1",
      APPKIT_KEYCODE.return,
      0,
      "\r"
    );
  });
});
