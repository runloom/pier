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
  it("always passthroughs Ctrl+C", () => {
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

  it("does not passthrough Escape (composer closes instead)", () => {
    expect(
      passthroughKeyPressForKey({ ...base, empty: false, key: "Escape" })
    ).toBeNull();
    expect(
      passthroughKeyPressForKey({ ...base, empty: true, key: "Escape" })
    ).toBeNull();
  });

  it("Ctrl + non-c does not passthrough", () => {
    expect(
      passthroughKeyPressForKey({ ...base, ctrlKey: true, key: "a" })
    ).toBeNull();
  });

  it("bridges empty-draft navigation keys to TUI", () => {
    expect(passthroughKeyPressForKey({ ...base, key: "ArrowUp" })).toEqual({
      keycode: APPKIT_KEYCODE.arrowUp,
    });
    expect(passthroughKeyPressForKey({ ...base, key: "ArrowDown" })).toEqual({
      keycode: APPKIT_KEYCODE.arrowDown,
    });
    expect(passthroughKeyPressForKey({ ...base, key: "ArrowLeft" })).toEqual({
      keycode: APPKIT_KEYCODE.arrowLeft,
    });
    expect(passthroughKeyPressForKey({ ...base, key: "ArrowRight" })).toEqual({
      keycode: APPKIT_KEYCODE.arrowRight,
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
  });

  it("does not bridge Shift+Enter even when empty (newline reserved)", () => {
    expect(
      passthroughKeyPressForKey({ ...base, key: "Enter", shiftKey: true })
    ).toBeNull();
  });

  it("does not passthrough edit keys when draft is non-empty", () => {
    for (const key of [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Tab",
      "Enter",
      "Escape",
    ]) {
      expect(
        passthroughKeyPressForKey({ ...base, empty: false, key })
      ).toBeNull();
    }
  });

  it("does not passthrough plain chars or meta combos", () => {
    expect(passthroughKeyPressForKey({ ...base, key: "a" })).toBeNull();
    expect(
      passthroughKeyPressForKey({
        ...base,
        key: "c",
        metaKey: true,
      })
    ).toBeNull();
    expect(
      passthroughKeyPressForKey({ ...base, key: "Escape", metaKey: true })
    ).toBeNull();
    expect(
      passthroughKeyPressForKey({
        ...base,
        ctrlKey: true,
        key: "c",
        metaKey: true,
      })
    ).toBeNull();
  });
});
