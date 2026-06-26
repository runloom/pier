import { describe, expect, it } from "vitest";
import { DEFAULT_KEYMAP } from "@/lib/keybindings/defaults.ts";

const TERMINAL_MODE_APP_SHORTCUTS = [
  "Ctrl+Shift+ArrowDown",
  "Ctrl+Shift+ArrowLeft",
  "Ctrl+Shift+ArrowRight",
  "Ctrl+Shift+ArrowUp",
  "Ctrl+Shift+KeyD",
  "Mod+Backquote",
  "Mod+Comma",
  "Mod+KeyD",
  "Mod+KeyN",
  "Mod+KeyT",
  "Mod+KeyW",
  "Mod+Shift+Enter",
  "Mod+Shift+KeyD",
  "Mod+Shift+KeyP",
];

describe("DEFAULT_KEYMAP", () => {
  it("keeps tab/window panel shortcuts wired", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.newTerminal",
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

  it("contains the panel maximize shortcut", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.toggleMaximized",
      keys: "Mod+Shift+Enter",
      nativeTerminal: "app",
      scope: "global",
    });
  });

  it("contains the native terminal debug window shortcut", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.terminal.openDebugWindow",
      keys: "Ctrl+Shift+KeyD",
      nativeTerminal: "app",
      scope: "global",
    });
    expect(
      DEFAULT_KEYMAP.some(
        (binding) => binding.commandId === "pier.terminal.toggleDebugOverlay"
      )
    ).toBe(false);
  });

  it("does not use the macOS Dock Command+Option+D shortcut family for debug window", () => {
    expect(DEFAULT_KEYMAP).not.toContainEqual({
      commandId: "pier.terminal.openDebugWindow",
      keys: "Mod+Alt+Shift+KeyD",
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
