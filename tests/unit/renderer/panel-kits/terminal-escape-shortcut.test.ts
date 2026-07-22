import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireTerminalEscapeShortcut,
  resetTerminalEscapeShortcutForTests,
} from "@/panel-kits/terminal/terminal-escape-shortcut.ts";

describe("acquireTerminalEscapeShortcut", () => {
  afterEach(() => {
    resetTerminalEscapeShortcutForTests();
    vi.unstubAllGlobals();
  });

  it("adds Escape to app shortcuts while held and restores on release", () => {
    const setAppShortcutKeys = vi.fn();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          setAppShortcutKeys,
        },
      },
    });

    const releaseA = acquireTerminalEscapeShortcut();
    expect(setAppShortcutKeys).toHaveBeenCalledWith(
      expect.arrayContaining(["Escape"])
    );

    const releaseB = acquireTerminalEscapeShortcut();
    // Second holder does not resync until first release would drop to zero.
    const callsAfterSecond = setAppShortcutKeys.mock.calls.length;

    releaseA();
    expect(setAppShortcutKeys.mock.calls.length).toBe(callsAfterSecond);

    releaseB();
    const lastKeys = setAppShortcutKeys.mock.calls.at(-1)?.[0] as string[];
    expect(lastKeys).not.toContain("Escape");
  });
});
