import {
  formatBytes,
  formatCompactNumber,
  formatCount,
  formatDurationShort,
  formatPercent,
} from "@pier/ui/format.tsx";
import type { MetricFormat } from "./metric-registry.ts";

/** 指标数值 → 展示字符串（质量红线：数字禁止各处手搓格式化）。 */
export function formatMetricNumber(
  format: MetricFormat,
  value: number | null,
  locale: string
): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  switch (format) {
    case "bytes":
      return formatBytes(value, locale);
    case "compactNumber":
      return formatCompactNumber(value, locale);
    case "count":
      return formatCount(value, locale);
    case "decimal":
      try {
        return new Intl.NumberFormat(locale, {
          maximumFractionDigits: 1,
          minimumFractionDigits: 1,
        }).format(value);
      } catch {
        return value.toFixed(1);
      }
    case "duration":
      return formatDurationShort(value);
    case "percent":
      return formatPercent(value, locale);
    default:
      return String(value);
  }
}
