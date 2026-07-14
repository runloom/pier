import { z } from "zod";

/**
 * Usage data — 跨源的 API 等价成本聚合契约。
 *
 * 数据流：宿主内置 collector（`src/main/services/usage-data/collectors/*`，
 * 如 `codex-local` 扫描 `~/.codex/sessions/*.jsonl`）或 managed external
 * plugin 发布 `UsageDataPublishInput`（原始 token 观测）
 *   → 宿主 `usage-data-service` 按 `(pluginId, sourceId, scope)` 分桶写盘 + 计价
 *   → `aggregator.aggregateSnapshots(...)` 合成 `UsageAggregateSnapshot`
 *   → 通过 `PIER_BROADCAST.USAGE_DATA_CHANGED` 广播给 renderer 镜像 store。
 *
 * 定价目录归宿主唯一持有（`src/main/services/usage-data/pricing-catalog.json`），
 * 上游源只发布原始 token，避免各源产生不可聚合的金额口径。宿主内置 collector
 * 使用保留 pluginId `pier.core`（`HOST_BUILTIN_PLUGIN_ID`），插件源使用自身
 * `manifest.id`。
 *
 * 与 `packages/plugin-api/src/main.ts` 的 DTO 结构等价，但独立定义于此以维持
 * renderer / main 的边界不依赖 plugin-api 包。
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const usageDataScopeSchema = z.union([
  z.object({ kind: z.literal("machine") }),
  z.object({ key: z.string().min(1).max(200), kind: z.literal("account") }),
]);
export type UsageDataScope = z.infer<typeof usageDataScopeSchema>;

export const usageTokenTotalsSchema = z.object({
  cachedInputTokens: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});
export type UsageTokenTotals = z.infer<typeof usageTokenTotalsSchema>;

export const usageDataPricingStatusSchema = z.enum([
  "complete",
  "partial",
  "unpriced",
]);
export type UsageDataPricingStatus = z.infer<
  typeof usageDataPricingStatusSchema
>;

export const usageDataDailyBucketSchema = z.object({
  date: z.string().regex(DATE_PATTERN),
  estimatedCostMicrousd: z.number().int().nonnegative().nullable(),
  pricingStatus: usageDataPricingStatusSchema,
  tokens: usageTokenTotalsSchema,
});
export type UsageDataDailyBucket = z.infer<typeof usageDataDailyBucketSchema>;

export const usageDataCoverageSchema = z.object({
  complete: z.boolean(),
  from: z.string().regex(DATE_PATTERN),
  to: z.string().regex(DATE_PATTERN),
});
export type UsageDataCoverage = z.infer<typeof usageDataCoverageSchema>;

export const usageModelBreakdownSchema = z.object({
  estimatedCostMicrousd: z.number().int().nonnegative().nullable(),
  modelId: z.string().max(200),
  totalTokens: z.number().int().nonnegative(),
});
export type UsageModelBreakdown = z.infer<typeof usageModelBreakdownSchema>;

export const usageDataSummarySchema = z.object({
  byModel: z.array(usageModelBreakdownSchema),
  estimatedCostMicrousd: z.number().int().nonnegative().nullable(),
  latestDayTokens: z.number().int().nonnegative(),
  periodTokens: z.number().int().nonnegative(),
  todayEstimatedCostMicrousd: z.number().int().nonnegative().nullable(),
});
export type UsageDataSummary = z.infer<typeof usageDataSummarySchema>;

export const usageDataSnapshotSchema = z.object({
  buckets: z.array(usageDataDailyBucketSchema),
  coverage: usageDataCoverageSchema,
  observedAt: z.number().int().nonnegative(),
  pluginId: z.string().min(1),
  scope: usageDataScopeSchema,
  sourceId: z.string().min(1).max(100),
  summary: usageDataSummarySchema,
});
export type UsageDataSnapshot = z.infer<typeof usageDataSnapshotSchema>;

export const usageAggregateSourceSchema = z.object({
  pluginId: z.string().min(1),
  scope: usageDataScopeSchema,
  snapshot: usageDataSnapshotSchema,
  sourceId: z.string().min(1).max(100),
});
export type UsageAggregateSource = z.infer<typeof usageAggregateSourceSchema>;

export const usageAggregateOverallSchema = z.object({
  buckets: z.array(usageDataDailyBucketSchema),
  coverage: usageDataCoverageSchema,
  observedAt: z.number().int().nonnegative(),
  summary: usageDataSummarySchema.extend({
    sourceCount: z.number().int().nonnegative(),
  }),
});
export type UsageAggregateOverall = z.infer<typeof usageAggregateOverallSchema>;

export const usageAggregateSnapshotSchema = z.object({
  overall: usageAggregateOverallSchema,
  sources: z.array(usageAggregateSourceSchema),
});
export type UsageAggregateSnapshot = z.infer<
  typeof usageAggregateSnapshotSchema
>;
