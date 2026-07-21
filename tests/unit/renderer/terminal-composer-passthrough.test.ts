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
  it("only Ctrl+C passthroughs as a real keypress (empty or not)", () => {
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

  it("does not bridge empty-draft navigation keys", () => {
    for (const key of [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Tab",
      "Enter",
    ]) {
      expect(passthroughKeyPressForKey({ ...base, key })).toBeNull();
    }
    expect(
      passthroughKeyPressForKey({ ...base, key: "Tab", shiftKey: true })
    ).toBeNull();
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
        ctrlKey: false,
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
