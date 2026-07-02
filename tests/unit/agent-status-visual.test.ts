import { describe, expect, it } from "vitest";
import {
  agentStatusTextKey,
  longRunLevel,
  shimmerTiers,
  shouldShimmer,
  statusColorVar,
} from "../../src/renderer/panel-kits/terminal/agent-status-visual.ts";

describe("longRunLevel (loomdesk 长跑警示)", () => {
  it("< 5min → null", () => {
    expect(longRunLevel(4 * 60 * 1000)).toBeNull();
  });
  it(">= 5min → warn", () => {
    expect(longRunLevel(5 * 60 * 1000)).toBe("warn");
  });
  it(">= 30min → danger", () => {
    expect(longRunLevel(30 * 60 * 1000)).toBe("danger");
  });
});

describe("agentStatusTextKey (loomdesk 五态文案, ready 可见)", () => {
  it.each([
    ["processing", "terminal.agentStatus.processing"],
    ["tool", "terminal.agentStatus.tool"],
    ["waiting", "terminal.agentStatus.waiting"],
    ["ready", "terminal.agentStatus.ready"],
    ["error", "terminal.agentStatus.error"],
  ] as const)("%s → %s", (status, key) => {
    expect(agentStatusTextKey(status)).toBe(key);
  });
});

describe("shouldShimmer (loomdesk SHIMMERING_AGENT_STATUSES)", () => {
  it("仅 processing/tool", () => {
    expect(shouldShimmer("processing")).toBe(true);
    expect(shouldShimmer("tool")).toBe(true);
    expect(shouldShimmer("waiting")).toBe(false);
    expect(shouldShimmer("ready")).toBe(false);
    expect(shouldShimmer("error")).toBe(false);
  });
});

describe("statusColorVar (loomdesk AGENT_STATUS_PULSE + 长跑覆盖)", () => {
  it.each([
    ["processing", null, "--primary"],
    ["tool", null, "--primary"],
    ["waiting", null, "--color-amber-500"],
    ["ready", null, "--foreground"],
    ["error", null, "--destructive"],
  ] as const)("%s (level=%s) → %s", (status, level, cssVar) => {
    expect(statusColorVar(status, level)).toBe(cssVar);
  });

  it("长跑覆盖只作用于 running 态", () => {
    expect(statusColorVar("processing", "warn")).toBe("--color-amber-500");
    expect(statusColorVar("tool", "danger")).toBe("--destructive");
    // 非 running 态不受长跑影响（调用方本就不会传 level, 防御性断言）
    expect(statusColorVar("waiting", "danger")).toBe("--color-amber-500");
    expect(statusColorVar("error", "warn")).toBe("--destructive");
  });
});

describe("shimmerTiers (OMP classic 扫带逐字符 tier)", () => {
  it("空文本 → 空数组", () => {
    expect(shimmerTiers("", 0)).toEqual([]);
  });

  it("tier 数与 codepoint 数一致（含多字节字符）", () => {
    expect(shimmerTiers("思考中", 0)).toHaveLength(3);
    expect(shimmerTiers("Thinking", 500)).toHaveLength(8);
  });

  it("elapsed=0 时扫带在左侧 padding 区, 全部 low", () => {
    for (const tier of shimmerTiers("Thinking", 0)) {
      expect(tier).toBe("low");
    }
  });

  it("扫带中心对准首字符时该字符为 high", () => {
    // "Thinking" len=8: scale=8/12, padding=10*8/12=20/3, period=8+40/3=64/3
    // naturalCycle=(64/3)/30*1000≈711ms → cycle=max(1000, 711)=1000ms
    // pos=padding 需 elapsed = padding/period*cycle = (20/3)/(64/3)*1000 = 312.5ms
    const tiers = shimmerTiers("Thinking", 312.5);
    expect(tiers[0]).toBe("high");
  });

  it("周期结束回卷（elapsed=cycle 与 elapsed=0 相同）", () => {
    expect(shimmerTiers("Thinking", 1000)).toEqual(shimmerTiers("Thinking", 0));
  });

  it("负 elapsed 按 0 处理", () => {
    expect(shimmerTiers("Thinking", -50)).toEqual(shimmerTiers("Thinking", 0));
  });
});
