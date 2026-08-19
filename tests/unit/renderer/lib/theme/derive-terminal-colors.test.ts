import { describe, expect, it } from "vitest";
import { deriveTerminalColors } from "@/lib/theme/derive-terminal-colors.ts";
import { contrast, opaqueOn, visibleColor } from "@/lib/theme/oklch.ts";
import { PIER_BRAND_PALETTE } from "@/lib/theme/pierre-brand-overlay.ts";
import {
  getShikiTheme,
  STYLE_PRESET_SOURCE_REGISTRY,
} from "@/lib/theme/preset-registry.ts";

const PIERRE_CASES = [
  ["pierre", "light"],
  ["pierre", "dark"],
  ["pierre-soft", "light"],
  ["pierre-soft", "dark"],
] as const;

describe("deriveTerminalColors — selection colors", () => {
  it("derives a readable selection foreground for Pierre dark", () => {
    const colors = deriveTerminalColors(
      getShikiTheme("pierre", "dark"),
      "dark"
    );

    expect(colors.selectionBackground).toBeDefined();
    expect(colors.selectionForeground).toBeDefined();
    expect(
      contrast(colors.selectionBackground ?? "#000000", colors.background)
    ).toBeGreaterThanOrEqual(1.5);
    expect(
      contrast(
        colors.selectionBackground ?? "#000000",
        colors.selectionForeground ?? "#000000"
      )
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("derives Pier purple ANSI blue for every registered Pierre theme", () => {
    for (const [preset, mode] of PIERRE_CASES) {
      const terminal = deriveTerminalColors(getShikiTheme(preset, mode), mode);

      expect(terminal.palette[4]).toBe("#8549ff");
      expect(terminal.palette[12]).toBe("#b66cff");
    }
  });

  it("keeps Pierre terminal selection on the source theme, not the brand primary", () => {
    for (const [preset, mode] of PIERRE_CASES) {
      const source = STYLE_PRESET_SOURCE_REGISTRY[preset][mode];
      const terminal = deriveTerminalColors(getShikiTheme(preset, mode), mode);
      const expected = visibleColor(
        terminal.background,
        opaqueOn(
          source.colors?.["editor.selectionBackground"] ?? "",
          terminal.background
        ),
        1.5
      );

      expect(terminal.selectionBackground).toBe(expected);
      expect(terminal.selectionBackground).not.toBe(PIER_BRAND_PALETTE.primary);
    }
  });

  it("keeps an explicit readable terminal selection foreground", () => {
    const colors = deriveTerminalColors(
      {
        colors: {
          "editor.background": "#101010",
          "editor.foreground": "#f5f5f5",
          "terminal.selectionBackground": "#264f78",
          "terminal.selectionForeground": "#ffffff",
        },
      },
      "dark"
    );

    expect(colors.selectionForeground).toBe("#ffffff");
  });

  it("replaces a low-contrast terminal selection foreground", () => {
    const colors = deriveTerminalColors(
      {
        colors: {
          "editor.background": "#101010",
          "editor.foreground": "#f5f5f5",
          "terminal.selectionBackground": "#264f78",
          "terminal.selectionForeground": "#102030",
        },
      },
      "dark"
    );

    expect(colors.selectionForeground).not.toBe("#102030");
    expect(
      contrast(
        colors.selectionBackground ?? "#000000",
        colors.selectionForeground ?? "#000000"
      )
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("falls back to stable selection colors when the theme has no selection tokens", () => {
    const colors = deriveTerminalColors(
      {
        colors: {
          "editor.background": "#0a0a0a",
          "editor.foreground": "#fafafa",
        },
      },
      "dark"
    );

    expect(colors.selectionBackground).toBeDefined();
    expect(colors.selectionForeground).toBeDefined();
    expect(
      contrast(colors.selectionBackground ?? "#000000", colors.background)
    ).toBeGreaterThanOrEqual(1.5);
    expect(
      contrast(
        colors.selectionBackground ?? "#000000",
        colors.selectionForeground ?? "#000000"
      )
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe("deriveTerminalColors — ANSI dim text", () => {
  it("keeps autosuggestion gray readable in dark themes", () => {
    const colors = deriveTerminalColors(
      {
        colors: {
          "editor.background": "#0b0b0b",
          "editor.foreground": "#eeeeee",
          "terminal.ansiBrightBlack": "#111111",
        },
      },
      "dark"
    );

    expect(
      contrast(colors.background, colors.palette[8])
    ).toBeGreaterThanOrEqual(3);
  });

  it("keeps autosuggestion gray readable in light themes", () => {
    const colors = deriveTerminalColors(
      {
        colors: {
          "editor.background": "#fbfbfb",
          "editor.foreground": "#111111",
          "terminal.ansiBrightBlack": "#f1f1f1",
        },
      },
      "light"
    );

    expect(
      contrast(colors.background, colors.palette[8])
    ).toBeGreaterThanOrEqual(3);
  });
});
