import pierreDark from "@pierre/theme/pierre-dark";
import { describe, expect, it } from "vitest";
import { deriveTerminalColors } from "@/lib/theme/derive-terminal-colors.ts";
import { contrast } from "@/lib/theme/oklch.ts";

describe("deriveTerminalColors — selection colors", () => {
  it("derives a readable selection foreground for Pierre dark", () => {
    const colors = deriveTerminalColors(pierreDark, "dark");

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
