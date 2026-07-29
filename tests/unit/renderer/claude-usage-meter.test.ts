import type { AccountUsageQuotaMetric } from "@pier/plugin-api/account-usage";
import { describe, expect, it } from "vitest";
import { usageMetricLabel } from "../../../packages/plugin-claude/src/renderer/usage-meter.tsx";

const t = (_key: string, fallback: string) => fallback;

function quota(groupId: string, name?: string): AccountUsageQuotaMetric {
  return {
    groupId,
    id: groupId,
    kind: "quota",
    usedPercent: 10,
    ...(name ? { name } : {}),
  };
}

describe("Claude usage metric labels", () => {
  it("labels known and future quota buckets", () => {
    expect(usageMetricLabel(quota("claude:session"), t)).toBe(
      "Current session (5h)"
    );
    expect(usageMetricLabel(quota("claude:weekly"), t)).toBe("Weekly limit");
    expect(usageMetricLabel(quota("claude:weekly:opus", "Opus"), t)).toBe(
      "Opus · Weekly"
    );
    expect(
      usageMetricLabel(quota("claude:monthly-next", "Claude Next"), t)
    ).toBe("Claude Next");
  });
});
