import { describe, expect, it } from "vitest";
import {
  agentStatusTextKey,
  shouldShimmer,
} from "../../../src/renderer/components/agent-status/visual.ts";

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
