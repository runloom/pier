export type { StylePresetId } from "@shared/contracts/preferences.ts";

export interface StylePresetOption {
  labelKey: string;
  value: StylePresetId;
}

export const STYLE_PRESET_OPTIONS: readonly StylePresetOption[] = [
  { value: "pierre", labelKey: "settings.stylePreset.pierre" },
  { value: "pierre-soft", labelKey: "settings.stylePreset.pierre-soft" },
  { value: "catppuccin", labelKey: "settings.stylePreset.catppuccin" },
  { value: "everforest", labelKey: "settings.stylePreset.everforest" },
  { value: "github", labelKey: "settings.stylePreset.github" },
  { value: "github-default", labelKey: "settings.stylePreset.github-default" },
  {
    value: "github-high-contrast",
    labelKey: "settings.stylePreset.github-high-contrast",
  },
  { value: "gruvbox-hard", labelKey: "settings.stylePreset.gruvbox-hard" },
  { value: "gruvbox-medium", labelKey: "settings.stylePreset.gruvbox-medium" },
  { value: "gruvbox-soft", labelKey: "settings.stylePreset.gruvbox-soft" },
  { value: "kanagawa", labelKey: "settings.stylePreset.kanagawa" },
  { value: "vscode", labelKey: "settings.stylePreset.vscode" },
  { value: "material", labelKey: "settings.stylePreset.material" },
  { value: "min", labelKey: "settings.stylePreset.min" },
  { value: "one", labelKey: "settings.stylePreset.one" },
  { value: "rose-pine", labelKey: "settings.stylePreset.rose-pine" },
  { value: "slack", labelKey: "settings.stylePreset.slack" },
  { value: "solarized", labelKey: "settings.stylePreset.solarized" },
  { value: "vitesse", labelKey: "settings.stylePreset.vitesse" },
];

export const DEFAULT_STYLE_PRESET: StylePresetId = "pierre";
