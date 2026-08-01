// Editor decoration washes derived from Shiki/VS Code theme colors.
import { hexToRgb, normalizeHex } from "./oklch.ts";

export type ThemeColorGetter = (...keys: string[]) => string | undefined;

export interface EditorDecorationTokens {
  "editor-active-line-bg": string;
  "editor-search-match-active-bg": string;
  "editor-search-match-active-border": string;
  "editor-search-match-bg": string;
  "editor-search-match-border": string;
  "editor-selection-bg": string;
  "editor-selection-match-bg": string;
  "editor-selection-match-main-bg": string;
}

/**
 * Pack #RRGGBB + alpha into #RRGGBBAA for CSS custom properties.
 * Decorations must stay translucent so syntax foreground remains primary.
 */
export function toHex8(hex: string, alpha01: number): string {
  const normalized = normalizeHex(hex) ?? "#000000";
  const rgb = normalized.slice(1, 7);
  const clamped = Math.min(1, Math.max(0, alpha01));
  const a = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${rgb}${a}`;
}

function themeColorAlpha(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return 1;
  }
  const normalized = normalizeHex(hex);
  if (normalized && normalized.length === 7) {
    return 1;
  }
  return rgb[3] / 255;
}

function decorationWash(
  get: ThemeColorGetter,
  keys: readonly string[],
  fallbackPigment: string,
  preferredAlpha: number,
  maxAlpha: number
): string {
  for (const key of keys) {
    const raw = get(key);
    if (!raw) {
      continue;
    }
    const normalized = normalizeHex(raw);
    if (!normalized) {
      continue;
    }
    const pigment = `#${normalized.slice(1, 7)}`;
    let alpha = themeColorAlpha(normalized);
    if (alpha >= 0.92) {
      alpha = preferredAlpha;
    }
    if (alpha < 0.06) {
      alpha = preferredAlpha;
    }
    alpha = Math.min(maxAlpha, Math.max(0.08, alpha));
    return toHex8(pigment, alpha);
  }
  return toHex8(fallbackPigment, preferredAlpha);
}

export function deriveEditorDecorationTokens(
  get: ThemeColorGetter,
  fg: string,
  mode: "light" | "dark"
): EditorDecorationTokens {
  const selectionAlpha = mode === "dark" ? 0.3 : 0.24;
  const matchAlpha = mode === "dark" ? 0.16 : 0.1;
  const matchMainAlpha = mode === "dark" ? 0.22 : 0.14;
  const searchAlpha = mode === "dark" ? 0.14 : 0.09;
  const searchActiveAlpha = mode === "dark" ? 0.22 : 0.14;
  const borderAlpha = mode === "dark" ? 0.42 : 0.32;
  const borderActiveAlpha = mode === "dark" ? 0.72 : 0.55;
  const activeLineAlpha = mode === "dark" ? 0.06 : 0.05;

  return {
    "editor-active-line-bg": decorationWash(
      get,
      ["editor.lineHighlightBackground"],
      fg,
      activeLineAlpha,
      0.12
    ),
    "editor-search-match-active-bg": decorationWash(
      get,
      ["editor.findMatchBackground", "editor.findMatchHighlightBackground"],
      fg,
      searchActiveAlpha,
      0.55
    ),
    "editor-search-match-active-border": decorationWash(
      get,
      ["editor.findMatchBorder", "editor.findMatchBackground"],
      fg,
      borderActiveAlpha,
      0.9
    ),
    "editor-search-match-bg": decorationWash(
      get,
      ["editor.findMatchHighlightBackground", "editor.findMatchBackground"],
      fg,
      searchAlpha,
      0.35
    ),
    "editor-search-match-border": decorationWash(
      get,
      ["editor.findMatchHighlightBorder", "editor.findMatchBorder"],
      fg,
      borderAlpha,
      0.65
    ),
    "editor-selection-bg": decorationWash(
      get,
      ["editor.selectionBackground"],
      fg,
      selectionAlpha,
      0.45
    ),
    "editor-selection-match-bg": decorationWash(
      get,
      [
        "editor.selectionHighlightBackground",
        "editor.wordHighlightTextBackground",
        "editor.wordHighlightBackground",
      ],
      fg,
      matchAlpha,
      0.28
    ),
    "editor-selection-match-main-bg": decorationWash(
      get,
      [
        "editor.selectionHighlightBackground",
        "editor.wordHighlightStrongBackground",
        "editor.wordHighlightBackground",
      ],
      fg,
      matchMainAlpha,
      0.34
    ),
  };
}
