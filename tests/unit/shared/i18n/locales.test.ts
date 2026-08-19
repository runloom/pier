import {
  FALLBACK_LOCALE,
  LANGUAGE_PREFERENCE_VALUES,
  LOCALE_NATIVE_NAMES,
  resolveLanguagePreferenceFrom,
  resolveSystemLocaleFromTags,
  resolveUiLocale,
  SUPPORTED_LOCALES,
} from "@shared/i18n/locales.ts";
import { describe, expect, it } from "vitest";

describe("shared locale registry", () => {
  it("lists follow-system plus every shipped UI language", () => {
    expect(LANGUAGE_PREFERENCE_VALUES).toEqual([
      "system",
      "zh-CN",
      "en",
      "ja",
      "ko",
    ]);
    expect(SUPPORTED_LOCALES).toEqual(["zh-CN", "en", "ja", "ko"]);
    expect(FALLBACK_LOCALE).toBe("en");
    expect(Object.keys(LOCALE_NATIVE_NAMES).sort()).toEqual(
      [...SUPPORTED_LOCALES].sort()
    );
  });

  it("maps every Chinese tag, including Traditional, to Simplified Chinese", () => {
    expect(resolveSystemLocaleFromTags(["zh-TW"])).toBe("zh-CN");
    expect(resolveSystemLocaleFromTags(["zh-Hant-TW"])).toBe("zh-CN");
    expect(resolveSystemLocaleFromTags(["zh-Hant-HK"])).toBe("zh-CN");
    expect(resolveSystemLocaleFromTags(["zh-HK"])).toBe("zh-CN");
    expect(resolveSystemLocaleFromTags(["zh"])).toBe("zh-CN");
    expect(resolveSystemLocaleFromTags(["zh-Hans-CN"])).toBe("zh-CN");
    expect(resolveSystemLocaleFromTags(["zh_TW"])).toBe("zh-CN");
  });

  it("resolves Japanese and Korean system tags", () => {
    expect(resolveSystemLocaleFromTags(["ja"])).toBe("ja");
    expect(resolveSystemLocaleFromTags(["ja-JP"])).toBe("ja");
    expect(resolveSystemLocaleFromTags(["ja-JP-mac"])).toBe("ja");
    expect(resolveSystemLocaleFromTags(["ko"])).toBe("ko");
    expect(resolveSystemLocaleFromTags(["ko-KR"])).toBe("ko");
  });

  it("falls back to English for unsupported system tags", () => {
    expect(resolveSystemLocaleFromTags(["fr-FR"])).toBe("en");
    expect(resolveSystemLocaleFromTags([])).toBe("en");
  });

  it("honors an explicit preference over the system tag", () => {
    expect(resolveLanguagePreferenceFrom("ja", "zh-CN")).toBe("ja");
    expect(resolveLanguagePreferenceFrom("system", "ko")).toBe("ko");
  });

  it("resolves ja/ko from preference or system tags, including missing prefs", () => {
    expect(resolveUiLocale("ja", ["en-US"])).toBe("ja");
    expect(resolveUiLocale("ko", ["zh-CN"])).toBe("ko");
    expect(resolveUiLocale("system", ["ja-JP"])).toBe("ja");
    expect(resolveUiLocale("system", ["ko-KR"])).toBe("ko");
    expect(resolveUiLocale(undefined, ["ja-JP"])).toBe("ja");
    expect(resolveUiLocale(undefined, ["fr-FR"])).toBe("en");
  });
});
