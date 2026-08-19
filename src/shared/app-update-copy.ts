/**
 * App-update ready notification copy (main-resolved at emit time).
 * titleKey still stored so inbox cards re-resolve after locale switch.
 */
import type { SupportedLocale } from "./i18n/locales.ts";

export type AppUpdateUiLocale = SupportedLocale;

const READY_COPY: Record<
  AppUpdateUiLocale,
  { body: (version: string) => string; title: string }
> = {
  en: {
    body: (version) => `Pier ${version} · restart to finish installing`,
    title: "Update ready",
  },
  ja: {
    body: (version) => `Pier ${version} · 再起動してインストール`,
    title: "更新の準備ができました",
  },
  ko: {
    body: (version) => `Pier ${version} · 다시 시작해 설치`,
    title: "업데이트 준비됨",
  },
  "zh-CN": {
    body: (version) => `Pier ${version} · 重启后自动安装`,
    title: "更新已就绪",
  },
};

export function formatAppUpdateReadyCopy(
  version: string,
  locale: AppUpdateUiLocale
): { body: string; title: string } {
  const copy = READY_COPY[locale];
  return {
    body: copy.body(version),
    title: copy.title,
  };
}
