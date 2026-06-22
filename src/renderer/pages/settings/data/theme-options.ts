export const THEME_OPTIONS = [
  { value: "light", labelKey: "settings.theme.light" },
  { value: "dark", labelKey: "settings.theme.dark" },
  { value: "system", labelKey: "settings.theme.system" },
] as const;

export type ThemeValue = (typeof THEME_OPTIONS)[number]["value"];
export const DEFAULT_THEME: ThemeValue = "system";
