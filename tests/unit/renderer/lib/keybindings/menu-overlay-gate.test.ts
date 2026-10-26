import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";
import type { Action } from "@/lib/actions/types.ts";
import { keybindingRegistry } from "@/lib/keybindings/registry.ts";
import { dispatchKeybindingAction } from "@/lib/keybindings/use-registry.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";

function registerAction(id: string, handler = vi.fn()) {
  actionRegistry.register({
    category: "test",
    handler,
    id,
    title: () => id,
  });
  return handler;
}

function action(id: string): Action {
  const found = actionRegistry.get(id);
  if (!found) {
    throw new Error(`missing action: ${id}`);
  }
  return found;
}

describe("menu keybinding overlay gate", () => {
  beforeEach(() => {
    actionRegistry.clearForTests();
    useKeybindingScope.setState({
      activePanelComponent: "terminal",
      activePanelId: "terminal-1",
      activePanelKind: "terminal",
      overlayStack: [],
    });
  });

  afterEach(() => {
    actionRegistry.clearForTests();
    useKeybindingScope.setState({
      activePanelComponent: null,
      activePanelId: null,
      activePanelKind: null,
      overlayStack: [],
    });
  });

  it("blocks a menu action whose chord is not bound by the top overlay", () => {
    const handler = registerAction("pier.test.menu.blocked");
    keybindingRegistry.registerDefaults([
      { commandId: "pier.test.menu.blocked", keys: "Mod+KeyJ" },
    ]);
    useKeybindingScope.setState({ overlayStack: ["overlay:command-palette"] });

    dispatchKeybindingAction(action("pier.test.menu.blocked"), "menu");

    expect(handler).not.toHaveBeenCalled();
  });

  it("allows a menu action explicitly bound by the top overlay", () => {
    const handler = registerAction("pier.test.menu.allowed");
    keybindingRegistry.registerDefaults([
      { commandId: "pier.test.menu.allowed", keys: "Mod+KeyJ" },
      {
        commandId: "pier.test.menu.allowed",
        keys: "Mod+KeyK",
        scope: "overlay:test-overlay",
      },
    ]);
    useKeybindingScope.setState({ overlayStack: ["overlay:test-overlay"] });

    dispatchKeybindingAction(action("pier.test.menu.allowed"), "menu");

    expect(handler).toHaveBeenCalledOnce();
  });

  it("keeps menu-only commands clickable while an overlay is open", () => {
    const handler = registerAction("pier.test.menu.click-only");
    useKeybindingScope.setState({ overlayStack: ["overlay:command-palette"] });

    dispatchKeybindingAction(action("pier.test.menu.click-only"), "menu");

    expect(handler).toHaveBeenCalledOnce();
  });
});
