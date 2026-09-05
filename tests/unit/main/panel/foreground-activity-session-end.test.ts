import { createForegroundActivityAggregator } from "@main/services/foreground-activity/aggregator.ts";
import type { AgentHookEventPayloadV3 } from "@shared/contracts/agent/session.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function event(
  kind: "SessionStart" | "PromptSubmit" | "SessionEnd",
  sessionId: string
): AgentHookEventPayloadV3 {
  return {
    agent: "codex",
    event: kind,
    kind: "agentEvent",
    nativeEvent: kind,
    panelId: "terminal-1",
    sessionId,
    spawnGeneration: 1,
    tty: "ttys004",
    v: 3,
    windowId: "1",
  };
}

const options = {
  evidenceSource: "hook",
  stopAuthority: "advisory",
  turnStartAuthority: "none",
} as const;

describe("agent session end while the terminal process is alive", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([
    "launcher",
    "shell command",
  ])("keeps the %s agent usable until the process exits", (source) => {
    const aggregator = createForegroundActivityAggregator();
    try {
      if (source === "launcher") {
        aggregator.agentLaunched("1", "terminal-1", "codex");
      } else {
        aggregator.ingestCommandStarted("terminal-1", "1", "codex", "codex");
      }
      vi.advanceTimersByTime(250);
      aggregator.ingestAgentEvent(event("SessionStart", "old"), options);
      aggregator.ingestAgentEvent(event("PromptSubmit", "old"), options);
      aggregator.ingestAgentEvent(event("SessionEnd", "old"), options);

      expect(aggregator.snapshot().activities).toEqual([
        expect.objectContaining({
          agentId: "codex",
          kind: "agent",
          panelId: "terminal-1",
          source: "launch",
          subagentCount: 0,
        }),
      ]);
      expect(aggregator.snapshot().activities[0]).not.toHaveProperty("status");
      expect(aggregator.snapshot().activities[0]).not.toHaveProperty(
        "sessionId"
      );
      expect(aggregator.panelCommandOwnedAgent("terminal-1", "1")).toBe(
        "codex"
      );
      expect(aggregator.hasAgentPresence("terminal-1", "1")).toBe(true);

      // A new conversation in the same CLI must not wait for the old cooldown.
      aggregator.ingestAgentEvent(event("SessionStart", "new"), options);
      aggregator.ingestAgentEvent(event("PromptSubmit", "new"), options);
      expect(aggregator.snapshot().activities[0]).toMatchObject({
        kind: "agent",
        sessionId: "new",
        source: "hook",
        status: "processing",
      });

      aggregator.ptyExited("terminal-1", "1");
      expect(aggregator.snapshot().activities).toEqual([]);
      expect(aggregator.hasAgentPresence("terminal-1", "1")).toBe(false);
    } finally {
      aggregator.dispose();
    }
  });

  it("clears the remaining command after the conversation ends and the command exits", () => {
    const aggregator = createForegroundActivityAggregator();
    try {
      aggregator.agentLaunched("1", "terminal-1", "codex");
      vi.advanceTimersByTime(250);
      aggregator.ingestAgentEvent(event("PromptSubmit", "old"), options);
      aggregator.ingestAgentEvent(event("SessionEnd", "old"), options);
      expect(aggregator.hasAgentPresence("terminal-1", "1")).toBe(true);

      aggregator.ingestCommandFinished("terminal-1", 0, "1");
      expect(aggregator.snapshot().activities).toEqual([]);
      expect(aggregator.hasAgentPresence("terminal-1", "1")).toBe(false);
    } finally {
      aggregator.dispose();
    }
  });
});
