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
});
