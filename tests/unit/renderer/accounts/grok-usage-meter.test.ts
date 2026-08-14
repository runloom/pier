import type { AccountUsageMetric } from "@pier/plugin-api/account-usage";
import { describe, expect, it } from "vitest";
import { usageMetricLabel } from "../../../../packages/plugin-grok/src/renderer/usage-meter.tsx";

const t = (_key: string, fallback: string) => fallback;

describe("Grok usage metric labels", () => {
  it("labels official remaining-reset credits like Codex quota resets", () => {
    const metric: AccountUsageMetric = {
      format: "count",
      id: "grok:reset-credits",
      kind: "scalar",
      value: 2,
    };
    expect(usageMetricLabel(metric, "en", t)).toBe("Quota resets");
  });
});
