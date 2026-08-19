export {
  DEFAULT_LANGUAGE_PREFERENCE,
  FALLBACK_LOCALE,
  LANGUAGE_PREFERENCE_VALUES,
  type LanguagePreference,
  LOCALE_NATIVE_NAMES,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@shared/i18n/locales.ts";

import {
  type LanguagePreference,
  resolveLanguagePreferenceFrom,
  resolveSystemLocaleFromTags,
  type SupportedLocale,
} from "@shared/i18n/locales.ts";

export function resolveSystemLocale(): SupportedLocale {
  const candidates =
    typeof navigator === "undefined"
      ? []
      : [navigator.language, ...(navigator.languages ?? [])];
  return resolveSystemLocaleFromTags(candidates);
}

export function resolveLanguagePreference(
  language: LanguagePreference
): SupportedLocale {
  return resolveLanguagePreferenceFrom(language, resolveSystemLocale());
}
