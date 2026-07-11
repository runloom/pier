import { join } from "node:path";
import type {
  MainPluginUsageData,
  UsageDataDailyBucket,
  UsageDataPublishInput,
  UsageDataScope,
  UsageDataSnapshot,
  UsageTokenObservation,
  UsageTokenTotals,
} from "@pier/plugin-api/main";
import { z } from "zod";
import { versionedJsonStore } from "../../state/versioned-store.ts";
import { estimateObservationCostMicrousd } from "./pricing.ts";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_OBSERVATIONS = 20_000;

const tokenTotalsSchema = z.object({
  cachedInputTokens: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});
const scopeSchema = z.union([
  z.object({ kind: z.literal("machine") }),
  z.object({ key: z.string().min(1).max(200), kind: z.literal("account") }),
]);
const snapshotSchema = z.object({
  buckets: z.array(
    z.object({
      date: z.string().regex(DATE_PATTERN),
      estimatedCostMicrousd: z.number().int().nonnegative().nullable(),
      pricingStatus: z.enum(["complete", "partial", "unpriced"]),
      tokens: tokenTotalsSchema,
    })
  ),
  coverage: z.object({
    complete: z.boolean(),
    from: z.string().regex(DATE_PATTERN),
    to: z.string().regex(DATE_PATTERN),
  }),
  observedAt: z.number().int().nonnegative(),
  pluginId: z.string().min(1),
  scope: scopeSchema,
  sourceId: z.string().min(1).max(100),
  summary: z.object({
    estimatedCostMicrousd: z.number().int().nonnegative().nullable(),
    latestDayTokens: z.number().int().nonnegative(),
    periodTokens: z.number().int().nonnegative(),
    todayEstimatedCostMicrousd: z.number().int().nonnegative().nullable(),
  }),
});
const stateSchema = z.object({
  snapshots: z.record(z.string(), snapshotSchema),
  version: z.literal(1),
});
type UsageDataState = z.infer<typeof stateSchema>;

export interface UsageDataService {
  createPluginFacade(
    pluginId: string,
    canPublish: boolean
  ): MainPluginUsageData;
  flush(): Promise<void>;
  init(): Promise<void>;
  publish(pluginId: string, input: UsageDataPublishInput): UsageDataSnapshot;
  read(
    pluginId: string,
    sourceId: string,
    scope: UsageDataScope
  ): UsageDataSnapshot | null;
}

function scopeKey(scope: UsageDataScope): string {
  return scope.kind === "machine" ? "machine" : `account:${scope.key}`;
}

function snapshotKey(
  pluginId: string,
  sourceId: string,
  scope: UsageDataScope
): string {
  return `${pluginId}\u0000${sourceId}\u0000${scopeKey(scope)}`;
}

function assertPublishInput(input: UsageDataPublishInput): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(input.sourceId)) {
    throw new Error("Invalid usage source id");
  }
  if (
    !(
      DATE_PATTERN.test(input.coverage.from) &&
      DATE_PATTERN.test(input.coverage.to)
    )
  ) {
    throw new Error("Invalid usage coverage date");
  }
  if (input.coverage.from > input.coverage.to) {
    throw new Error("Usage coverage start must not be after end");
  }
  if (!Number.isSafeInteger(input.observedAt) || input.observedAt < 0) {
    throw new Error("Invalid usage observation timestamp");
  }
  if (input.observations.length > MAX_OBSERVATIONS) {
    throw new Error(`Too many usage observations (max ${MAX_OBSERVATIONS})`);
  }
  for (const observation of input.observations) {
    if (!DATE_PATTERN.test(observation.date))
      throw new Error("Invalid usage date");
    if (
      observation.date < input.coverage.from ||
      observation.date > input.coverage.to
    ) {
      throw new Error("Usage observation is outside coverage");
    }
    for (const value of [
      observation.inputTokens,
      observation.cachedInputTokens,
      observation.outputTokens,
      observation.reasoningTokens ?? 0,
      observation.totalTokens ?? 0,
    ]) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(
          "Usage token counts must be non-negative safe integers"
        );
      }
    }
    if (
      observation.totalTokens !== undefined &&
      observation.totalTokens <
        observation.inputTokens + observation.outputTokens
    ) {
      throw new Error("Usage total tokens cannot be below input plus output");
    }
  }
}

function emptyTotals(): UsageTokenTotals {
  return {
    cachedInputTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
}

function pricingStatus(
  pricedCount: number,
  unpricedCount: number
): UsageDataDailyBucket["pricingStatus"] {
  if (unpricedCount === 0) return "complete";
  if (pricedCount > 0) return "partial";
  return "unpriced";
}

function buildBuckets(
  observations: UsageTokenObservation[]
): UsageDataDailyBucket[] {
  const byDate = new Map<
    string,
    { costs: number[]; totals: UsageTokenTotals; unpriced: number }
  >();
  for (const observation of observations) {
    const row = byDate.get(observation.date) ?? {
      costs: [],
      totals: emptyTotals(),
      unpriced: 0,
    };
    row.totals.inputTokens += observation.inputTokens;
    row.totals.cachedInputTokens += observation.cachedInputTokens;
    row.totals.outputTokens += observation.outputTokens;
    row.totals.reasoningTokens += observation.reasoningTokens ?? 0;
    row.totals.totalTokens +=
      observation.totalTokens ??
      observation.inputTokens + observation.outputTokens;
    const cost = estimateObservationCostMicrousd(observation);
    if (cost === null) row.unpriced += 1;
    else row.costs.push(cost);
    byDate.set(observation.date, row);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, row]) => ({
      date,
      estimatedCostMicrousd:
        row.costs.length > 0
          ? row.costs.reduce((sum, value) => sum + value, 0)
          : null,
      pricingStatus: pricingStatus(row.costs.length, row.unpriced),
      tokens: row.totals,
    }));
}

function buildSnapshot(
  pluginId: string,
  input: UsageDataPublishInput
): UsageDataSnapshot {
  const buckets = buildBuckets(input.observations);
  const priced = buckets.flatMap((bucket) =>
    bucket.estimatedCostMicrousd === null ? [] : [bucket.estimatedCostMicrousd]
  );
  const today = new Date().toISOString().slice(0, 10);
  const todayBucket = buckets.find((bucket) => bucket.date === today);
  const latestBucket = buckets.at(-1);
  return {
    buckets,
    coverage: input.coverage,
    observedAt: input.observedAt,
    pluginId,
    scope: input.scope,
    sourceId: input.sourceId,
    summary: {
      estimatedCostMicrousd:
        priced.length > 0
          ? priced.reduce((sum, value) => sum + value, 0)
          : null,
      latestDayTokens: latestBucket?.tokens.totalTokens ?? 0,
      periodTokens: buckets.reduce(
        (sum, bucket) => sum + bucket.tokens.totalTokens,
        0
      ),
      todayEstimatedCostMicrousd: todayBucket?.estimatedCostMicrousd ?? null,
    },
  };
}

export function createUsageDataService(options: {
  userDataDir: string;
}): UsageDataService {
  const store = versionedJsonStore<UsageDataState>({
    currentVersion: 1,
    defaults: { snapshots: {}, version: 1 },
    filePath: join(options.userDataDir, "usage-data.json"),
    migrations: [],
    schema: stateSchema,
  });
  function publish(
    pluginId: string,
    input: UsageDataPublishInput
  ): UsageDataSnapshot {
    assertPublishInput(input);
    const snapshot = buildSnapshot(pluginId, input);
    store.mutate((state) => ({
      ...state,
      snapshots: {
        ...state.snapshots,
        [snapshotKey(pluginId, input.sourceId, input.scope)]: snapshot,
      },
    }));
    return snapshot;
  }

  function read(
    pluginId: string,
    sourceId: string,
    scope: UsageDataScope
  ): UsageDataSnapshot | null {
    return (
      store.get().snapshots[snapshotKey(pluginId, sourceId, scope)] ?? null
    );
  }

  return {
    async init(): Promise<void> {
      await store.init();
    },
    flush: () => store.flush(),
    publish,
    read,
    createPluginFacade(pluginId, canPublish) {
      return {
        publish: async (input) => {
          if (!canPublish)
            throw new Error("Plugin lacks usage:publish permission");
          return publish(pluginId, input);
        },
        read: async (sourceId, scope) => read(pluginId, sourceId, scope),
      };
    },
  };
}
