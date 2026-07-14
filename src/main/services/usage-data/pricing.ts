import type { UsageTokenObservation } from "@pier/plugin-api/main";
import catalog from "./pricing-catalog.json" with { type: "json" };

export interface ModelPricing {
  cachedInputMicrousd: number;
  inputMicrousd: number;
  longContext?: ModelPricing & { threshold: number };
  outputMicrousd: number;
  priority?: ModelPricing;
}

interface CatalogEntry extends ModelPricing {
  aliases?: string[];
}

// API 等价成本估算目录（`pricing-catalog.json` 的宿主快照）。费率单位为每 token 的微美元，集中在宿主持有，
// 数据采集插件只发布原始 token，避免各插件产生不可聚合的金额口径。
const MODEL_PRICING: Readonly<Record<string, CatalogEntry>> = (
  catalog as { models: Record<string, CatalogEntry> }
).models;

// 别名解析辅助表：精确别名 → 直接命中；`foo-*` 通配转成前缀（去掉尾部 `*`）。
const EXACT_ALIASES = new Map<string, string>();
const WILDCARD_ALIASES: { prefix: string; modelId: string }[] = [];
for (const [modelId, entry] of Object.entries(MODEL_PRICING)) {
  for (const alias of entry.aliases ?? []) {
    const lower = alias.toLowerCase();
    if (lower.endsWith("-*")) {
      WILDCARD_ALIASES.push({ modelId, prefix: lower.slice(0, -1) });
    } else {
      EXACT_ALIASES.set(lower, modelId);
    }
  }
}

function normalizedModelId(modelId: string): string {
  return modelId
    .trim()
    .toLowerCase()
    .replace(/-(latest|\d{4}-\d{2}-\d{2})$/, "");
}

function resolvePricing(modelId: string): ModelPricing | null {
  const exact = modelId.trim().toLowerCase();
  const direct = MODEL_PRICING[exact];
  if (direct) return direct;
  const exactAlias = EXACT_ALIASES.get(exact);
  if (exactAlias) return MODEL_PRICING[exactAlias] ?? null;
  const normalized = normalizedModelId(exact);
  const normalizedDirect = MODEL_PRICING[normalized];
  if (normalizedDirect) return normalizedDirect;
  const aliased = EXACT_ALIASES.get(normalized);
  if (aliased) return MODEL_PRICING[aliased] ?? null;
  // 最长前缀通配匹配：`foo-bar-*` 优先于 `foo-*`。
  let best: { modelId: string; length: number } | null = null;
  for (const entry of WILDCARD_ALIASES) {
    if (
      (exact.startsWith(entry.prefix) || normalized.startsWith(entry.prefix)) &&
      (best === null || entry.prefix.length > best.length)
    ) {
      best = { length: entry.prefix.length, modelId: entry.modelId };
    }
  }
  return best ? (MODEL_PRICING[best.modelId] ?? null) : null;
}

export function estimateObservationCostMicrousd(
  observation: UsageTokenObservation
): number | null {
  if (!observation.modelId) return null;
  const basePricing = resolvePricing(observation.modelId);
  if (!basePricing) return null;
  let pricing: ModelPricing = basePricing;
  if (
    observation.serviceTier?.toLowerCase() === "priority" &&
    basePricing.priority
  ) {
    pricing = basePricing.priority;
  } else if (
    basePricing.longContext &&
    observation.inputTokens > basePricing.longContext.threshold
  ) {
    pricing = basePricing.longContext;
  }
  const cached = Math.min(
    observation.inputTokens,
    observation.cachedInputTokens
  );
  const nonCached = Math.max(0, observation.inputTokens - cached);
  return Math.round(
    nonCached * pricing.inputMicrousd +
      cached * pricing.cachedInputMicrousd +
      observation.outputTokens * pricing.outputMicrousd
  );
}
