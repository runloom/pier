import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveTerminalColors } from "@/lib/theme/derive-terminal-colors.ts";
import { getShikiTheme } from "@/lib/theme/preset-registry.ts";

describe("theme store native chrome backing", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(performance.now());
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    document.documentElement.removeAttribute("style");
    document.documentElement.className = "";
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        terminal: {
          applyTheme: vi.fn(),
        },
        theme: {
          setNativeChrome: vi.fn(async () => undefined),
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses the terminal background as the macOS backing color", async () => {
    const { applyThemeVisual } = await import("@/stores/theme.store.ts");
    const expected = deriveTerminalColors(
      getShikiTheme("pierre", "dark"),
      "dark"
    ).background;

    applyThemeVisual("dark", "pierre");

    expect(window.pier.theme.setNativeChrome).toHaveBeenLastCalledWith(
      "dark",
      expected
    );
  });
});
