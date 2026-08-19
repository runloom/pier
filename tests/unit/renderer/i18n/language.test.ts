import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LANGUAGE_PREFERENCE,
  resolveLanguagePreference,
  resolveSystemLocale,
} from "@/i18n/language.ts";
import {
  DEFAULT_LOCALE,
  LOCALE_OPTIONS,
} from "@/pages/settings/data/locales.ts";

describe("language preference", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses follow system as the default display preference", () => {
    expect(DEFAULT_LANGUAGE_PREFERENCE).toBe("system");
    expect(DEFAULT_LOCALE).toBe("system");
    expect(LOCALE_OPTIONS.map((option) => option.value)).toEqual([
      "system",
      "zh-CN",
      "en",
      "ja",
      "ko",
    ]);
  });

  it("resolves system Chinese to zh-CN", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("zh-CN");
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-CN"]);

    expect(resolveSystemLocale()).toBe("zh-CN");
    expect(resolveLanguagePreference("system")).toBe("zh-CN");
  });

  it("resolves Traditional Chinese system tags to Simplified Chinese", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("zh-TW");
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-Hant-TW"]);

    expect(resolveSystemLocale()).toBe("zh-CN");
  });

  it("resolves Japanese and Korean system tags", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("ja-JP");
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["ja-JP"]);
    expect(resolveSystemLocale()).toBe("ja");

    vi.spyOn(navigator, "language", "get").mockReturnValue("ko-KR");
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["ko-KR"]);
    expect(resolveSystemLocale()).toBe("ko");
  });

  it("resolves unsupported system locales to English fallback", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("fr-FR");
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-FR"]);

    expect(resolveSystemLocale()).toBe("en");
    expect(resolveLanguagePreference("en")).toBe("en");
    expect(resolveLanguagePreference("zh-CN")).toBe("zh-CN");
    expect(resolveLanguagePreference("ja")).toBe("ja");
    expect(resolveLanguagePreference("ko")).toBe("ko");
  });
});
