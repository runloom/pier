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

const ERROR_COPY: Record<AppUpdateUiLocale, { body: string; title: string }> = {
  en: {
    body: "Pier couldn’t complete the update. Try again later in Settings › Updates.",
    title: "App update failed",
  },
  ja: {
    body: "Pier の更新を完了できませんでした。後で「設定 › 更新」から再試行してください。",
    title: "アプリの更新に失敗しました",
  },
  ko: {
    body: "Pier 업데이트를 완료하지 못했습니다. 나중에 설정 › 업데이트에서 다시 시도하세요.",
    title: "앱 업데이트 실패",
  },
  "zh-CN": {
    body: "Pier 暂时无法完成更新。请稍后在「设置 › 更新」中重试。",
    title: "应用更新失败",
  },
};

export function formatAppUpdateErrorCopy(locale: AppUpdateUiLocale): {
  body: string;
  title: string;
} {
  return ERROR_COPY[locale];
}

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
