/**
 * quick-pick 行右侧时间列的统一格式: 7 天内相对时间("12分钟前"),
 * 更早显示短日期(跨年补年份)。解析失败返回 "" 由调用方兜底。
 */

function getIntlLocale(): string {
  if (typeof document !== "undefined" && document.documentElement.lang) {
    return document.documentElement.lang;
  }
  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language;
  }
  return "en-US";
}

function parseIsoDate(value: null | string | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatRelativeTime(value: null | string | undefined): string {
  const date = parseIsoDate(value);
  if (!date) {
    return "";
  }
  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const locale = getIntlLocale();
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (absMs < hour) {
    return relative.format(Math.round(diffMs / minute), "minute");
  }
  if (absMs < day) {
    return relative.format(Math.round(diffMs / hour), "hour");
  }
  if (absMs < 7 * day) {
    return relative.format(Math.round(diffMs / day), "day");
  }
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" as const }),
  }).format(date);
}
