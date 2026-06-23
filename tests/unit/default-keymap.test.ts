import { describe, expect, it } from "vitest";
import { DEFAULT_KEYMAP } from "@/lib/keybindings/defaults.ts";

describe("DEFAULT_KEYMAP", () => {
  it("keeps tab/window panel shortcuts wired", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.newTab",
      keys: "Mod+KeyT",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.closeActive",
      keys: "Mod+KeyW",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.window.newWindow",
      keys: "Mod+KeyN",
      scope: "global",
    });
  });

  it("contains split / focus shortcuts", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.splitRight",
      keys: "Mod+KeyD",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.splitDown",
      keys: "Mod+Shift+KeyD",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.focusUp",
      keys: "Ctrl+Shift+ArrowUp",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.focusDown",
      keys: "Ctrl+Shift+ArrowDown",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.focusLeft",
      keys: "Ctrl+Shift+ArrowLeft",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.focusRight",
      keys: "Ctrl+Shift+ArrowRight",
      scope: "global",
    });
  });
});
