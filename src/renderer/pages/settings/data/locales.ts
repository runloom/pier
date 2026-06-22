export const LOCALE_OPTIONS = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
] as const;

export type LocaleValue = "zh-CN" | "en";
export const DEFAULT_LOCALE: LocaleValue = "zh-CN";
