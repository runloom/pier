import { beforeAll, describe, expect, it } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { DEFAULT_KEYMAP } from "@/lib/keybindings/defaults.ts";
import { parseChord } from "@/lib/keybindings/parse.ts";
import { keybindingRegistry } from "@/lib/keybindings/registry.ts";

describe("command palette keybinding resolution", () => {
  beforeAll(() => {
    actionRegistry.register({
      id: "pier.commandPalette.toggle",
      category: "View",
      title: () => "Toggle",
      surfaces: [],
      handler: () => {
        // noop — test only checks registration, not handler execution
      },
    });
    keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);
  });

  it("resolves Mod+Shift+KeyP to commandPalette.toggle", () => {
    const chord = parseChord("Mod+Shift+KeyP");
    expect(chord).toEqual({
      cmdOrCtrl: true,
      alt: false,
      shift: true,
      code: "KeyP",
    });
    const commandId = keybindingRegistry.resolve(chord);
    expect(commandId).toBe("pier.commandPalette.toggle");
  });

  it("finds the action in registry", () => {
    const action = actionRegistry.get("pier.commandPalette.toggle");
    expect(action).toBeDefined();
    expect(action?.id).toBe("pier.commandPalette.toggle");
  });

  it("DEFAULT_KEYMAP contains the entry", () => {
    const entry = DEFAULT_KEYMAP.find(
      (k) => k.commandId === "pier.commandPalette.toggle"
    );
    expect(entry).toBeDefined();
    expect(entry?.keys).toBe("Mod+Shift+KeyP");
  });
});
