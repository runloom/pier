import { mix, normalizeHex } from "./oklch.ts";

export const PIER_BRAND_PALETTE = {
  highlight: "#b66cff",
  primary: "#8549ff",
  deep: "#542ee5",
} as const;

export interface ThemeTokenColor {
  readonly name?: string;
  readonly scope?: string | readonly string[];
  readonly settings?: Readonly<Record<string, string>>;
}

export interface PierBrandThemeLike {
  readonly colors?: Readonly<Record<string, string>>;
  readonly name?: string;
  readonly semanticTokenColors?: Readonly<Record<string, unknown>>;
  readonly tokenColors?: readonly ThemeTokenColor[];
  readonly type?: string;
}

const DECORATOR_SCOPES = new Set([
  "meta.decorator",
  "entity.name.function.decorator",
  "punctuation.definition.decorator",
]);

function includesDecoratorScope(
  scope: string | readonly string[] | undefined
): boolean {
  const scopes = typeof scope === "string" ? [scope] : (scope ?? []);
  return scopes.some((value) => DECORATOR_SCOPES.has(value));
}

function mixedSurface(background: string, strength: number): string {
  return mix(background, PIER_BRAND_PALETTE.primary, strength);
}

function withHexAlpha(color: string, alpha: "2e" | "4d"): string {
  return `${color}${alpha}`;
}

export function applyPierBrandOverlay<T extends PierBrandThemeLike>(
  source: T,
  mode: "light" | "dark"
): T {
  const originalColors = source.colors ?? {};
  const background =
    normalizeHex(originalColors["editor.background"]) ??
    (mode === "dark" ? "#0a0a0a" : "#ffffff");
  const textAccent =
    mode === "dark" ? PIER_BRAND_PALETTE.highlight : PIER_BRAND_PALETTE.primary;
  const selectionStrength = mode === "dark" ? 0.24 : 0.12;
  const activeSelectionStrength = mode === "dark" ? 0.32 : 0.18;
  const inactiveSelectionStrength = mode === "dark" ? 0.18 : 0.1;

  const colors = {
    ...originalColors,
    "activityBar.activeBorder": PIER_BRAND_PALETTE.primary,
    "activityBarBadge.background": PIER_BRAND_PALETTE.primary,
    "activityBarBadge.foreground": "#ffffff",
    "button.background": PIER_BRAND_PALETTE.primary,
    "button.foreground": "#ffffff",
    "button.hoverBackground": PIER_BRAND_PALETTE.deep,
    "charts.blue": PIER_BRAND_PALETTE.primary,
    "editor.selectionBackground": withHexAlpha(
      PIER_BRAND_PALETTE.primary,
      mode === "dark" ? "4d" : "2e"
    ),
    "editorCursor.foreground": PIER_BRAND_PALETTE.highlight,
    focusBorder: PIER_BRAND_PALETTE.highlight,
    "gitDecoration.modifiedResourceForeground": textAccent,
    "list.activeSelectionBackground": mixedSurface(
      background,
      activeSelectionStrength
    ),
    "list.focusOutline": PIER_BRAND_PALETTE.highlight,
    "list.inactiveSelectionBackground": mixedSurface(
      background,
      inactiveSelectionStrength
    ),
    "notificationLink.foreground": textAccent,
    "panelTitle.activeBorder": PIER_BRAND_PALETTE.primary,
    "selection.background": mixedSurface(background, selectionStrength),
    "tab.activeBorderTop": PIER_BRAND_PALETTE.primary,
    "terminal.ansiBlue": PIER_BRAND_PALETTE.primary,
    "terminal.ansiBrightBlue": PIER_BRAND_PALETTE.highlight,
    "textLink.activeForeground": textAccent,
    "textLink.foreground": textAccent,
  };

  const tokenColors = source.tokenColors?.map((rule) =>
    includesDecoratorScope(rule.scope)
      ? {
          ...rule,
          settings: { ...rule.settings, foreground: textAccent },
        }
      : rule
  );
  const semanticTokenColors = {
    ...source.semanticTokenColors,
    decorator: textAccent,
  };

  return {
    ...source,
    colors,
    semanticTokenColors,
    ...(tokenColors ? { tokenColors } : {}),
  } as T;
}
