export const LOCALE_OPTIONS = [
  { value: "system", label: "settings.locale.system" },
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
] as const;

export type LocaleValue = "system" | "zh-CN" | "en";
export const DEFAULT_LOCALE: LocaleValue = "system";
