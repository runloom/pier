import type { UsageTokenObservation } from "@pier/plugin-api/main";

interface ModelPricing {
  cachedInputMicrousd: number;
  inputMicrousd: number;
  longContext?: ModelPricing & { threshold: number };
  outputMicrousd: number;
  priority?: ModelPricing;
}

// API 等价成本估算目录。费率单位为每 token 的微美元，集中在宿主持有，
// 数据采集插件只发布原始 token，避免各插件产生不可聚合的金额口径。
const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  "gpt-5": {
    cachedInputMicrousd: 0.125,
    inputMicrousd: 1.25,
    outputMicrousd: 10,
  },
  "gpt-5-codex": {
    cachedInputMicrousd: 0.125,
    inputMicrousd: 1.25,
    outputMicrousd: 10,
  },
  "gpt-5-mini": {
    cachedInputMicrousd: 0.025,
    inputMicrousd: 0.25,
    outputMicrousd: 2,
  },
  "gpt-5.1": {
    cachedInputMicrousd: 0.125,
    inputMicrousd: 1.25,
    outputMicrousd: 10,
  },
  "gpt-5.1-codex": {
    cachedInputMicrousd: 0.125,
    inputMicrousd: 1.25,
    outputMicrousd: 10,
  },
  "gpt-5.1-codex-mini": {
    cachedInputMicrousd: 0.025,
    inputMicrousd: 0.25,
    outputMicrousd: 2,
  },
  "gpt-5.2": {
    cachedInputMicrousd: 0.175,
    inputMicrousd: 1.75,
    outputMicrousd: 14,
  },
  "gpt-5.2-codex": {
    cachedInputMicrousd: 0.175,
    inputMicrousd: 1.75,
    outputMicrousd: 14,
  },
  "gpt-5.3-codex": {
    cachedInputMicrousd: 0.175,
    inputMicrousd: 1.75,
    outputMicrousd: 14,
  },
  "gpt-5.3-codex-spark": {
    cachedInputMicrousd: 0,
    inputMicrousd: 0,
    outputMicrousd: 0,
  },
  "gpt-5.4": {
    cachedInputMicrousd: 0.25,
    inputMicrousd: 2.5,
    longContext: {
      cachedInputMicrousd: 0.5,
      inputMicrousd: 5,
      outputMicrousd: 22.5,
      threshold: 272_000,
    },
    outputMicrousd: 15,
    priority: {
      cachedInputMicrousd: 0.5,
      inputMicrousd: 5,
      outputMicrousd: 30,
    },
  },
  "gpt-5.4-mini": {
    cachedInputMicrousd: 0.075,
    inputMicrousd: 0.75,
    outputMicrousd: 4.5,
    priority: {
      cachedInputMicrousd: 0.15,
      inputMicrousd: 1.5,
      outputMicrousd: 9,
    },
  },
  "gpt-5.4-nano": {
    cachedInputMicrousd: 0.02,
    inputMicrousd: 0.2,
    outputMicrousd: 1.25,
  },
  "gpt-5.4-pro": {
    cachedInputMicrousd: 30,
    inputMicrousd: 30,
    outputMicrousd: 180,
  },
  "gpt-5.5": {
    cachedInputMicrousd: 0.5,
    inputMicrousd: 5,
    longContext: {
      cachedInputMicrousd: 1,
      inputMicrousd: 10,
      outputMicrousd: 45,
      threshold: 272_000,
    },
    outputMicrousd: 30,
    priority: {
      cachedInputMicrousd: 1.25,
      inputMicrousd: 12.5,
      outputMicrousd: 75,
    },
  },
  "gpt-5.5-pro": {
    cachedInputMicrousd: 30,
    inputMicrousd: 30,
    outputMicrousd: 180,
  },
};

function normalizedModelId(modelId: string): string {
  return modelId
    .trim()
    .toLowerCase()
    .replace(/-(latest|\d{4}-\d{2}-\d{2})$/, "");
}

export function estimateObservationCostMicrousd(
  observation: UsageTokenObservation
): number | null {
  if (!observation.modelId) return null;
  const basePricing = MODEL_PRICING[normalizedModelId(observation.modelId)];
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
