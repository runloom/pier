import pierreDark from "@pierre/theme/pierre-dark";
import pierreDarkSoft from "@pierre/theme/pierre-dark-soft";
import pierreLight from "@pierre/theme/pierre-light";
import pierreLightSoft from "@pierre/theme/pierre-light-soft";
import type { StylePresetId } from "@shared/contracts/preferences.ts";
import catppuccinLatte from "@shikijs/themes/catppuccin-latte";
import catppuccinMocha from "@shikijs/themes/catppuccin-mocha";
import darkPlus from "@shikijs/themes/dark-plus";
import everforestDark from "@shikijs/themes/everforest-dark";
import everforestLight from "@shikijs/themes/everforest-light";
import githubDark from "@shikijs/themes/github-dark";
import githubDarkDefault from "@shikijs/themes/github-dark-default";
import githubDarkHighContrast from "@shikijs/themes/github-dark-high-contrast";
import githubLight from "@shikijs/themes/github-light";
import githubLightDefault from "@shikijs/themes/github-light-default";
import githubLightHighContrast from "@shikijs/themes/github-light-high-contrast";
import gruvboxDarkHard from "@shikijs/themes/gruvbox-dark-hard";
import gruvboxDarkMedium from "@shikijs/themes/gruvbox-dark-medium";
import gruvboxDarkSoft from "@shikijs/themes/gruvbox-dark-soft";
import gruvboxLightHard from "@shikijs/themes/gruvbox-light-hard";
import gruvboxLightMedium from "@shikijs/themes/gruvbox-light-medium";
import gruvboxLightSoft from "@shikijs/themes/gruvbox-light-soft";
import kanagawaLotus from "@shikijs/themes/kanagawa-lotus";
import kanagawaWave from "@shikijs/themes/kanagawa-wave";
import lightPlus from "@shikijs/themes/light-plus";
import materialTheme from "@shikijs/themes/material-theme";
import materialThemeLighter from "@shikijs/themes/material-theme-lighter";
import minDark from "@shikijs/themes/min-dark";
import minLight from "@shikijs/themes/min-light";
import oneDarkPro from "@shikijs/themes/one-dark-pro";
import oneLight from "@shikijs/themes/one-light";
import rosePine from "@shikijs/themes/rose-pine";
import rosePineDawn from "@shikijs/themes/rose-pine-dawn";
import slackDark from "@shikijs/themes/slack-dark";
import slackOchin from "@shikijs/themes/slack-ochin";
import solarizedDark from "@shikijs/themes/solarized-dark";
import solarizedLight from "@shikijs/themes/solarized-light";
import tokyoNight from "@shikijs/themes/tokyo-night";
import vitesseDark from "@shikijs/themes/vitesse-dark";
import vitesseLight from "@shikijs/themes/vitesse-light";
import {
  applyPierBrandOverlay,
  type PierBrandThemeLike,
  type ThemeTokenColor,
} from "./pierre-brand-overlay.ts";
import tokyoNightLight from "./presets/tokyo-night-light.ts";

export interface ShikiThemeLike extends PierBrandThemeLike {
  colors?: Record<string, string>;
  name?: string;
  semanticTokenColors?: Record<string, unknown>;
  tokenColors?: readonly ThemeTokenColor[];
  type?: "light" | "dark" | string;
}

interface PresetEntry {
  dark: ShikiThemeLike;
  light: ShikiThemeLike;
}

export const STYLE_PRESET_SOURCE_REGISTRY = {
  pierre: { light: pierreLight, dark: pierreDark },
  "pierre-soft": { light: pierreLightSoft, dark: pierreDarkSoft },
  catppuccin: { light: catppuccinLatte, dark: catppuccinMocha },
  everforest: { light: everforestLight, dark: everforestDark },
  github: { light: githubLight, dark: githubDark },
  "github-default": { light: githubLightDefault, dark: githubDarkDefault },
  "github-high-contrast": {
    light: githubLightHighContrast,
    dark: githubDarkHighContrast,
  },
  "gruvbox-hard": { light: gruvboxLightHard, dark: gruvboxDarkHard },
  "gruvbox-medium": { light: gruvboxLightMedium, dark: gruvboxDarkMedium },
  "gruvbox-soft": { light: gruvboxLightSoft, dark: gruvboxDarkSoft },
  kanagawa: { light: kanagawaLotus, dark: kanagawaWave },
  vscode: { light: lightPlus, dark: darkPlus },
  material: { light: materialThemeLighter, dark: materialTheme },
  min: { light: minLight, dark: minDark },
  one: { light: oneLight, dark: oneDarkPro },
  "rose-pine": { light: rosePineDawn, dark: rosePine },
  slack: { light: slackOchin, dark: slackDark },
  solarized: { light: solarizedLight, dark: solarizedDark },
  /**
   * Night: Shiki official `tokyo-night`.
   * Light: Enkia official pair (vendored; Shiki has no light bundle).
   */
  "tokyo-night": { light: tokyoNightLight, dark: tokyoNight },
  vitesse: { light: vitesseLight, dark: vitesseDark },
} satisfies Record<StylePresetId, PresetEntry>;

export const STYLE_PRESET_REGISTRY: Record<StylePresetId, PresetEntry> = {
  ...STYLE_PRESET_SOURCE_REGISTRY,
  pierre: {
    light: applyPierBrandOverlay(
      STYLE_PRESET_SOURCE_REGISTRY.pierre.light,
      "light"
    ),
    dark: applyPierBrandOverlay(
      STYLE_PRESET_SOURCE_REGISTRY.pierre.dark,
      "dark"
    ),
  },
  "pierre-soft": {
    light: applyPierBrandOverlay(
      STYLE_PRESET_SOURCE_REGISTRY["pierre-soft"].light,
      "light"
    ),
    dark: applyPierBrandOverlay(
      STYLE_PRESET_SOURCE_REGISTRY["pierre-soft"].dark,
      "dark"
    ),
  },
};

const PIERRE_SHIKI_THEME_PAIRS = {
  pierre: {
    dark: "pier-branded-pierre-dark",
    light: "pier-branded-pierre-light",
  },
  "pierre-soft": {
    dark: "pier-branded-pierre-soft-dark",
    light: "pier-branded-pierre-soft-light",
  },
} as const;

export function getShikiTheme(
  presetId: StylePresetId,
  mode: "light" | "dark"
): ShikiThemeLike {
  return STYLE_PRESET_REGISTRY[presetId][mode];
}

/**
 * Dual Shiki theme names for Pierre Diffs dual-theme mode.
 * Worker loads both once; light/dark only flips themeType (CSS variables),
 * avoiding setRenderOptions races that leave CodeView tokens stale.
 */
export function getShikiThemePair(presetId: StylePresetId): {
  readonly dark: string;
  readonly light: string;
} {
  if (presetId === "pierre" || presetId === "pierre-soft") {
    return PIERRE_SHIKI_THEME_PAIRS[presetId];
  }
  const dark = getShikiTheme(presetId, "dark");
  const light = getShikiTheme(presetId, "light");
  return {
    dark: dark.name ?? `${presetId}-dark`,
    light: light.name ?? `${presetId}-light`,
  };
}
