import type {
  UsageDataPublishInput,
  UsageTokenObservation,
} from "@pier/plugin-api/main";
import { dateDaysAgo, filterByCoverageDate, todayDate } from "./date-range.ts";
import type { CachedTokenUsage } from "./file-cache.ts";

export const USAGE_PERIOD_DAYS = 31;

export function coverageWindow(): { from: string; to: string } {
  return {
    from: dateDaysAgo(USAGE_PERIOD_DAYS - 1),
    to: todayDate(),
  };
}

export function epochToDate(epoch: number): string | null {
  if (!Number.isFinite(epoch) || epoch <= 0) return null;
  const ms = epoch > 1e12 ? epoch : epoch * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function isoToDate(value: string | null | undefined): string | null {
  if (!value || value.length < 10) return null;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

export function numeric(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  if (
    typeof value === "bigint" &&
    value >= 0n &&
    value <= BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return Number(value);
  }
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.trunc(n);
  }
  return 0;
}

export function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

export function stringField(
  record: Record<string, unknown> | null | undefined,
  ...keys: string[]
): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

export function makeObservation(input: {
  cachedInputTokens?: number;
  date: string;
  inputTokens: number;
  modelId: string | null;
  outputTokens: number;
  reasoningTokens?: number;
  serviceTier?: string | null;
}): CachedTokenUsage | null {
  const inputTokens = Math.max(0, input.inputTokens);
  const outputTokens = Math.max(0, input.outputTokens);
  const reasoningTokens = Math.max(0, input.reasoningTokens ?? 0);
  const cachedInputTokens = Math.max(0, input.cachedInputTokens ?? 0);
  if (inputTokens + outputTokens + reasoningTokens === 0) return null;
  return {
    cachedInputTokens,
    date: input.date,
    inputTokens,
    modelId: input.modelId,
    outputTokens,
    reasoningTokens,
    serviceTier: input.serviceTier ?? null,
  };
}

export function publishInputFromUsages(options: {
  observations: readonly CachedTokenUsage[];
  sourceId: string;
  from: string;
  to: string;
  complete?: boolean;
}): UsageDataPublishInput {
  const observations = filterByCoverageDate(
    options.observations,
    options.from,
    options.to
  );
  return {
    coverage: {
      complete: options.complete ?? true,
      from: options.from,
      to: options.to,
    },
    observations: observations.map(
      (observation): UsageTokenObservation => ({
        cachedInputTokens: observation.cachedInputTokens,
        date: observation.date,
        inputTokens: observation.inputTokens,
        modelId: observation.modelId,
        outputTokens: observation.outputTokens,
        reasoningTokens: observation.reasoningTokens,
        ...(observation.serviceTier
          ? { serviceTier: observation.serviceTier }
          : {}),
      })
    ),
    observedAt: Date.now(),
    scope: { kind: "machine" },
    sourceId: options.sourceId,
  };
}

/** session-level 聚合：同一 fingerprint 只保留一条（后写覆盖）。 */
export function dedupeByFingerprint(
  items: readonly { fingerprint: string; usage: CachedTokenUsage }[]
): CachedTokenUsage[] {
  const map = new Map<string, CachedTokenUsage>();
  for (const item of items) {
    map.set(item.fingerprint, item.usage);
  }
  return [...map.values()];
}
