import type { AccountUsageResult } from "./types.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** xAI money fields may be number or `{ val: string | number }` (USD cents). */
function asCents(value: unknown): number | null {
  const record = asRecord(value);
  if (!record) return asFiniteNumber(value);
  return asFiniteNumber(record.val);
}

function periodLabel(type: unknown): string {
  if (type === "USAGE_PERIOD_TYPE_MONTHLY") return "Monthly limit";
  if (type === "USAGE_PERIOD_TYPE_WEEKLY") return "Weekly limit";
  if (typeof type === "string" && type.length > 0) return type;
  return "Quota";
}

function productLabel(product: unknown): string {
  if (product === "Api") return "API";
  if (product === "GrokBuild") return "Grok Build";
  if (typeof product === "string" && product.length > 0) return product;
  return "Product";
}

function parseIsoMs(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function windowMinutesFromRange(
  startMs: number | null,
  endMs: number | null
): number | undefined {
  if (startMs === null || endMs === null || endMs <= startMs) return;
  return Math.max(1, Math.round((endMs - startMs) / 60_000));
}

function pushPeriodWindow(
  windows: AccountUsageResult["windows"],
  options: {
    endMs: number | null;
    limitName: string;
    minutes: number | undefined;
    usedPercent: number;
  }
): void {
  windows.push({
    id: "grok:period",
    limitId: "period",
    limitName: options.limitName,
    usedPercent: options.usedPercent,
    ...(options.endMs === null ? {} : { resetsAt: options.endMs }),
    ...(options.minutes === undefined
      ? {}
      : { windowMinutes: options.minutes }),
  });
}

/**
 * Map Grok CLI chat-proxy billing JSON into Codex-shaped usage windows.
 *
 * Supports two observed shapes:
 * 1. Default `/v1/billing`: `{ monthlyLimit, used, onDemandCap, billingPeriod* }`
 * 2. `?format=credits` (when populated): `{ creditUsagePercent, productUsage, currentPeriod, ... }`
 */
export function parseGrokBillingResult(payload: unknown): AccountUsageResult {
  const root = asRecord(payload);
  const config = asRecord(root?.config) ?? root;
  if (!config) {
    return {
      status: "error",
      error: "Invalid Grok billing response",
      windows: [],
    };
  }

  const period = asRecord(config.currentPeriod);
  const startMs =
    parseIsoMs(period?.start) ?? parseIsoMs(config.billingPeriodStart);
  const endMs = parseIsoMs(period?.end) ?? parseIsoMs(config.billingPeriodEnd);
  const minutes = windowMinutesFromRange(startMs, endMs);
  const windows: AccountUsageResult["windows"] = [];

  // Shape A: absolute cents used / monthlyLimit (default /v1/billing).
  const monthlyLimit = asCents(config.monthlyLimit);
  const used = asCents(config.used);
  if (monthlyLimit !== null && monthlyLimit > 0 && used !== null) {
    pushPeriodWindow(windows, {
      endMs,
      limitName:
        periodLabel(period?.type) === "Quota"
          ? "Monthly limit"
          : periodLabel(period?.type),
      minutes:
        minutes ??
        windowMinutesFromRange(
          parseIsoMs(config.billingPeriodStart),
          parseIsoMs(config.billingPeriodEnd)
        ),
      usedPercent: (used / monthlyLimit) * 100,
    });
  }

  // Shape B: explicit percent (format=credits when populated).
  const creditUsagePercent = asFiniteNumber(config.creditUsagePercent);
  if (
    creditUsagePercent !== null &&
    !windows.some((w) => w.id === "grok:period")
  ) {
    pushPeriodWindow(windows, {
      endMs,
      limitName: periodLabel(period?.type),
      minutes,
      usedPercent: creditUsagePercent,
    });
  }

  const productUsage = config.productUsage;
  if (Array.isArray(productUsage)) {
    for (const item of productUsage) {
      const row = asRecord(item);
      if (!row) continue;
      const productUsed = asFiniteNumber(row.usagePercent);
      if (productUsed === null) continue;
      const product =
        typeof row.product === "string" && row.product.length > 0
          ? row.product
          : "unknown";
      windows.push({
        id: `grok:product:${product}`,
        limitId: "product",
        limitName: productLabel(product),
        usedPercent: productUsed,
        ...(endMs === null ? {} : { resetsAt: endMs }),
        ...(minutes === undefined ? {} : { windowMinutes: minutes }),
      });
    }
  }

  const cap = asCents(config.onDemandCap);
  const onDemandUsed =
    asCents(config.onDemandUsed) ??
    // default shape may only expose onDemandCap without a separate used field
    null;
  if (cap !== null && cap > 0 && onDemandUsed !== null) {
    windows.push({
      id: "grok:on-demand",
      limitId: "on-demand",
      limitName: "On-demand",
      usedPercent: (onDemandUsed / cap) * 100,
    });
  }

  // Prepaid remaining balance is not a used-percent window; skip as meter.

  if (windows.length === 0) {
    return {
      status: "error",
      error: "No Grok quota windows in billing response",
      windows: [],
    };
  }

  return {
    status: "ok",
    windows,
  };
}
