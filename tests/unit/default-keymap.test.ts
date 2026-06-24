import { describe, expect, it } from "vitest";
import { DEFAULT_KEYMAP } from "@/lib/keybindings/defaults.ts";

const TERMINAL_MODE_APP_SHORTCUTS = [
  "Ctrl+Shift+ArrowDown",
  "Ctrl+Shift+ArrowLeft",
  "Ctrl+Shift+ArrowRight",
  "Ctrl+Shift+ArrowUp",
  "Mod+Backquote",
  "Mod+Comma",
  "Mod+KeyD",
  "Mod+KeyN",
  "Mod+KeyT",
  "Mod+KeyW",
  "Mod+Shift+KeyD",
  "Mod+Shift+KeyP",
];

describe("DEFAULT_KEYMAP", () => {
  it("keeps tab/window panel shortcuts wired", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.newTab",
      keys: "Mod+KeyT",
      nativeTerminal: "app",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.closeActive",
      keys: "Mod+KeyW",
      nativeTerminal: "app",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.window.newWindow",
      keys: "Mod+KeyN",
      nativeTerminal: "app",
      scope: "global",
    });
  });

  it("contains split / focus shortcuts", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.splitRight",
      keys: "Mod+KeyD",
      nativeTerminal: "app",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.splitDown",
      keys: "Mod+Shift+KeyD",
      nativeTerminal: "app",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.focusUp",
      keys: "Ctrl+Shift+ArrowUp",
      nativeTerminal: "app",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.focusDown",
      keys: "Ctrl+Shift+ArrowDown",
      nativeTerminal: "app",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.focusLeft",
      keys: "Ctrl+Shift+ArrowLeft",
      nativeTerminal: "app",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.focusRight",
      keys: "Ctrl+Shift+ArrowRight",
      nativeTerminal: "app",
      scope: "global",
    });
  });

  it("marks every shortcut that native terminal focus should forward to Pier", () => {
    const nativeTerminalAppShortcuts = DEFAULT_KEYMAP.filter(
      (binding) => binding.nativeTerminal === "app"
    )
      .map((binding) => binding.keys)
      .sort();

    expect(nativeTerminalAppShortcuts).toEqual(TERMINAL_MODE_APP_SHORTCUTS);
  });
});
