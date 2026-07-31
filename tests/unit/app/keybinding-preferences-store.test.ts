import { beforeEach, describe, expect, it, vi } from "vitest";

describe("keybinding-preferences.store", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  function installPierApi(snapshot = {}) {
    let changedListener: ((snapshot: Record<string, unknown>) => void) | null =
      null;
    const read = vi.fn(async () => ({
      theme: "system",
      stylePresetId: "pierre",
      language: "system",
      uiFontFamily: "",
      monoFontFamily: "",
      monoFontSize: 13,
      terminalCursorStyle: "block",
      terminalCursorBlink: true,
      terminalScrollbackMb: 64,
      terminalPasteProtection: true,
      terminalNewCwdPolicy: "activeTerminal",
      userKeymap: [],
      ...snapshot,
    }));
    const update = vi.fn(async (patch: Record<string, unknown>) => ({
      ...(await read()),
      ...patch,
    }));
    const onChanged = vi.fn(
      (cb: (snapshot: Record<string, unknown>) => void) => {
        changedListener = cb;
        return vi.fn();
      }
    );
    const setAppShortcutKeys = vi.fn();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        platform: "darwin",
        preferences: { onChanged, read, update },
        terminal: { setAppShortcutKeys },
      },
    });
    return {
      emitPreferencesChanged: (next: Record<string, unknown>) => {
        changedListener?.({
          theme: "system",
          stylePresetId: "pierre",
          language: "system",
          uiFontFamily: "",
          monoFontFamily: "",
          monoFontSize: 13,
          terminalCursorStyle: "block",
          terminalCursorBlink: true,
          terminalScrollbackMb: 64,
          terminalPasteProtection: true,
          terminalNewCwdPolicy: "activeTerminal",
          userKeymap: [],
          ...next,
        });
      },
      onChanged,
      read,
      setAppShortcutKeys,
      update,
    };
  }

  it("loads persisted user keymap into the registry and syncs native shortcuts", async () => {
    const pier = installPierApi({
      userKeymap: [
        { commandId: "-pier.panel.newTerminal", keys: "", scope: "global" },
        {
          commandId: "pier.panel.newTerminal",
          keys: "Mod+Shift+KeyX",
          scope: "global",
        },
        {
          commandId: "pier.agent.start.claude",
          keys: "Mod+Alt+KeyA",
          scope: "global",
        },
      ],
    });
    const { DEFAULT_KEYMAP } = await import("@/lib/keybindings/defaults.ts");
    const { parseChord } = await import("@/lib/keybindings/parse.ts");
    const { keybindingRegistry } = await import(
      "@/lib/keybindings/registry.ts"
    );
    const { initKeybindingPreferences } = await import(
      "@/stores/keybinding-preferences.store.ts"
    );

    keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);
    await initKeybindingPreferences();

    expect(
      keybindingRegistry.resolve(parseChord("Mod+KeyT", false), {
        activePanelComponent: null,
        overlayStack: [],
      })
    ).toBeNull();
    expect(
      keybindingRegistry.resolve(parseChord("Mod+Shift+KeyX", false), {
        activePanelComponent: null,
        overlayStack: [],
      })
    ).toBe("pier.panel.newTerminal");
    expect(pier.setAppShortcutKeys).toHaveBeenCalledWith(
      expect.arrayContaining(["Mod+Alt+KeyA", "Mod+Shift+KeyX"])
    );
  });

  it("writes replacement bindings as an unbind plus a single user binding", async () => {
    const pier = installPierApi();
    const { DEFAULT_KEYMAP } = await import("@/lib/keybindings/defaults.ts");
    const { keybindingRegistry } = await import(
      "@/lib/keybindings/registry.ts"
    );
    const { initKeybindingPreferences, useKeybindingPreferencesStore } =
      await import("@/stores/keybinding-preferences.store.ts");

    keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);
    await initKeybindingPreferences();
    await useKeybindingPreferencesStore
      .getState()
      .setBinding("pier.panel.newTerminal", "Mod+Shift+KeyX", "global");

    expect(pier.update).toHaveBeenCalledWith({
      userKeymap: [
        { commandId: "-pier.panel.newTerminal", keys: "", scope: "global" },
        {
          commandId: "pier.panel.newTerminal",
          keys: "Mod+Shift+KeyX",
          scope: "global",
        },
      ],
    });
  });

  it("syncs replacement bindings for terminal-mode app commands to native terminal routing", async () => {
    const pier = installPierApi();
    const { DEFAULT_KEYMAP } = await import("@/lib/keybindings/defaults.ts");
    const { keybindingRegistry } = await import(
      "@/lib/keybindings/registry.ts"
    );
    const { initKeybindingPreferences, useKeybindingPreferencesStore } =
      await import("@/stores/keybinding-preferences.store.ts");

    keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);
    await initKeybindingPreferences();
    await useKeybindingPreferencesStore
      .getState()
      .setBinding("pier.view.zoomIn", "Mod+Alt+Equal", "global");

    expect(pier.setAppShortcutKeys).toHaveBeenLastCalledWith(
      expect.arrayContaining(["Mod+Alt+Equal"])
    );
    expect(pier.setAppShortcutKeys).toHaveBeenLastCalledWith(
      expect.not.arrayContaining(["Mod+Equal", "Mod+Shift+Equal"])
    );
  });

  it("keeps custom run task and worktree shortcuts resolvable and routed to native terminals", async () => {
    const pier = installPierApi();
    // These imports must follow the per-test API install because the store owns module state.
    const { DEFAULT_KEYMAP } = await import("@/lib/keybindings/defaults.ts");
    const { parseChord } = await import("@/lib/keybindings/parse.ts");
    const { keybindingRegistry } = await import(
      "@/lib/keybindings/registry.ts"
    );
    const { initKeybindingPreferences, useKeybindingPreferencesStore } =
      await import("@/stores/keybinding-preferences.store.ts");

    keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);
    await initKeybindingPreferences();

    const runTaskResult = await useKeybindingPreferencesStore
      .getState()
      .setBinding("pier.run.task", "Mod+Alt+KeyT", "global");
    const createWorktreeResult = await useKeybindingPreferencesStore
      .getState()
      .setBinding("pier.worktree.create", "Mod+Alt+KeyN", "global");

    expect(runTaskResult.ok).toBe(true);
    expect(createWorktreeResult.ok).toBe(true);
    expect(
      keybindingRegistry.resolve(parseChord("Mod+Alt+KeyT", false), {
        activePanelComponent: null,
        overlayStack: [],
      })
    ).toBe("pier.run.task");
    expect(
      keybindingRegistry.resolve(parseChord("Mod+Alt+KeyN", false), {
        activePanelComponent: null,
        overlayStack: [],
      })
    ).toBe("pier.worktree.create");
    expect(pier.setAppShortcutKeys).toHaveBeenLastCalledWith(
      expect.arrayContaining(["Mod+Alt+KeyT", "Mod+Alt+KeyN"])
    );
  });

  it("ignores sender broadcasts that repeat the current user keymap", async () => {
    const pier = installPierApi();
    const { DEFAULT_KEYMAP } = await import("@/lib/keybindings/defaults.ts");
    const { keybindingRegistry } = await import(
      "@/lib/keybindings/registry.ts"
    );
    const { initKeybindingPreferences, useKeybindingPreferencesStore } =
      await import("@/stores/keybinding-preferences.store.ts");

    keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);
    await initKeybindingPreferences();
    await useKeybindingPreferencesStore
      .getState()
      .setBinding("pier.view.zoomIn", "Mod+Alt+Equal", "global");

    const callsAfterLocalApply = pier.setAppShortcutKeys.mock.calls.length;
    pier.emitPreferencesChanged({
      userKeymap: [
        { commandId: "-pier.view.zoomIn", keys: "", scope: "global" },
        {
          commandId: "pier.view.zoomIn",
          keys: "Mod+Alt+Equal",
          scope: "global",
        },
      ],
    });

    expect(pier.setAppShortcutKeys).toHaveBeenCalledTimes(callsAfterLocalApply);
  });

  it("does not route user-only commands that are not marked for terminal focus", async () => {
    const pier = installPierApi();
    const { DEFAULT_KEYMAP } = await import("@/lib/keybindings/defaults.ts");
    const { keybindingRegistry } = await import(
      "@/lib/keybindings/registry.ts"
    );
    const { initKeybindingPreferences, useKeybindingPreferencesStore } =
      await import("@/stores/keybinding-preferences.store.ts");

    keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);
    await initKeybindingPreferences();
    await useKeybindingPreferencesStore
      .getState()
      .setBinding("pier.panel.splitLeft", "Mod+Alt+ArrowLeft", "global");

    expect(pier.setAppShortcutKeys).toHaveBeenLastCalledWith(
      expect.not.arrayContaining(["Mod+Alt+ArrowLeft"])
    );
  });

  it("keeps the default debug shortcut in the native terminal allowlist", async () => {
    const pier = installPierApi();
    const { DEFAULT_KEYMAP } = await import("@/lib/keybindings/defaults.ts");
    const { keybindingRegistry } = await import(
      "@/lib/keybindings/registry.ts"
    );
    const { initKeybindingPreferences } = await import(
      "@/stores/keybinding-preferences.store.ts"
    );

    keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);
    await initKeybindingPreferences();

    expect(pier.setAppShortcutKeys).toHaveBeenLastCalledWith(
      // darwin: stringifyChord 把 Ctrl+Shift+KeyD 归一化为 Mod+Shift+KeyD
      // (Mod = cmdOrCtrl on mac).
      expect.arrayContaining(["Mod+Shift+KeyD"])
    );
  });

  it("migrates legacy terminal debug command ids when hydrating preferences", async () => {
    const pier = installPierApi({
      userKeymap: [
        {
          commandId: "pier.terminal.toggleDebugOverlay",
          keys: "Mod+Alt+Shift+KeyD",
          scope: "global",
        },
      ],
    });
    const { DEFAULT_KEYMAP } = await import("@/lib/keybindings/defaults.ts");
    const { parseChord } = await import("@/lib/keybindings/parse.ts");
    const { keybindingRegistry } = await import(
      "@/lib/keybindings/registry.ts"
    );
    const { initKeybindingPreferences, useKeybindingPreferencesStore } =
      await import("@/stores/keybinding-preferences.store.ts");

    keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);
    await initKeybindingPreferences();

    expect(useKeybindingPreferencesStore.getState().userKeymap).toEqual([
      {
        commandId: "pier.terminal.openDebugWindow",
        keys: "Mod+Alt+Shift+KeyD",
        scope: "global",
      },
    ]);
    expect(
      keybindingRegistry.resolve(parseChord("Mod+Alt+Shift+KeyD", false), {
        activePanelComponent: null,
        overlayStack: [],
      })
    ).toBe("pier.terminal.openDebugWindow");
    expect(pier.setAppShortcutKeys).toHaveBeenLastCalledWith(
      expect.arrayContaining(["Mod+Alt+Shift+KeyD"])
    );
  });

  it("migrates legacy mission control shortcuts to the workbench action", async () => {
    installPierApi({
      userKeymap: [
        {
          commandId: "pier.panel.newMissionControl",
          keys: "Mod+Alt+KeyW",
          scope: "global",
        },
      ],
    });
    const { DEFAULT_KEYMAP } = await import("@/lib/keybindings/defaults.ts");
    const { parseChord } = await import("@/lib/keybindings/parse.ts");
    const { keybindingRegistry } = await import(
      "@/lib/keybindings/registry.ts"
    );
    const { initKeybindingPreferences, useKeybindingPreferencesStore } =
      await import("@/stores/keybinding-preferences.store.ts");

    keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);
    await initKeybindingPreferences();

    expect(useKeybindingPreferencesStore.getState().userKeymap).toEqual([
      {
        commandId: "pier.panel.newWorkbench",
        keys: "Mod+Alt+KeyW",
        scope: "global",
      },
    ]);
    expect(
      keybindingRegistry.resolve(parseChord("Mod+Alt+KeyW", false), {
        activePanelComponent: null,
        overlayStack: [],
      })
    ).toBe("pier.panel.newWorkbench");
  });

  it("migrates legacy terminal debug unbind entries when hydrating preferences", async () => {
    installPierApi({
      userKeymap: [
        {
          commandId: "-pier.terminal.toggleDebugOverlay",
          keys: "",
          scope: "global",
        },
      ],
    });
    const { DEFAULT_KEYMAP } = await import("@/lib/keybindings/defaults.ts");
    const { keybindingRegistry } = await import(
      "@/lib/keybindings/registry.ts"
    );
    const { initKeybindingPreferences, useKeybindingPreferencesStore } =
      await import("@/stores/keybinding-preferences.store.ts");

    keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);
    await initKeybindingPreferences();

    expect(useKeybindingPreferencesStore.getState().userKeymap).toEqual([
      {
        commandId: "-pier.terminal.openDebugWindow",
        keys: "",
        scope: "global",
      },
    ]);
    expect(
      keybindingRegistry.getBindingsFor("pier.terminal.openDebugWindow")
    ).toEqual([]);
  });

  it("writes legacy terminal debug command updates with the current command id", async () => {
    const pier = installPierApi();
    const { DEFAULT_KEYMAP } = await import("@/lib/keybindings/defaults.ts");
    const { keybindingRegistry } = await import(
      "@/lib/keybindings/registry.ts"
    );
    const { initKeybindingPreferences, useKeybindingPreferencesStore } =
      await import("@/stores/keybinding-preferences.store.ts");

    keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);
    await initKeybindingPreferences();
    await useKeybindingPreferencesStore
      .getState()
      .setBinding(
        "pier.terminal.toggleDebugOverlay",
        "Mod+Alt+Shift+KeyD",
        "global"
      );

    expect(pier.update).toHaveBeenLastCalledWith({
      userKeymap: [
        {
          commandId: "-pier.terminal.openDebugWindow",
          keys: "",
          scope: "global",
        },
        {
          commandId: "pier.terminal.openDebugWindow",
          keys: "Mod+Alt+Shift+KeyD",
          scope: "global",
        },
      ],
    });
  });

  it("resets all user keybindings", async () => {
    const pier = installPierApi({
      userKeymap: [
        { commandId: "-pier.panel.newTerminal", keys: "", scope: "global" },
        {
          commandId: "pier.panel.newTerminal",
          keys: "Mod+Shift+KeyX",
          scope: "global",
        },
      ],
    });
    const { DEFAULT_KEYMAP } = await import("@/lib/keybindings/defaults.ts");
    const { keybindingRegistry } = await import(
      "@/lib/keybindings/registry.ts"
    );
    const { initKeybindingPreferences, useKeybindingPreferencesStore } =
      await import("@/stores/keybinding-preferences.store.ts");

    keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);
    await initKeybindingPreferences();
    await useKeybindingPreferencesStore.getState().resetAllBindings();

    expect(pier.update).toHaveBeenLastCalledWith({ userKeymap: [] });
    expect(useKeybindingPreferencesStore.getState().userKeymap).toEqual([]);
  });

  it("blocks conflicting bindings before writing preferences", async () => {
    const pier = installPierApi();
    const { DEFAULT_KEYMAP } = await import("@/lib/keybindings/defaults.ts");
    const { keybindingRegistry } = await import(
      "@/lib/keybindings/registry.ts"
    );
    const { initKeybindingPreferences, useKeybindingPreferencesStore } =
      await import("@/stores/keybinding-preferences.store.ts");

    keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);
    await initKeybindingPreferences();
    const result = await useKeybindingPreferencesStore
      .getState()
      .setBinding("pier.panel.splitRight", "Mod+KeyT", "global");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("pier.panel.newTerminal");
    expect(pier.update).not.toHaveBeenCalled();
  });
});
