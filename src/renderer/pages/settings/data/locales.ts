import {
  DEFAULT_LANGUAGE_PREFERENCE,
  type LanguagePreference,
  SUPPORTED_LOCALES,
} from "@shared/i18n/locales.ts";

export const LOCALE_OPTIONS = [
  {
    label: "settings.locale.system",
    value: DEFAULT_LANGUAGE_PREFERENCE,
  },
  ...SUPPORTED_LOCALES.map((value) => ({
    label: `settings.locale.${value}`,
    value,
  })),
] as const;

export type LocaleValue = LanguagePreference;
export const DEFAULT_LOCALE: LocaleValue = DEFAULT_LANGUAGE_PREFERENCE;
