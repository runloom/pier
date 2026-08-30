import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentHookEventPayload,
  AgentHookEventPayloadV1,
} from "@shared/contracts/agent/session.ts";
import type { AgentActivity } from "@shared/contracts/foreground-activity.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGrokTranscriptReconciler } from "../../../../../src/main/services/agents/integrations/transcript/grok-reconciler.ts";
import { createForegroundActivityAggregator } from "../../../../../src/main/services/foreground-activity/aggregator.ts";
import type { AgentEventIngestOptions } from "../../../../../src/main/services/foreground-activity/types.ts";

const P1 = "aaaaaaaa-bbbb-4ccc-8ddd-111111111111";
const P2 = "aaaaaaaa-bbbb-4ccc-8ddd-222222222222";

const HOOK: AgentEventIngestOptions = {
  evidenceSource: "hook",
  stopAuthority: "advisory",
  turnStartAuthority: "authoritative",
};

const TRANSCRIPT: AgentEventIngestOptions = {
  evidenceSource: "transcript",
  stopAuthority: "authoritative",
  turnStartAuthority: "none",
};

function hookEvent(
  overrides: Partial<AgentHookEventPayloadV1> = {}
): AgentHookEventPayload {
  return {
    agent: "grok",
    event: "PromptSubmit",
    kind: "agentEvent",
    panelId: "panel-1",
    sessionId: "session-1",
    turnId: P1,
    v: 1,
    windowId: "1",
    ...overrides,
  };
}

function turnCompletedLine(promptId: string): string {
  return `${JSON.stringify({
    method: "_x.ai/session/update",
    params: {
      sessionId: "session-1",
      update: {
        prompt_id: promptId,
        sessionUpdate: "turn_completed",
        stop_reason: "end_turn",
      },
    },
  })}\n`;
}

describe("grok transcript turn identity", () => {
  let dir: string;
  let sessionsRoot: string;
  let updatesPath: string;

  beforeEach(async () => {
    vi.useRealTimers();
    dir = await mkdtemp(join(tmpdir(), "pier-grok-turn-id-"));
    sessionsRoot = join(dir, "sessions");
    const sessionDir = join(sessionsRoot, "encoded-cwd", "session-1");
    await mkdir(sessionDir, { recursive: true });
    updatesPath = join(sessionDir, "updates.jsonl");
    writeFileSync(updatesPath, '{"method":"session/update","params":{}}\n');
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it("P1 终态迟到到 P2 PromptSubmit 之后仍锚回 P1，不继承 P2", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createGrokTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      sessionsRoot,
    });
    await reconciler.observe(hookEvent({ turnId: P1 }));
    await reconciler.observe(hookEvent({ turnId: P2 }));
    appendFileSync(updatesPath, turnCompletedLine(P1));

    await vi.waitFor(() => {
      expect(received.some((event) => event.event === "TurnCompleted")).toBe(
        true
      );
    });
    const completed = received.filter(
      (event) => event.event === "TurnCompleted"
    );
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ turnId: P1 });
    reconciler.dispose();
  });

  it("从未观察过的 P1 终态不得借 P2 owner 封账", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createGrokTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      sessionsRoot,
    });
    await reconciler.observe(hookEvent({ turnId: P2 }));
    appendFileSync(updatesPath, turnCompletedLine(P1));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(received).toHaveLength(0);
    reconciler.dispose();
  });

  it("迟到 P1 终态不得把已开的 P2 封成 ready", async () => {
    const aggregator = createForegroundActivityAggregator();
    const reconciler = createGrokTranscriptReconciler({
      onTerminalEvent: (event) => {
        aggregator.ingestAgentEvent(event, TRANSCRIPT);
      },
      sessionsRoot,
    });
    aggregator.ingestAgentEvent(hookEvent({ turnId: P1 }), HOOK);
    await reconciler.observe(hookEvent({ turnId: P1 }));
    aggregator.ingestAgentEvent(hookEvent({ turnId: P2 }), HOOK);
    await reconciler.observe(hookEvent({ turnId: P2 }));
    appendFileSync(updatesPath, turnCompletedLine(P1));
    await new Promise((resolve) => setTimeout(resolve, 400));
    const activity = aggregator.snapshot().activities[0] as
      | AgentActivity
      | undefined;
    expect(activity?.status).toBe("processing");
    reconciler.dispose();
    aggregator.dispose();
  });
});
