/**
 * Locale-aware number, money, size, duration, and relative-time helpers.
 * Same implementations as `@pier/ui/format.tsx`. Not components.
 */

export const formatCompactNumber: (value: number, locale: string) => string;
export const formatCount: (value: number, locale: string) => string;
export const formatCurrency: (
  value: number,
  locale: string,
  currency?: string
) => string;
export const formatCompactCurrency: (
  value: number,
  locale: string,
  currency?: string
) => string;
export const formatBytes: (value: number, locale: string) => string;
export const formatPercent: (ratio: number, locale: string) => string;
export const formatDurationShort: (ms: number, locale?: string) => string;
export const formatRelativeTime: (
  timestamp: number,
  now: number,
  locale: string
) => string;
