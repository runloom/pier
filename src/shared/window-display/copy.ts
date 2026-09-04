import { FALLBACK_LOCALE, type SupportedLocale } from "../i18n/locales.ts";

export interface WindowDisplayCopy {
  /** Fallback when nothing better is known (numbered). */
  emptyWindow: (index: number) => string;
  /** Right-side qualifier when the window has no panels. */
  emptyWindowDescription: string;
  /** Disambiguate same labels: "pier" → "pier · 2". */
  sameNameIndex: (index: number) => string;
}

const EMPTY_WINDOW: Record<SupportedLocale, (index: number) => string> = {
  en: (index) => `Window ${index}`,
  ja: (index) => `ウインドウ ${index}`,
  ko: (index) => `윈도우 ${index}`,
  "zh-CN": (index) => `窗口 ${index}`,
};

const EMPTY_WINDOW_DESCRIPTION: Record<SupportedLocale, string> = {
  en: "Empty window",
  ja: "空のウインドウ",
  ko: "빈 윈도우",
  "zh-CN": "空窗口",
};

export function windowDisplayCopyForLocale(
  locale: SupportedLocale
): WindowDisplayCopy {
  return {
    emptyWindow: EMPTY_WINDOW[locale],
    emptyWindowDescription: EMPTY_WINDOW_DESCRIPTION[locale],
    sameNameIndex: (index) => ` · ${index}`,
  };
}

export function windowDisplayCopyFromI18n(
  t: (key: string, options?: Record<string, number | string>) => string
): WindowDisplayCopy {
  return {
    emptyWindow: (index) =>
      t("workspace.panelTransfer.windowLabel", { n: index }),
    emptyWindowDescription: t("workspace.panelTransfer.emptyWindowDescription"),
    sameNameIndex: (index) =>
      t("workspace.panelTransfer.sameNameIndex", { n: index }),
  };
}

export function resolveWindowDisplayCopy(
  locale: SupportedLocale | undefined
): WindowDisplayCopy {
  return windowDisplayCopyForLocale(locale ?? FALLBACK_LOCALE);
}
