import { describe, expect, it } from "vitest";
import {
  agentStatusTextKey,
  longRunLevel,
  shouldShimmer,
  statusColorVar,
} from "../../src/renderer/components/agent-status/agent-status-visual.ts";

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
    ["processing", null, "--status-info-fg"],
    ["tool", null, "--status-done-fg"],
    ["waiting", null, "--status-warning-fg"],
    ["ready", null, "--foreground"],
    ["error", null, "--status-danger-fg"],
  ] as const)("%s (level=%s) → %s", (status, level, cssVar) => {
    expect(statusColorVar(status, level)).toBe(cssVar);
  });

  it("长跑覆盖只作用于 running 态", () => {
    expect(statusColorVar("processing", "warn")).toBe("--status-warning-fg");
    expect(statusColorVar("tool", "danger")).toBe("--status-danger-fg");
    // 非 running 态不受长跑影响（调用方本就不会传 level, 防御性断言）
    expect(statusColorVar("waiting", "danger")).toBe("--status-warning-fg");
    expect(statusColorVar("error", "warn")).toBe("--status-danger-fg");
  });
});
