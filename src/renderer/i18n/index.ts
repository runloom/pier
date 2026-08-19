import i18next from "i18next";
import { pushHostCopyCatalog } from "@/lib/terminal/push-host-copy-catalog.ts";
import { FALLBACK_LOCALE, resolveLanguagePreference } from "./language.ts";
import { en } from "./locales/en/index.ts";
import { ja } from "./locales/ja/index.ts";
import { ko } from "./locales/ko/index.ts";
import { zhCN } from "./locales/zh-CN/index.ts";

let initialized = false;

function pushHostLanguage(languageTag: string): void {
  const api = window.pier?.terminal;
  if (!api?.setHostLanguage) {
    return;
  }
  api.setHostLanguage(languageTag).catch((err: unknown) => {
    console.error("[i18n] setHostLanguage failed:", err);
  });
}

function pushHostCopy(): void {
  pushHostCopyCatalog().catch((err: unknown) => {
    console.error("[i18n] setHostCopyCatalog failed:", err);
  });
}

export async function initI18n(): Promise<void> {
  if (initialized) {
    return;
  }
  const initialLocale = resolveLanguagePreference("system");
  document.documentElement.lang = initialLocale;
  await i18next.init({
    lng: initialLocale,
    fallbackLng: FALLBACK_LOCALE,
    interpolation: { escapeValue: false },
    resources: {
      "zh-CN": { translation: zhCN },
      en: { translation: en },
      ja: { translation: ja },
      ko: { translation: ko },
    },
  });
  const lang = i18next.resolvedLanguage ?? initialLocale;
  pushHostLanguage(lang);
  pushHostCopy();
  i18next.on("languageChanged", (lng) => {
    document.documentElement.lang = lng;
    pushHostLanguage(lng);
    pushHostCopy();
  });
  initialized = true;
}
