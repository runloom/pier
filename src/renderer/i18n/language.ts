export const SUPPORTED_LOCALES = ["zh-CN", "en"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type LanguagePreference = "system" | SupportedLocale;

export const DEFAULT_LANGUAGE_PREFERENCE: LanguagePreference = "system";
export const FALLBACK_LOCALE: SupportedLocale = "en";

export function resolveSystemLocale(): SupportedLocale {
  const candidates =
    typeof navigator === "undefined"
      ? []
      : [navigator.language, ...(navigator.languages ?? [])];

  for (const candidate of candidates) {
    const normalized = candidate.toLowerCase();
    if (normalized === "zh-cn" || normalized.startsWith("zh-hans")) {
      return "zh-CN";
    }
    if (normalized.startsWith("en")) {
      return "en";
    }
  }

  return FALLBACK_LOCALE;
}

export function resolveLanguagePreference(
  language: LanguagePreference
): SupportedLocale {
  return language === "system" ? resolveSystemLocale() : language;
}
