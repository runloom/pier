import { APP_HANDLED_NATIVE_TERMINAL_COMMANDS } from "@shared/commands.ts";
import { describe, expect, it } from "vitest";
import { DEFAULT_KEYMAP } from "@/lib/keybindings/defaults.ts";
import { parseChord } from "@/lib/keybindings/parse.ts";
import { keybindingRegistry } from "@/lib/keybindings/registry.ts";

const TERMINAL_MODE_APP_SHORTCUTS = [
  "Ctrl+Shift+ArrowDown",
  "Ctrl+Shift+ArrowLeft",
  "Ctrl+Shift+ArrowRight",
  "Ctrl+Shift+ArrowUp",
  "Ctrl+Shift+KeyD",
  "Mod+Alt+KeyR",
  "Mod+Backquote",
  "Mod+Comma",
  "Mod+Digit0",
  "Mod+Digit1",
  "Mod+Digit2",
  "Mod+Digit3",
  "Mod+Digit4",
  "Mod+Digit5",
  "Mod+Digit6",
  "Mod+Digit7",
  "Mod+Digit8",
  "Mod+Digit9",
  "Mod+Equal",
  "Mod+KeyD",
  "Mod+KeyF",
  "Mod+KeyN",
  "Mod+KeyT",
  "Mod+KeyW",
  "Mod+Minus",
  "Mod+Numpad0",
  "Mod+Numpad1",
  "Mod+Numpad2",
  "Mod+Numpad3",
  "Mod+Numpad4",
  "Mod+Numpad5",
  "Mod+Numpad6",
  "Mod+Numpad7",
  "Mod+Numpad8",
  "Mod+Numpad9",
  "Mod+Shift+Enter",
  "Mod+Shift+Equal",
  "Mod+Shift+KeyD",
  "Mod+Shift+KeyN",
  "Mod+Shift+KeyP",
  "Mod+Shift+KeyT",
];

describe("DEFAULT_KEYMAP", () => {
  it("keeps tab/window panel shortcuts wired", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.newTerminal",
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

  it("contains active group tab switch shortcuts for digit and numpad keys", () => {
    for (let index = 1; index <= 9; index += 1) {
      expect(DEFAULT_KEYMAP).toContainEqual({
        commandId: `pier.panel.focusTab${index}`,
        keys: `Mod+Digit${index}`,
        scope: "global",
      });
      expect(DEFAULT_KEYMAP).toContainEqual({
        commandId: `pier.panel.focusTab${index}`,
        keys: `Mod+Numpad${index}`,
        scope: "global",
      });
    }
  });

  it("contains the panel maximize shortcut", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.toggleMaximized",
      keys: "Mod+Shift+Enter",
      scope: "global",
    });
  });

  it("contains view zoom shortcuts", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.view.zoomIn",
      keys: "Mod+Equal",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.view.zoomIn",
      keys: "Mod+Shift+Equal",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.view.zoomOut",
      keys: "Mod+Minus",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.view.resetZoom",
      keys: "Mod+Digit0",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.view.resetZoom",
      keys: "Mod+Numpad0",
      scope: "global",
    });
  });

  it("contains the native terminal debug window shortcut", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.terminal.openDebugWindow",
      keys: "Ctrl+Shift+KeyD",
      scope: "global",
    });
    expect(
      DEFAULT_KEYMAP.some(
        (binding) => binding.commandId === "pier.terminal.toggleDebugOverlay"
      )
    ).toBe(false);
  });

  it("contains the terminal search shortcut", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.terminal.search",
      keys: "Mod+KeyF",
      scope: "global",
    });
  });

  it("contains run task and worktree create shortcuts", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.run.task",
      keys: "Mod+Shift+KeyT",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.run.rerunTask",
      keys: "Mod+Alt+KeyR",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.worktree.create",
      keys: "Mod+Shift+KeyN",
      scope: "global",
    });
  });

  it("resolves the rerun task shortcut from DEFAULT_KEYMAP", () => {
    keybindingRegistry.loadUserKeymap([]);
    keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);

    const commandId = keybindingRegistry.resolve(
      parseChord("Mod+Alt+KeyR", false),
      {
        activePanelComponent: null,
        overlayStack: [],
      }
    );

    expect(commandId).toBe("pier.run.rerunTask");
  });

  it("does not use the macOS Dock Command+Option+D shortcut family for debug window", () => {
    expect(DEFAULT_KEYMAP).not.toContainEqual({
      commandId: "pier.terminal.openDebugWindow",
      keys: "Mod+Alt+Shift+KeyD",
      scope: "global",
    });
  });

  it("keeps native terminal routing as command policy instead of binding data", () => {
    const nativeTerminalCommandIds = new Set<string>(
      APP_HANDLED_NATIVE_TERMINAL_COMMANDS
    );
    const nativeTerminalAppShortcuts = DEFAULT_KEYMAP.filter((binding) =>
      nativeTerminalCommandIds.has(binding.commandId)
    )
      .map((binding) => binding.keys)
      .sort();

    expect(nativeTerminalAppShortcuts).toEqual(TERMINAL_MODE_APP_SHORTCUTS);
    expect(DEFAULT_KEYMAP.some((binding) => "nativeTerminal" in binding)).toBe(
      false
    );
  });
});
