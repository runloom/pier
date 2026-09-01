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
          onSystemAppearance: vi.fn(() => () => undefined),
          onVisualPreview: vi.fn(() => () => undefined),
          previewVisual: vi.fn(async () => undefined),
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

  it("syncs the terminal background CSS variable from terminal colors", async () => {
    const { applyThemeVisual } = await import("@/stores/theme.store.ts");
    const expected = deriveTerminalColors(
      getShikiTheme("pierre", "dark"),
      "dark"
    ).background;

    applyThemeVisual("dark", "pierre");

    expect(
      document.documentElement.style.getPropertyValue("--terminal-background")
    ).toBe(expected);
  });

  it("syncs the terminal background CSS variable before the coalesced native frame", async () => {
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    const { applyThemeVisual } = await import("@/stores/theme.store.ts");
    const expected = deriveTerminalColors(
      getShikiTheme("pierre", "dark"),
      "dark"
    ).background;

    applyThemeVisual("dark", "pierre");

    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    expect(window.pier.terminal.applyTheme).not.toHaveBeenCalled();
    expect(
      document.documentElement.style.getPropertyValue("--terminal-background")
    ).toBe(expected);
  });

  it("broadcasts ephemeral visual preview to other windows by default", async () => {
    const { applyThemeVisual } = await import("@/stores/theme.store.ts");
    applyThemeVisual("light", "github");
    expect(window.pier.theme.previewVisual).toHaveBeenCalledWith({
      stylePresetId: "github",
      theme: "light",
    });
  });

  it("skips broadcast when applying a remote visual preview", async () => {
    const { applyThemeVisual } = await import("@/stores/theme.store.ts");
    applyThemeVisual("light", "github", { broadcast: false });
    expect(window.pier.theme.previewVisual).not.toHaveBeenCalled();
  });

  it("keeps nativeTheme source as system when following OS appearance", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true }))
    );
    const { applyThemeVisual, resolveTheme } = await import(
      "@/stores/theme.store.ts"
    );
    applyThemeVisual("system", "pierre");
    const resolved = resolveTheme("system");
    const expected = deriveTerminalColors(
      getShikiTheme("pierre", resolved),
      resolved
    ).background;
    expect(window.pier.theme.setNativeChrome).toHaveBeenLastCalledWith(
      "system",
      expected
    );
  });

  it("re-applies when following system and matchMedia reports an OS change", async () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const mq = {
      matches: true,
      addEventListener: (
        _type: string,
        listener: EventListenerOrEventListenerObject
      ) => {
        if (typeof listener === "function") {
          listeners.add(listener as (event: MediaQueryListEvent) => void);
        }
      },
      removeEventListener: (
        _type: string,
        listener: EventListenerOrEventListenerObject
      ) => {
        if (typeof listener === "function") {
          listeners.delete(listener as (event: MediaQueryListEvent) => void);
        }
      },
    };
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => mq)
    );
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        preferences: {
          onChanged: vi.fn(() => () => undefined),
          read: vi.fn(async () => ({
            stylePresetId: "pierre",
            theme: "system",
          })),
        },
        terminal: { applyTheme: vi.fn() },
        theme: {
          onSystemAppearance: vi.fn(() => () => undefined),
          onVisualPreview: vi.fn(() => () => undefined),
          previewVisual: vi.fn(async () => undefined),
          setNativeChrome: vi.fn(async () => undefined),
        },
      },
    });

    const { initTheme } = await import("@/stores/theme.store.ts");
    await initTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    mq.matches = false;
    for (const listener of listeners) {
      listener({ matches: false } as MediaQueryListEvent);
    }

    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(window.pier.theme.setNativeChrome).toHaveBeenLastCalledWith(
      "system",
      expect.any(String)
    );
  });

  it("follows nativeTheme.updated while the preference is system", async () => {
    let onAppearance:
      | ((payload: { shouldUseDarkColors: boolean }) => void)
      | undefined;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        addEventListener: vi.fn(),
        matches: true,
        removeEventListener: vi.fn(),
      }))
    );
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        preferences: {
          onChanged: vi.fn(() => () => undefined),
          read: vi.fn(async () => ({
            stylePresetId: "pierre",
            theme: "system",
          })),
        },
        terminal: { applyTheme: vi.fn() },
        theme: {
          onSystemAppearance: vi.fn((cb) => {
            onAppearance = cb;
            return () => {
              onAppearance = undefined;
            };
          }),
          onVisualPreview: vi.fn(() => () => undefined),
          previewVisual: vi.fn(async () => undefined),
          setNativeChrome: vi.fn(async () => undefined),
        },
      },
    });

    const { initTheme } = await import("@/stores/theme.store.ts");
    await initTheme();
    expect(onAppearance).toBeTypeOf("function");
    onAppearance?.({ shouldUseDarkColors: false });
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(window.pier.theme.setNativeChrome).toHaveBeenLastCalledWith(
      "system",
      expect.any(String)
    );
  });

  it("ignores OS appearance changes when the preference is pinned dark", async () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const mq = {
      matches: true,
      addEventListener: (
        _type: string,
        listener: EventListenerOrEventListenerObject
      ) => {
        if (typeof listener === "function") {
          listeners.add(listener as (event: MediaQueryListEvent) => void);
        }
      },
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => mq)
    );
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        preferences: {
          onChanged: vi.fn(() => () => undefined),
          read: vi.fn(async () => ({
            stylePresetId: "pierre",
            theme: "dark",
          })),
        },
        terminal: { applyTheme: vi.fn() },
        theme: {
          onSystemAppearance: vi.fn(() => () => undefined),
          onVisualPreview: vi.fn(() => () => undefined),
          previewVisual: vi.fn(async () => undefined),
          setNativeChrome: vi.fn(async () => undefined),
        },
      },
    });

    const { initTheme } = await import("@/stores/theme.store.ts");
    await initTheme();
    expect(window.pier.theme.setNativeChrome).toHaveBeenLastCalledWith(
      "dark",
      expect.any(String)
    );

    mq.matches = false;
    for (const listener of listeners) {
      listener({ matches: false } as MediaQueryListEvent);
    }

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.pier.theme.setNativeChrome).toHaveBeenLastCalledWith(
      "dark",
      expect.any(String)
    );
  });
});
