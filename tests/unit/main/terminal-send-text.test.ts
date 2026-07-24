import { describe, expect, it, vi } from "vitest";
import type { NativeAddon } from "../../../src/main/ipc/terminal-native-addon.ts";
import {
  readTerminalCursorVisibility,
  sendTerminalKeyPress,
  sendTerminalText,
} from "../../../src/main/ipc/terminal-operations.ts";
import type { AppWindow } from "../../../src/main/windows/app-window.ts";
import {
  APPKIT_KEYCODE,
  GHOSTTY_MODS,
} from "../../../src/shared/terminal-appkit-keys.ts";

function fakeAddon(handlers: {
  sendKeyPress?: (
    id: string,
    keycode: number,
    mods?: number,
    text?: string
  ) => boolean;
  sendText: (id: string, text: string) => boolean;
}): NativeAddon {
  return {
    sendKeyPress: vi.fn(handlers.sendKeyPress ?? (() => true)),
    sendText: vi.fn(handlers.sendText),
  } as unknown as NativeAddon;
}
const win = { id: 7 } as unknown as AppWindow;

describe("sendTerminalText", () => {
  it("submit=true 时先 paste 文本，settle 延迟后再注入带 \\r 文本的 Return 键", async () => {
    vi.useFakeTimers();
    try {
      const addon = fakeAddon({ sendText: () => true });
      const pending = sendTerminalText({
        addon,
        args: { panelId: "terminal-a", submit: true, text: "echo hi" },
        loadError: null,
        win,
      });
      // paste 经 panel 发送队列在微任务内发生；Return 必须再等 settle 延迟。
      await vi.advanceTimersByTimeAsync(0);
      expect(addon.sendText).toHaveBeenCalledWith("7::terminal-a", "echo hi");
      expect(addon.sendKeyPress).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      const result = await pending;
      expect(result).toEqual({ ok: true });
      expect(addon.sendKeyPress).toHaveBeenCalledWith(
        "7::terminal-a",
        APPKIT_KEYCODE.return,
        0,
        "\r"
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("不带 submit 时原样透传（多行由 bracketed paste 兜底）", async () => {
    const addon = fakeAddon({ sendText: () => true });
    await sendTerminalText({
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

  it("addon 未加载返回 loadError", async () => {
    const result = await sendTerminalText({
      addon: null,
      args: { panelId: "terminal-a", text: "x" },
      loadError: "boom",
      win,
    });
    expect(result).toEqual({ ok: false, error: "boom" });
  });

  it("拒绝空文本 / 空 panelId / 超长文本", async () => {
    const addon = fakeAddon({ sendText: () => true });
    for (const args of [
      { panelId: "terminal-a", text: "" },
      { panelId: "", text: "x" },
      { panelId: "terminal-a", text: "x".repeat(64_001) },
      "not-an-object",
    ]) {
      const result = await sendTerminalText({
        addon,
        args,
        loadError: null,
        win,
      });
      expect(result.ok).toBe(false);
    }
    expect(addon.sendText).not.toHaveBeenCalled();
  });

  it("窗口缺失与 surface 未就绪各返回明确错误", async () => {
    const addon = fakeAddon({ sendText: () => false });
    expect(
      (
        await sendTerminalText({
          addon,
          args: { panelId: "terminal-a", text: "x" },
          loadError: null,
          win: null,
        })
      ).ok
    ).toBe(false);
    const notReady = await sendTerminalText({
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

  it("submit 时文本成功但 Return 键失败则标记 textDelivered", async () => {
    vi.useFakeTimers();
    try {
      const addon = fakeAddon({
        sendKeyPress: () => false,
        sendText: () => true,
      });
      const pending = sendTerminalText({
        addon,
        args: { panelId: "terminal-a", submit: true, text: "hi" },
        loadError: null,
        win,
      });
      await vi.advanceTimersByTimeAsync(100);
      const result = await pending;
      expect(result).toEqual({
        ok: false,
        error: "terminal surface not ready",
        textDelivered: true,
      });
    } finally {
      vi.useRealTimers();
    }
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

describe("readTerminalCursorVisibility", () => {
  function addonWith(value: number | (() => number)): NativeAddon {
    return {
      readCursorVisible: vi.fn(
        typeof value === "function" ? value : () => value
      ),
    } as unknown as NativeAddon;
  }

  it("映射 1/0/-1 到 visible/hidden/unknown，并带窗口前缀路由", () => {
    expect(
      readTerminalCursorVisibility({ addon: addonWith(1), panelId: "a", win })
    ).toBe("visible");
    expect(
      readTerminalCursorVisibility({ addon: addonWith(0), panelId: "a", win })
    ).toBe("hidden");
    expect(
      readTerminalCursorVisibility({ addon: addonWith(-1), panelId: "a", win })
    ).toBe("unknown");
    const addon = addonWith(1);
    readTerminalCursorVisibility({ addon, panelId: "terminal-a", win });
    expect(addon.readCursorVisible).toHaveBeenCalledWith("7::terminal-a");
  });

  it("addon 缺失 / window 缺失 / panelId 非法 / addon 抛错一律 unknown", () => {
    expect(
      readTerminalCursorVisibility({ addon: null, panelId: "a", win })
    ).toBe("unknown");
    expect(
      readTerminalCursorVisibility({
        addon: addonWith(1),
        panelId: "a",
        win: null,
      })
    ).toBe("unknown");
    expect(
      readTerminalCursorVisibility({ addon: addonWith(1), panelId: 42, win })
    ).toBe("unknown");
    expect(
      readTerminalCursorVisibility({
        addon: addonWith(() => {
          throw new Error("boom");
        }),
        panelId: "a",
        win,
      })
    ).toBe("unknown");
  });
});

describe("submit 发送队列", () => {
  it("并发 submit 按 panel 串行化：enter1 先于 paste2", async () => {
    vi.useFakeTimers();
    try {
      const calls: string[] = [];
      const addon = {
        sendKeyPress: vi.fn(() => {
          calls.push("enter");
          return true;
        }),
        sendText: vi.fn(() => {
          calls.push("paste");
          return true;
        }),
      } as unknown as NativeAddon;
      const first = sendTerminalText({
        addon,
        args: { panelId: "terminal-a", submit: true, text: "one" },
        loadError: null,
        win,
      });
      const second = sendTerminalText({
        addon,
        args: { panelId: "terminal-a", submit: true, text: "two" },
        loadError: null,
        win,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toEqual(["paste"]);
      await vi.advanceTimersByTimeAsync(100);
      expect(calls).toEqual(["paste", "enter", "paste"]);
      await vi.advanceTimersByTimeAsync(100);
      expect(calls).toEqual(["paste", "enter", "paste", "enter"]);
      await expect(first).resolves.toEqual({ ok: true });
      await expect(second).resolves.toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
    }
  });
});
