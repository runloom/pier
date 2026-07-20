import { describe, expect, it } from "vitest";
import {
  sortUsageWindows,
  usageWindowLabel,
} from "../../../packages/plugin-claude/src/renderer/usage-meter.tsx";
import type { ClaudeUsageWindow } from "../../../packages/plugin-claude/src/shared/accounts.ts";

const t = (_key: string, fallback: string) => fallback;

function window(
  limitId: string,
  overrides: Partial<ClaudeUsageWindow> = {}
): ClaudeUsageWindow {
  return {
    id: `claude:${limitId}`,
    limitId,
    usedPercent: 10,
    ...overrides,
  };
}

describe("Claude usage meter helpers", () => {
  it("labels the fixed Claude quota buckets", () => {
    expect(usageWindowLabel(window("session"), t)).toBe("Current session (5h)");
    expect(usageWindowLabel(window("weekly"), t)).toBe("Weekly limit");
    expect(
      usageWindowLabel(window("weekly:opus", { limitName: "Opus" }), t)
    ).toBe("Opus · Weekly");
    expect(usageWindowLabel(window("custom", { limitName: "Custom" }), t)).toBe(
      "Custom"
    );
  });

  it("sorts session first, then weekly, then per-model in API order", () => {
    const sorted = sortUsageWindows([
      window("weekly:sonnet", { limitName: "Sonnet" }),
      window("weekly"),
      window("session"),
      window("weekly:opus", { limitName: "Opus" }),
    ]);
    expect(sorted.map((w) => w.limitId)).toEqual([
      "session",
      "weekly",
      "weekly:sonnet",
      "weekly:opus",
    ]);
  });
});
