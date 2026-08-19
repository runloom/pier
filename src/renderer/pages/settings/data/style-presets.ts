import type { StylePresetId } from "@shared/contracts/preferences.ts";

export interface StylePresetOption {
  label: string;
  value: StylePresetId;
}

/** Official theme names. Show as-is in every locale. */
export const STYLE_PRESET_OPTIONS: readonly StylePresetOption[] = [
  { value: "pierre", label: "Pierre" },
  { value: "pierre-soft", label: "Pierre Soft" },
  { value: "catppuccin", label: "Catppuccin" },
  { value: "everforest", label: "Everforest" },
  { value: "github", label: "GitHub" },
  { value: "github-default", label: "GitHub Default" },
  { value: "github-high-contrast", label: "GitHub High Contrast" },
  { value: "gruvbox-hard", label: "Gruvbox Hard" },
  { value: "gruvbox-medium", label: "Gruvbox Medium" },
  { value: "gruvbox-soft", label: "Gruvbox Soft" },
  { value: "kanagawa", label: "Kanagawa" },
  { value: "vscode", label: "VS Code" },
  { value: "material", label: "Material" },
  { value: "min", label: "Min" },
  { value: "one", label: "One" },
  { value: "rose-pine", label: "Rose Pine" },
  { value: "slack", label: "Slack" },
  { value: "solarized", label: "Solarized" },
  { value: "tokyo-night", label: "Tokyo Night" },
  { value: "vitesse", label: "Vitesse" },
];

export const DEFAULT_STYLE_PRESET: StylePresetId = "pierre";
