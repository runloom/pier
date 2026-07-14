/**
 * 数值展示的共享 formatter（指挥中心质量红线：数字禁止各处手搓）。
 * 全部基于 Intl，locale 感知；失败回退 en。
 */

function safeNumberFormat(
  locale: string,
  options: Intl.NumberFormatOptions
): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale, options);
  } catch {
    return new Intl.NumberFormat("en", options);
  }
}

/** 紧凑数字：3.1B / 79.7M / 4.2K（zh 下为 31亿 / 7970万 等本地化形态）。 */
export function formatCompactNumber(value: number, locale: string): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return safeNumberFormat(locale, {
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(value);
}

/** 整数计数（千分位）。 */
export function formatCount(value: number, locale: string): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return safeNumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

/** 货币金额：$86.62 / US$86.62，按 locale 展示。 */
export function formatCurrency(
  value: number,
  locale: string,
  currency = "USD"
): string {
  if (!Number.isFinite(value)) return "—";
  return safeNumberFormat(locale, {
    currency,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

/**
 * 紧凑货币：`$1.2K` / `$5M` / `$0.42`——图表轴 tick 用，保证任意量级都在
 * ≤ 5-6 字符范围内，避免因 axis 宽度不足被裁切。小于 1 时按标准 2 位小数
 * 展示（`$0.42` 而非 `$420m`）。
 */
export function formatCompactCurrency(
  value: number,
  locale: string,
  currency = "USD"
): string {
  if (!Number.isFinite(value)) return "—";
  const options: Intl.NumberFormatOptions = {
    currency,
    currencyDisplay: "narrowSymbol",
    style: "currency",
  };
  if (Math.abs(value) >= 1000) {
    options.notation = "compact";
    options.maximumFractionDigits = 1;
  } else {
    options.maximumFractionDigits = 2;
    options.minimumFractionDigits = 0;
  }
  return safeNumberFormat(locale, options).format(value);
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** 字节数：38 GB / 812 MB（1024 进制，最多 1 位小数）。 */
export function formatBytes(value: number, locale: string): string {
  if (!Number.isFinite(value) || value < 0) {
    return "—";
  }
  let unitIndex = 0;
  let scaled = value;
  while (scaled >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }
  const formatted = safeNumberFormat(locale, {
    maximumFractionDigits: scaled >= 100 || unitIndex === 0 ? 0 : 1,
  }).format(scaled);
  return `${formatted} ${BYTE_UNITS[unitIndex]}`;
}

/** 百分比：入参为 0-1 比例，输出 63%。 */
export function formatPercent(ratio: number, locale: string): string {
  if (!Number.isFinite(ratio)) {
    return "—";
  }
  return safeNumberFormat(locale, {
    maximumFractionDigits: 0,
    style: "percent",
  }).format(ratio);
}

/** 时长（毫秒 → 94h 47m / 12m 3s / 45s；中文按天、小时、分钟、秒展示）。 */
export function formatDurationShort(ms: number, locale = "en"): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "—";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (locale.toLowerCase().startsWith("zh")) {
    const days = Math.floor(hours / 24);
    if (days > 0) {
      return `${days}天 ${hours % 24}小时`;
    }
    if (hours > 0) {
      return `${hours}小时 ${minutes}分钟`;
    }
    if (minutes > 0) {
      return `${minutes}分钟 ${seconds}秒`;
    }
    return `${seconds}秒`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

const RELATIVE_STEPS: readonly {
  ms: number;
  unit: Intl.RelativeTimeFormatUnit;
}[] = [
  { ms: 86_400_000, unit: "day" },
  { ms: 3_600_000, unit: "hour" },
  { ms: 60_000, unit: "minute" },
  { ms: 1000, unit: "second" },
];

/** 相对时间："42 秒前 / 3 分钟前"（数据新鲜度显示用）。 */
export function formatRelativeTime(
  timestamp: number,
  now: number,
  locale: string
): string {
  const delta = timestamp - now;
  const magnitude = Math.abs(delta);
  let formatter: Intl.RelativeTimeFormat;
  try {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  } catch {
    formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  }
  for (const step of RELATIVE_STEPS) {
    if (magnitude >= step.ms) {
      return formatter.format(Math.round(delta / step.ms), step.unit);
    }
  }
  return formatter.format(0, "second");
}
