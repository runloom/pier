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
import {
  type UsageAggregateSnapshot,
  type UsageAggregateSource,
  usageDataCoverageSchema,
  usageDataDailyBucketSchema,
  usageDataScopeSchema,
  usageModelBreakdownSchema,
} from "@shared/contracts/usage-data.ts";
import { z } from "zod";
import { versionedJsonStore } from "../../state/versioned-store.ts";
import { aggregateSnapshots } from "./aggregator.ts";
import { estimateObservationCostMicrousd } from "./pricing.ts";
import {
  createUsageSourceRegistry,
  type UsageSource,
  type UsageSourceRegistry,
} from "./source-registry.ts";

/**
 * 宿主自身作为 usage-data 源时使用的保留 pluginId。UI 视角为"pier 主项目内置
 * 采集"，不与任何 managed external plugin 命名冲突。built-in collector（如
 * `collectors/codex-local`）通过 `publishBuiltIn` / `registerBuiltInSource`
 * 走这个身份写入。
 */
export const HOST_BUILTIN_PLUGIN_ID = "pier.core";
const LEGACY_CODEX_PLUGIN_ID = "pier.codex";
const CODEX_LOCAL_USAGE_SOURCE_ID = "codex-local-sessions";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_OBSERVATIONS = 250_000;

// summary 单独定义：byModel 需要 `.default([])` 兜底老快照缺失字段，
// shared canonical schema 不带 default（renderer 侧不做迁移）。
const persistedSummarySchema = z.object({
  byModel: z.array(usageModelBreakdownSchema).default([]),
  estimatedCostMicrousd: z.number().int().nonnegative().nullable(),
  latestDayTokens: z.number().int().nonnegative(),
  periodTokens: z.number().int().nonnegative(),
  todayEstimatedCostMicrousd: z.number().int().nonnegative().nullable(),
});
const snapshotSchema = z.object({
  buckets: z.array(usageDataDailyBucketSchema),
  coverage: usageDataCoverageSchema,
  observedAt: z.number().int().nonnegative(),
  pluginId: z.string().min(1),
  scope: usageDataScopeSchema,
  sourceId: z.string().min(1).max(100),
  summary: persistedSummarySchema,
});
const stateSchema = z.object({
  snapshots: z.record(z.string(), snapshotSchema),
  version: z.literal(1),
});
type UsageDataState = z.infer<typeof stateSchema>;

export type UsageAggregateListener = (snapshot: UsageAggregateSnapshot) => void;

export interface UsageDataService {
  aggregate(): UsageAggregateSnapshot;
  /** 删除宿主采集器此前持久化的快照；扫描为空时用于避免残留过期数据。 */
  clearBuiltIn(sourceId: string, scope: UsageDataScope): boolean;
  createPluginFacade(
    pluginId: string,
    canPublish: boolean
  ): MainPluginUsageData;
  flush(): Promise<void>;
  init(): Promise<void>;
  publish(pluginId: string, input: UsageDataPublishInput): UsageDataSnapshot;
  /**
   * 宿主内置采集器 publish 快捷入口。等价于 `publish(HOST_BUILTIN_PLUGIN_ID, input)`。
   */
  publishBuiltIn(input: UsageDataPublishInput): UsageDataSnapshot;
  read(
    pluginId: string,
    sourceId: string,
    scope: UsageDataScope
  ): UsageDataSnapshot | null;
  /**
   * 触发全部注册源的 rescan（fan-out），随后 aggregate + 广播。
   * 单源失败不短路其他源；结束后若有失败取第一条抛出。
   */
  refreshAll(): Promise<void>;
  /**
   * 注册宿主内置采集源（built-in collector）。source.id 会被作用域为
   * `${HOST_BUILTIN_PLUGIN_ID}/${id}`，避免与插件命名冲突。返回 dispose。
   */
  registerBuiltInSource(source: UsageSource): () => void;
  subscribe(listener: UsageAggregateListener): () => void;
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
      observation.eventId !== undefined &&
      (observation.eventId.length === 0 || observation.eventId.length > 500)
    ) {
      throw new Error("Invalid usage event id");
    }
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

interface CostAccumulator {
  hasPriced: boolean;
  hasUnpriced: boolean;
  pricedSum: number;
}

function accumulateCost(acc: CostAccumulator, cost: number | null): void {
  if (cost === null) {
    acc.hasUnpriced = true;
  } else {
    acc.pricedSum += cost;
    acc.hasPriced = true;
  }
}

function pricingStatusOf(
  acc: CostAccumulator
): UsageDataDailyBucket["pricingStatus"] {
  if (!acc.hasUnpriced) return "complete";
  if (acc.hasPriced) return "partial";
  return "unpriced";
}

function pricedTotal(acc: CostAccumulator): number | null {
  return acc.hasPriced ? acc.pricedSum : null;
}

interface BuildRollup {
  buckets: UsageDataDailyBucket[];
  byModel: readonly {
    estimatedCostMicrousd: number | null;
    modelId: string;
    totalTokens: number;
  }[];
}

function observationTotalTokens(observation: UsageTokenObservation): number {
  return (
    observation.totalTokens ??
    observation.inputTokens + observation.outputTokens
  );
}

function buildRollup(observations: UsageTokenObservation[]): BuildRollup {
  const byDate = new Map<
    string,
    { cost: CostAccumulator; totals: UsageTokenTotals }
  >();
  const byModel = new Map<
    string,
    { cost: CostAccumulator; totalTokens: number }
  >();
  for (const observation of observations) {
    const totalTokens = observationTotalTokens(observation);
    const cost = estimateObservationCostMicrousd(observation);

    const dateRow = byDate.get(observation.date) ?? {
      cost: { hasPriced: false, hasUnpriced: false, pricedSum: 0 },
      totals: emptyTotals(),
    };
    dateRow.totals.inputTokens += observation.inputTokens;
    dateRow.totals.cachedInputTokens += observation.cachedInputTokens;
    dateRow.totals.outputTokens += observation.outputTokens;
    dateRow.totals.reasoningTokens += observation.reasoningTokens ?? 0;
    dateRow.totals.totalTokens += totalTokens;
    accumulateCost(dateRow.cost, cost);
    byDate.set(observation.date, dateRow);

    const modelKey = observation.modelId ?? "";
    const modelRow = byModel.get(modelKey) ?? {
      cost: { hasPriced: false, hasUnpriced: false, pricedSum: 0 },
      totalTokens: 0,
    };
    modelRow.totalTokens += totalTokens;
    accumulateCost(modelRow.cost, cost);
    byModel.set(modelKey, modelRow);
  }
  const buckets = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, row]) => ({
      date,
      estimatedCostMicrousd: pricedTotal(row.cost),
      pricingStatus: pricingStatusOf(row.cost),
      tokens: row.totals,
    }));
  const modelSummary = [...byModel.entries()].map(([modelId, row]) => ({
    estimatedCostMicrousd: pricedTotal(row.cost),
    modelId,
    totalTokens: row.totalTokens,
  }));
  return { buckets, byModel: modelSummary };
}

function buildSnapshot(
  pluginId: string,
  input: UsageDataPublishInput
): UsageDataSnapshot {
  const rollup = buildRollup(input.observations);
  const { buckets } = rollup;
  // 一次遍历同时算周期 tokens 与已定价成本总额。
  const totals: CostAccumulator = {
    hasPriced: false,
    hasUnpriced: false,
    pricedSum: 0,
  };
  let periodTokens = 0;
  for (const bucket of buckets) {
    periodTokens += bucket.tokens.totalTokens;
    accumulateCost(totals, bucket.estimatedCostMicrousd);
  }
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
      // rollup 内部用 readonly 契约保护聚合器边界；对外 DTO 需要可变数组。
      byModel: [...rollup.byModel],
      estimatedCostMicrousd: pricedTotal(totals),
      latestDayTokens: latestBucket?.tokens.totalTokens ?? 0,
      periodTokens,
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
  const listeners = new Set<UsageAggregateListener>();
  const sources: UsageSourceRegistry = createUsageSourceRegistry();

  function collectSources(): UsageAggregateSource[] {
    return Object.values(store.get().snapshots).map((snapshot) => ({
      pluginId: snapshot.pluginId,
      scope: snapshot.scope,
      snapshot,
      sourceId: snapshot.sourceId,
    }));
  }

  function aggregate(): UsageAggregateSnapshot {
    return aggregateSnapshots(collectSources());
  }

  function notify(): void {
    if (listeners.size === 0) return;
    const snapshot = aggregate();
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        // 不允许单个订阅者影响其他订阅者
      }
    }
  }

  function publish(
    pluginId: string,
    input: UsageDataPublishInput
  ): UsageDataSnapshot {
    assertPublishInput(input);
    // Host owns Codex CLI session scanning. Older pier.codex builds still
    // publish the same `codex-local-sessions` stream under pier.codex — fold
    // those writes onto the host key so aggregate never double-counts.
    const effectivePluginId =
      pluginId === LEGACY_CODEX_PLUGIN_ID &&
      input.sourceId === CODEX_LOCAL_USAGE_SOURCE_ID
        ? HOST_BUILTIN_PLUGIN_ID
        : pluginId;
    const snapshot = buildSnapshot(effectivePluginId, input);
    store.mutate((state) => {
      const snapshots = { ...state.snapshots };
      if (
        effectivePluginId === HOST_BUILTIN_PLUGIN_ID &&
        input.sourceId === CODEX_LOCAL_USAGE_SOURCE_ID
      ) {
        delete snapshots[
          snapshotKey(
            LEGACY_CODEX_PLUGIN_ID,
            CODEX_LOCAL_USAGE_SOURCE_ID,
            input.scope
          )
        ];
      }
      snapshots[snapshotKey(effectivePluginId, input.sourceId, input.scope)] =
        snapshot;
      return { ...state, snapshots };
    });
    notify();
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

  function clearBuiltIn(sourceId: string, scope: UsageDataScope): boolean {
    const key = snapshotKey(HOST_BUILTIN_PLUGIN_ID, sourceId, scope);
    if (!store.get().snapshots[key]) return false;
    store.mutate((state) => {
      const snapshots = { ...state.snapshots };
      delete snapshots[key];
      return { ...state, snapshots };
    });
    notify();
    return true;
  }

  return {
    async init(): Promise<void> {
      await store.init();
      const machineScope = { kind: "machine" } as const;
      const legacyKey = snapshotKey(
        LEGACY_CODEX_PLUGIN_ID,
        CODEX_LOCAL_USAGE_SOURCE_ID,
        machineScope
      );
      const hostKey = snapshotKey(
        HOST_BUILTIN_PLUGIN_ID,
        CODEX_LOCAL_USAGE_SOURCE_ID,
        machineScope
      );
      const legacy = store.get().snapshots[legacyKey];
      if (legacy) {
        store.mutate((state) => {
          const snapshots = { ...state.snapshots };
          if (!snapshots[hostKey]) {
            snapshots[hostKey] = {
              ...legacy,
              pluginId: HOST_BUILTIN_PLUGIN_ID,
            };
          }
          delete snapshots[legacyKey];
          return { ...state, snapshots };
        });
        await store.flush();
      }
    },
    aggregate,
    clearBuiltIn,
    flush: () => store.flush(),
    publish,
    publishBuiltIn: (input) => publish(HOST_BUILTIN_PLUGIN_ID, input),
    read,
    registerBuiltInSource: (source) =>
      sources.register({
        id: `${HOST_BUILTIN_PLUGIN_ID}/${source.id}`,
        rescan: () => source.rescan(),
      }),
    refreshAll: async () => {
      // fan-out 到全部注册源；单源失败不短路其他源。rescan 完成后总是
      // 补一次广播——即使无源，也让 renderer 的手动刷新链路可端到端观测。
      try {
        await sources.refreshAll();
      } finally {
        notify();
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    createPluginFacade(pluginId, canPublish) {
      return {
        publish: async (input) => {
          if (!canPublish)
            throw new Error("Plugin lacks usage:publish permission");
          return publish(pluginId, input);
        },
        read: async (sourceId, scope) => read(pluginId, sourceId, scope),
        registerSource: (source) =>
          sources.register({
            id: `${pluginId}/${source.id}`,
            rescan: () => source.rescan(),
          }),
      };
    },
  };
}
