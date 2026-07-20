import { APPKIT_KEYCODE, GHOSTTY_MODS } from "@shared/terminal-appkit-keys.ts";
import { describe, expect, it } from "vitest";
import { passthroughKeyPressForKey } from "@/panel-kits/terminal/terminal-composer-passthrough.ts";

const base = {
  altKey: false,
  ctrlKey: false,
  empty: true,
  key: "",
  metaKey: false,
  shiftKey: false,
};

describe("passthroughKeyPressForKey", () => {
  it("Esc / Ctrl+C 任何时候透传为真实按键（无论 empty）", () => {
    expect(
      passthroughKeyPressForKey({ ...base, empty: false, key: "Escape" })
    ).toEqual({ keycode: APPKIT_KEYCODE.escape });
    expect(
      passthroughKeyPressForKey({ ...base, empty: true, key: "Escape" })
    ).toEqual({ keycode: APPKIT_KEYCODE.escape });
    expect(
      passthroughKeyPressForKey({
        ...base,
        ctrlKey: true,
        empty: false,
        key: "c",
      })
    ).toEqual({ keycode: APPKIT_KEYCODE.c, mods: GHOSTTY_MODS.ctrl });
    expect(
      passthroughKeyPressForKey({
        ...base,
        ctrlKey: true,
        empty: true,
        key: "C",
      })
    ).toEqual({ keycode: APPKIT_KEYCODE.c, mods: GHOSTTY_MODS.ctrl });
  });

  it("Ctrl + 非 c 键不透传", () => {
    expect(
      passthroughKeyPressForKey({ ...base, ctrlKey: true, key: "a" })
    ).toBeNull();
  });

  it("空输入时方向键 / Tab / Shift+Tab / Enter 透传为按键", () => {
    expect(passthroughKeyPressForKey({ ...base, key: "ArrowUp" })).toEqual({
      keycode: APPKIT_KEYCODE.arrowUp,
    });
    expect(passthroughKeyPressForKey({ ...base, key: "ArrowDown" })).toEqual({
      keycode: APPKIT_KEYCODE.arrowDown,
    });
    expect(passthroughKeyPressForKey({ ...base, key: "ArrowRight" })).toEqual({
      keycode: APPKIT_KEYCODE.arrowRight,
    });
    expect(passthroughKeyPressForKey({ ...base, key: "ArrowLeft" })).toEqual({
      keycode: APPKIT_KEYCODE.arrowLeft,
    });
    expect(passthroughKeyPressForKey({ ...base, key: "Tab" })).toEqual({
      keycode: APPKIT_KEYCODE.tab,
    });
    expect(
      passthroughKeyPressForKey({ ...base, key: "Tab", shiftKey: true })
    ).toEqual({
      keycode: APPKIT_KEYCODE.tab,
      mods: GHOSTTY_MODS.shift,
    });
    expect(passthroughKeyPressForKey({ ...base, key: "Enter" })).toEqual({
      keycode: APPKIT_KEYCODE.return,
    });
    expect(
      passthroughKeyPressForKey({ ...base, key: "Enter", shiftKey: true })
    ).toBeNull();
  });

  it("非空输入时编辑键不透传（Enter 归发送路径）", () => {
    for (const key of [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Tab",
      "Enter",
    ]) {
      expect(
        passthroughKeyPressForKey({ ...base, empty: false, key })
      ).toBeNull();
    }
  });

  it("普通字符 / meta 组合不透传", () => {
    expect(passthroughKeyPressForKey({ ...base, key: "a" })).toBeNull();
    expect(
      passthroughKeyPressForKey({
        ...base,
        ctrlKey: false,
        key: "c",
        metaKey: true,
      })
    ).toBeNull();
    expect(
      passthroughKeyPressForKey({ ...base, key: "Escape", metaKey: true })
    ).toBeNull();
  });
});
