import { APP_HANDLED_NATIVE_TERMINAL_COMMANDS } from "@shared/commands.ts";
import {
  chordHasNonGlobalBinding,
  isNativeTerminalRoutedScope,
} from "@shared/keybindings.ts";
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
  "Mod+Alt+ArrowDown",
  "Mod+Alt+ArrowLeft",
  "Mod+Alt+ArrowRight",
  "Mod+Alt+ArrowUp",
  "Mod+Alt+KeyR",
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
  "Mod+KeyB",
  "Mod+KeyD",
  "Mod+KeyF",
  "Mod+KeyG",
  "Mod+KeyN",
  "Mod+KeyP",
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
  "Mod+Shift+BracketLeft",
  "Mod+Shift+BracketRight",
  "Mod+Shift+Equal",
  // Shared by pier.agent.new + pier.terminal.composerAttach (contextual).
  "Mod+Shift+KeyA",
  "Mod+Shift+KeyA",
  "Mod+Shift+KeyD",
  "Mod+Shift+KeyF",
  "Mod+Shift+KeyG",
  "Mod+Shift+KeyI",
  "Mod+Shift+KeyL",
  "Mod+Shift+KeyM",
  "Mod+Shift+KeyN",
  "Mod+Shift+KeyP",
  "Mod+Shift+KeyY",
];

describe("DEFAULT_KEYMAP", () => {
  it("only defaults new terminals to Mod+KeyT", () => {
    expect(
      DEFAULT_KEYMAP.filter(
        (binding) => binding.commandId === "pier.panel.newTerminal"
      )
    ).toEqual([
      {
        commandId: "pier.panel.newTerminal",
        keys: "Mod+KeyT",
        scope: "global",
      },
    ]);
  });

  it("keeps close and create-menu shortcuts wired", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.closeActive",
      keys: "Mod+KeyW",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.openCreateMenu",
      keys: "Mod+KeyN",
      scope: "global",
    });
    // New Window 不再直接绑快捷键; 通过命令面板 / "新建..." 弹层触发。
    expect(
      DEFAULT_KEYMAP.filter(
        (binding) => binding.commandId === "pier.window.newWindow"
      )
    ).toEqual([]);
  });

  it("marks chords that a panel binding shadows as non-global", () => {
    expect(chordHasNonGlobalBinding("Mod+Shift+KeyL")).toBe(true);
    expect(chordHasNonGlobalBinding("Mod+Alt+ArrowUp")).toBe(true);
    expect(chordHasNonGlobalBinding("Mod+Alt+ArrowLeft")).toBe(false);
    expect(chordHasNonGlobalBinding("Mod+KeyW")).toBe(false);
  });

  it("contains split / focus shortcuts", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.splitRight",
      keys: "Mod+KeyD",
      scope: "panel:terminal",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.splitDown",
      keys: "Mod+Shift+KeyD",
      scope: "panel:terminal",
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
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.focusUp",
      keys: "Mod+Alt+ArrowUp",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.focusDown",
      keys: "Mod+Alt+ArrowDown",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.focusLeft",
      keys: "Mod+Alt+ArrowLeft",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.focusRight",
      keys: "Mod+Alt+ArrowRight",
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
      keys: "Mod+Shift+KeyM",
      scope: "global",
    });
  });

  it("cycles tabs in the active group with Mod+Shift+brackets", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.focusNextTab",
      keys: "Mod+Shift+BracketRight",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.panel.focusPrevTab",
      keys: "Mod+Shift+BracketLeft",
      scope: "global",
    });
  });

  it("toggles the side tree globally with Mod+B", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.view.toggleSideTree",
      keys: "Mod+KeyB",
      scope: "global",
    });
    expect(
      DEFAULT_KEYMAP.filter((binding) => binding.keys === "Mod+KeyB")
    ).toEqual([
      {
        commandId: "pier.view.toggleSideTree",
        keys: "Mod+KeyB",
        scope: "global",
      },
    ]);
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

  it("contains the find shortcut on pier.find", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.find",
      keys: "Mod+KeyF",
      scope: "global",
    });
    expect(
      DEFAULT_KEYMAP.filter(
        (binding) => binding.commandId === "pier.terminal.search"
      )
    ).toEqual([]);
  });

  it("contains the open agent composer shortcut", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.terminal.openAgentComposer",
      keys: "Mod+Shift+KeyI",
      scope: "panel:terminal",
    });
  });

  it("copies path, relative path, and path-with-range on distinct chords in Files, search, and Git review panels", () => {
    expect(
      DEFAULT_KEYMAP.filter(
        (binding) =>
          binding.commandId === "pier.files.copyPath" ||
          binding.commandId === "pier.files.copyRelativePath" ||
          binding.commandId === "pier.files.copyPathWithRange" ||
          binding.commandId === "pier.files.search.copyPath" ||
          binding.commandId === "pier.files.search.copyRelativePath" ||
          binding.commandId === "pier.git.review.copyPath" ||
          binding.commandId === "pier.git.review.copyRelativePath" ||
          binding.commandId === "pier.git.review.copyPathWithRange" ||
          binding.keys === "Mod+Alt+KeyC" ||
          binding.keys === "Mod+Alt+Shift+KeyC" ||
          binding.keys === "Mod+Alt+KeyL"
      )
    ).toEqual([
      {
        commandId: "pier.files.copyPath",
        keys: "Mod+Alt+KeyC",
        scope: "panel:pier.files.filePanel",
      },
      {
        commandId: "pier.files.copyRelativePath",
        keys: "Mod+Alt+Shift+KeyC",
        scope: "panel:pier.files.filePanel",
      },
      {
        commandId: "pier.files.copyPathWithRange",
        keys: "Mod+Alt+KeyL",
        scope: "panel:pier.files.filePanel",
      },
      {
        commandId: "pier.git.review.copyPath",
        keys: "Mod+Alt+KeyC",
        scope: "panel:pier.git.changes",
      },
      {
        commandId: "pier.git.review.copyRelativePath",
        keys: "Mod+Alt+Shift+KeyC",
        scope: "panel:pier.git.changes",
      },
      {
        commandId: "pier.git.review.copyPathWithRange",
        keys: "Mod+Alt+KeyL",
        scope: "panel:pier.git.changes",
      },
      {
        commandId: "pier.files.search.copyPath",
        keys: "Mod+Alt+KeyC",
        scope: "panel:pier.files.searchPanel",
      },
      {
        commandId: "pier.files.search.copyRelativePath",
        keys: "Mod+Alt+Shift+KeyC",
        scope: "panel:pier.files.searchPanel",
      },
    ]);
  });

  it("does not steal native terminal clipboard chords", () => {
    const stolen = DEFAULT_KEYMAP.filter(
      (binding) =>
        binding.scope === "panel:terminal" &&
        (binding.keys === "Mod+KeyA" ||
          binding.keys === "Mod+KeyC" ||
          binding.keys === "Mod+KeyK" ||
          binding.keys === "Mod+KeyV" ||
          binding.keys === "Mod+KeyX")
    );
    expect(stolen).toEqual([]);
  });

  it("shows symbol information with Mod+I only in Files panels", () => {
    expect(
      DEFAULT_KEYMAP.filter(
        (binding) =>
          binding.commandId === "pier.files.editor.showHover" ||
          binding.keys === "Mod+KeyI"
      )
    ).toEqual([
      {
        commandId: "pier.files.editor.showHover",
        keys: "Mod+KeyI",
        scope: "panel:pier.files.filePanel",
      },
    ]);
  });

  it("contains the rich-input attach shortcut", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.terminal.composerAttach",
      keys: "Mod+Shift+KeyA",
      scope: "global",
    });
  });

  it("does not default run task or worktree create shortcuts", () => {
    expect(
      DEFAULT_KEYMAP.filter(
        (binding) =>
          binding.commandId === "pier.run.task" ||
          binding.commandId === "pier.worktree.create"
      )
    ).toEqual([]);
  });

  it("leaves retired run task and worktree shortcuts unbound", () => {
    keybindingRegistry.loadUserKeymap([]);
    keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);

    for (const keys of ["Mod+Backquote", "Mod+Shift+KeyT"]) {
      expect(
        keybindingRegistry.resolve(parseChord(keys, false), {
          activePanelComponent: null,
          overlayStack: [],
        })
      ).toBeNull();
    }
  });

  it("binds open notification center to Mod+Shift+N", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.notifications.open",
      keys: "Mod+Shift+KeyN",
      scope: "global",
    });
  });

  it("resolves the open notification center shortcut from DEFAULT_KEYMAP", () => {
    keybindingRegistry.loadUserKeymap([]);
    keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);

    const commandId = keybindingRegistry.resolve(
      parseChord("Mod+Shift+KeyN", false),
      {
        activePanelComponent: null,
        overlayStack: [],
      }
    );
    expect(commandId).toBe("pier.notifications.open");
  });

  it("keeps rerun task and command palette shortcuts", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.run.rerunTask",
      keys: "Mod+Alt+KeyR",
      scope: "global",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.commandPalette.toggle",
      keys: "Mod+Shift+KeyP",
      scope: "global",
    });
  });

  it("lets settings and command palette resolve on the content-preview overlay", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.commandPalette.toggle",
      keys: "Mod+Shift+KeyP",
      scope: "overlay:content-preview",
    });
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.settings.open",
      keys: "Mod+Comma",
      scope: "overlay:content-preview",
    });

    keybindingRegistry.loadUserKeymap([]);
    keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);

    const previewScope = {
      activePanelComponent: null,
      overlayStack: ["overlay:content-preview"],
    };
    expect(
      keybindingRegistry.resolve(parseChord("Mod+Comma", false), previewScope)
    ).toBe("pier.settings.open");
    expect(
      keybindingRegistry.resolve(
        parseChord("Mod+Shift+KeyP", false),
        previewScope
      )
    ).toBe("pier.commandPalette.toggle");
    expect(
      keybindingRegistry.resolve(parseChord("Mod+Equal", false), previewScope)
    ).toBeNull();
    expect(
      keybindingRegistry.resolve(parseChord("Mod+KeyW", false), previewScope)
    ).toBeNull();
  });

  it("keeps the start default agent shortcut", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.agent.new",
      keys: "Mod+Shift+KeyA",
      scope: "global",
    });
  });

  it("keeps the focus-waiting agent zero-select shortcut", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.agents.focusWaiting",
      keys: "Mod+Shift+KeyY",
      scope: "global",
    });
  });

  it("keeps the agent list shortcut", () => {
    expect(DEFAULT_KEYMAP).toContainEqual({
      commandId: "pier.agents.list",
      keys: "Mod+Shift+KeyL",
      scope: "global",
    });
  });

  it("resolves side-tree and find shortcuts from a terminal panel", () => {
    keybindingRegistry.loadUserKeymap([]);
    keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);

    const terminalScope = {
      activePanelComponent: "terminal",
      overlayStack: [],
    };
    expect(
      keybindingRegistry.resolve(parseChord("Mod+KeyB", false), terminalScope)
    ).toBe("pier.view.toggleSideTree");
    expect(
      keybindingRegistry.resolve(parseChord("Mod+KeyF", false), terminalScope)
    ).toBe("pier.find");
    expect(
      keybindingRegistry.resolve(
        parseChord("Mod+Shift+KeyY", false),
        terminalScope
      )
    ).toBe("pier.agents.focusWaiting");
  });

  it("keeps split on the terminal and next-occurrence in the files editor", () => {
    keybindingRegistry.loadUserKeymap([]);
    keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);

    const filesScope = {
      activePanelComponent: "pier.files.filePanel",
      overlayStack: [],
    };
    const terminalScope = {
      activePanelComponent: "terminal",
      overlayStack: [],
    };
    expect(
      keybindingRegistry.resolve(parseChord("Mod+KeyD", false), filesScope)
    ).toBe("pier.files.editor.selectNextOccurrence");
    expect(
      keybindingRegistry.resolve(parseChord("Mod+KeyD", false), terminalScope)
    ).toBe("pier.panel.splitRight");
    expect(
      keybindingRegistry.resolve(
        parseChord("Mod+Shift+KeyD", false),
        filesScope
      )
    ).not.toBe("pier.panel.splitDown");
    expect(
      keybindingRegistry.resolve(
        parseChord("Mod+Shift+KeyL", false),
        filesScope
      )
    ).toBe("pier.files.editor.selectAllOccurrences");
    expect(
      keybindingRegistry.resolve(
        parseChord("Mod+Shift+KeyL", false),
        terminalScope
      )
    ).toBe("pier.agents.list");
    expect(
      keybindingRegistry.resolve(
        parseChord("Mod+Alt+ArrowUp", false),
        filesScope
      )
    ).toBe("pier.files.editor.addCursorAbove");
    expect(
      keybindingRegistry.resolve(
        parseChord("Mod+Alt+ArrowDown", false),
        filesScope
      )
    ).toBe("pier.files.editor.addCursorBelow");
    expect(
      keybindingRegistry.resolve(
        parseChord("Mod+Alt+ArrowUp", false),
        terminalScope
      )
    ).toBe("pier.panel.focusUp");
    expect(
      keybindingRegistry.resolve(
        parseChord("Mod+Shift+KeyI", false),
        filesScope
      )
    ).toBeNull();
    expect(
      keybindingRegistry.resolve(
        parseChord("Mod+Shift+KeyI", false),
        terminalScope
      )
    ).toBe("pier.terminal.openAgentComposer");
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
    const nativeTerminalAppShortcuts = DEFAULT_KEYMAP.filter(
      (binding) =>
        nativeTerminalCommandIds.has(binding.commandId) &&
        isNativeTerminalRoutedScope(binding.scope)
    )
      .map((binding) => binding.keys)
      .sort();

    expect(nativeTerminalAppShortcuts).toEqual(TERMINAL_MODE_APP_SHORTCUTS);
    expect(DEFAULT_KEYMAP.some((binding) => "nativeTerminal" in binding)).toBe(
      false
    );
  });
});
