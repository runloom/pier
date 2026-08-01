import catalog from "@main/services/usage-data/pricing-catalog.json" with {
  type: "json",
};
import { describe, expect, it } from "vitest";

interface ModelPricingLike {
  aliases?: string[];
  cachedInputMicrousd?: number;
  inputMicrousd?: number;
  longContext?: {
    cachedInputMicrousd?: number;
    inputMicrousd?: number;
    outputMicrousd?: number;
    threshold?: number;
  };
  outputMicrousd?: number;
  priority?: {
    cachedInputMicrousd?: number;
    inputMicrousd?: number;
    outputMicrousd?: number;
  };
}

const models = (catalog as { models: Record<string, ModelPricingLike> }).models;

/**
 * 保护 `update-model-pricing.mjs` 自动生成的 catalog 结构合法：
 * - 每条 entry 必须有 `inputMicrousd` / `cachedInputMicrousd` / `outputMicrousd`
 *   三个非负数字，否则 `estimateObservationCostMicrousd` 会算出 NaN。
 * - `longContext` / `priority` 分档若存在，同样字段完整。
 * - `aliases` 若存在，是纯字符串数组。
 * - `cachedInputMicrousd` 不应高于 `inputMicrousd`——违反业内所有厂商的定价惯例，
 *   多半是脚本 fallback 或 upstream typo。
 * - `-latest` 浮动别名不得成为目录键；日期版本允许独立存在以保存历史费率。
 */

function isPositiveOrZero(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

describe("pricing catalog schema", () => {
  it("catalog contains at least the well-known canonical vendors", () => {
    // 若某天 LiteLLM 结构大变或抓取失败，避免误 merge 空目录。
    const keys = Object.keys(models);
    expect(keys.length).toBeGreaterThanOrEqual(100);
    for (const required of [
      "gpt-5",
      "claude-sonnet-4-5",
      "gemini-2.5-pro",
      "deepseek-chat",
      "grok-4",
      "grok-4.5",
    ]) {
      expect(models[required], `catalog missing ${required}`).toBeDefined();
    }
  });

  it("every entry has non-negative numeric prices", () => {
    for (const [id, pricing] of Object.entries(models)) {
      expect(
        isPositiveOrZero(pricing.inputMicrousd),
        `${id}.inputMicrousd`
      ).toBe(true);
      expect(
        isPositiveOrZero(pricing.outputMicrousd),
        `${id}.outputMicrousd`
      ).toBe(true);
      expect(
        isPositiveOrZero(pricing.cachedInputMicrousd),
        `${id}.cachedInputMicrousd`
      ).toBe(true);
    }
  });

  it("cache read price never exceeds standard input price", () => {
    for (const [id, pricing] of Object.entries(models)) {
      expect(
        pricing.cachedInputMicrousd! <= pricing.inputMicrousd!,
        `${id}: cachedInput (${pricing.cachedInputMicrousd}) > input (${pricing.inputMicrousd})`
      ).toBe(true);
    }
  });

  it("longContext and priority tiers, when present, are structurally valid", () => {
    for (const [id, pricing] of Object.entries(models)) {
      if (pricing.longContext) {
        const lc = pricing.longContext;
        expect(
          isPositiveOrZero(lc.inputMicrousd),
          `${id}.longContext.input`
        ).toBe(true);
        expect(
          isPositiveOrZero(lc.outputMicrousd),
          `${id}.longContext.output`
        ).toBe(true);
        expect(
          isPositiveOrZero(lc.cachedInputMicrousd),
          `${id}.longContext.cachedInput`
        ).toBe(true);
        expect(typeof lc.threshold === "number" && lc.threshold > 0).toBe(true);
      }
      if (pricing.priority) {
        const p = pricing.priority;
        expect(isPositiveOrZero(p.inputMicrousd), `${id}.priority.input`).toBe(
          true
        );
        expect(
          isPositiveOrZero(p.outputMicrousd),
          `${id}.priority.output`
        ).toBe(true);
      }
    }
  });

  it("aliases are non-empty string arrays when present", () => {
    for (const [id, pricing] of Object.entries(models)) {
      if (pricing.aliases === undefined) continue;
      expect(Array.isArray(pricing.aliases), `${id}.aliases`).toBe(true);
      for (const alias of pricing.aliases) {
        expect(typeof alias === "string" && alias.length > 0).toBe(true);
      }
    }
  });

  it("catalog keys do not persist floating latest aliases", () => {
    for (const id of Object.keys(models)) {
      expect(id.toLowerCase().endsWith("-latest"), `${id} is floating`).toBe(
        false
      );
    }
  });
});
