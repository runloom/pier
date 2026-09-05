import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/lib/keybindings/matcher.ts");
  vi.resetModules();
});

describe("scroll to bottom native shortcut ownership", () => {
  it.each([
    ["darwin", "Mod+ArrowDown"],
    ["win32", undefined],
    ["linux", undefined],
  ])("only advertises an existing native shortcut on %s", async (platform, hint) => {
    vi.resetModules();
    vi.doMock("@/lib/keybindings/matcher.ts", async (importOriginal) => ({
      ...(await importOriginal<
        typeof import("@/lib/keybindings/matcher.ts")
      >()),
      isMac: () => platform === "darwin",
    }));
    const { TERMINAL_ACTION_CONTRIBUTIONS } = await import(
      "@/panel-kits/terminal/register-actions.ts"
    );
    const contribution = TERMINAL_ACTION_CONTRIBUTIONS.find(
      (item) => item.id === "pier.terminal.scrollToBottom"
    );
    expect(contribution).toBeDefined();
    expect(contribution?.displayChord).toBe(hint);

    const { DEFAULT_KEYMAP } = await import("@/lib/keybindings/defaults.ts");
    const { keybindingRegistry } = await import(
      "@/lib/keybindings/registry.ts"
    );
    const { parseChord } = await import("@/lib/keybindings/parse.ts");
    keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);
    for (const chord of ["Mod+ArrowDown", "Mod+End"]) {
      expect(
        keybindingRegistry.resolve(parseChord(chord, platform === "darwin"), {
          activePanelComponent: "terminal",
          overlayStack: [],
        })
      ).toBeNull();
    }
  });
});
