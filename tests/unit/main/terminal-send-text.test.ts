import { describe, expect, it, vi } from "vitest";
import type { NativeAddon } from "../../../src/main/ipc/terminal-native-addon.ts";
import {
  sendTerminalKeyPress,
  sendTerminalText,
} from "../../../src/main/ipc/terminal-operations.ts";
import type { AppWindow } from "../../../src/main/windows/app-window.ts";
import {
  APPKIT_KEYCODE,
  GHOSTTY_MODS,
} from "../../../src/shared/terminal-appkit-keys.ts";

function fakeAddon(handlers: {
  sendKeyPress?: (id: string, keycode: number, mods?: number) => boolean;
  sendText: (id: string, text: string) => boolean;
}): NativeAddon {
  return {
    sendKeyPress: vi.fn(handlers.sendKeyPress ?? (() => true)),
    sendText: vi.fn(handlers.sendText),
  } as unknown as NativeAddon;
}
const win = { id: 7 } as unknown as AppWindow;

describe("sendTerminalText", () => {
  it("submit=true 时先 paste 文本再注入 Return 键（不把 \\r 拼进同一次 sendText）", () => {
    const addon = fakeAddon({ sendText: () => true });
    const result = sendTerminalText({
      addon,
      args: { panelId: "terminal-a", submit: true, text: "echo hi" },
      loadError: null,
      win,
    });
    expect(result).toEqual({ ok: true });
    expect(addon.sendText).toHaveBeenCalledWith("7::terminal-a", "echo hi");
    expect(addon.sendKeyPress).toHaveBeenCalledWith(
      "7::terminal-a",
      APPKIT_KEYCODE.return
    );
  });

  it("不带 submit 时原样透传（多行由 bracketed paste 兜底）", () => {
    const addon = fakeAddon({ sendText: () => true });
    sendTerminalText({
      addon,
      args: { panelId: "terminal-a", text: "line1\nline2" },
      loadError: null,
      win,
    });
    expect(addon.sendText).toHaveBeenCalledWith(
      "7::terminal-a",
      "line1\nline2"
    );
    expect(addon.sendKeyPress).not.toHaveBeenCalled();
  });

  it("addon 未加载返回 loadError", () => {
    const result = sendTerminalText({
      addon: null,
      args: { panelId: "terminal-a", text: "x" },
      loadError: "boom",
      win,
    });
    expect(result).toEqual({ ok: false, error: "boom" });
  });

  it("拒绝空文本 / 空 panelId / 超长文本", () => {
    const addon = fakeAddon({ sendText: () => true });
    for (const args of [
      { panelId: "terminal-a", text: "" },
      { panelId: "", text: "x" },
      { panelId: "terminal-a", text: "x".repeat(64_001) },
      "not-an-object",
    ]) {
      const result = sendTerminalText({ addon, args, loadError: null, win });
      expect(result.ok).toBe(false);
    }
    expect(addon.sendText).not.toHaveBeenCalled();
  });

  it("窗口缺失与 surface 未就绪各返回明确错误", () => {
    const addon = fakeAddon({ sendText: () => false });
    expect(
      sendTerminalText({
        addon,
        args: { panelId: "terminal-a", text: "x" },
        loadError: null,
        win: null,
      }).ok
    ).toBe(false);
    const notReady = sendTerminalText({
      addon,
      args: { panelId: "terminal-a", text: "x" },
      loadError: null,
      win,
    });
    expect(notReady).toEqual({
      ok: false,
      error: "terminal surface not ready",
    });
  });

  it("submit 时文本成功但 Return 键失败则标记 textDelivered", () => {
    const addon = fakeAddon({
      sendKeyPress: () => false,
      sendText: () => true,
    });
    const result = sendTerminalText({
      addon,
      args: { panelId: "terminal-a", submit: true, text: "hi" },
      loadError: null,
      win,
    });
    expect(result).toEqual({
      ok: false,
      error: "terminal surface not ready",
      textDelivered: true,
    });
  });
});

describe("sendTerminalKeyPress", () => {
  it("按窗口前缀路由 keycode + mods", () => {
    const addon = fakeAddon({ sendText: () => true });
    const result = sendTerminalKeyPress({
      addon,
      args: {
        keycode: APPKIT_KEYCODE.c,
        mods: GHOSTTY_MODS.ctrl,
        panelId: "terminal-a",
      },
      loadError: null,
      win,
    });
    expect(result).toEqual({ ok: true });
    expect(addon.sendKeyPress).toHaveBeenCalledWith(
      "7::terminal-a",
      APPKIT_KEYCODE.c,
      GHOSTTY_MODS.ctrl
    );
  });

  it("mods 缺省为 0", () => {
    const addon = fakeAddon({ sendText: () => true });
    sendTerminalKeyPress({
      addon,
      args: { keycode: APPKIT_KEYCODE.escape, panelId: "terminal-a" },
      loadError: null,
      win,
    });
    expect(addon.sendKeyPress).toHaveBeenCalledWith(
      "7::terminal-a",
      APPKIT_KEYCODE.escape,
      0
    );
  });

  it("拒绝非法 keycode / mods / panelId", () => {
    const addon = fakeAddon({ sendText: () => true });
    for (const args of [
      { keycode: -1, panelId: "terminal-a" },
      { keycode: 0x1_00, panelId: "terminal-a" },
      { keycode: 1.5, panelId: "terminal-a" },
      { keycode: APPKIT_KEYCODE.escape, mods: -1, panelId: "terminal-a" },
      { keycode: APPKIT_KEYCODE.escape, panelId: "" },
      "not-an-object",
    ]) {
      expect(
        sendTerminalKeyPress({ addon, args, loadError: null, win }).ok
      ).toBe(false);
    }
    expect(addon.sendKeyPress).not.toHaveBeenCalled();
  });
});
