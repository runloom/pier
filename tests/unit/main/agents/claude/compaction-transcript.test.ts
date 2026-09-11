import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleObservedAgentHookEvent } from "@main/ipc/foreground-activity/hook-pipeline.ts";
import {
  CLAUDE_HOOK_EVENTS,
  claudeIntegration,
} from "@main/services/agents/integrations/claude.ts";
import { resolveAgentEventIngestOptions } from "@main/services/agents/integrations/runtime/event-authority.ts";
import { createClaudeTranscriptReconciler } from "@main/services/agents/integrations/transcript/claude-reconciler.ts";
import { createForegroundActivityAggregator } from "@main/services/foreground-activity/aggregator.ts";
import { enrichAgentEventFromRawPayload } from "@main/services/foreground-activity/jsonl-enrichment.ts";
import {
  type AgentHookEventPayload,
  agentHookEventSchema,
} from "@shared/contracts/agent/session.ts";
import { describe, expect, it, vi } from "vitest";
import { createNestedHookCommandProducer } from "../../../agent-integrations/status-traces/hook-command-driver.ts";

const TURN = "11111111-1111-4111-8111-111111111111";
const COMPACT = "22222222-2222-4222-8222-222222222222";
const NEXT = "33333333-3333-4333-8333-333333333333";
const COMPLETION = `${JSON.stringify({
  type: "assistant",
  isSidechain: false,
  message: {
    role: "assistant",
    stop_reason: "end_turn",
    content: [{ type: "text", text: "done" }],
  },
})}\n`;

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "pier-compact-transcript-"));
  const path = join(root, "main.jsonl");
  // Historical anonymous completions must stay behind the prompt watermark.
  await writeFile(path, COMPLETION);
  const producer = await createNestedHookCommandProducer(
    "claude",
    CLAUDE_HOOK_EVENTS
  );
  const aggregator = createForegroundActivityAggregator();
  aggregator.agentLaunched("w1", "p1", "claude");
  const received: AgentHookEventPayload[] = [];
  const reconciler = createClaudeTranscriptReconciler({
    transcriptRoot: root,
    onTerminalEvent: (event) => {
      received.push(event);
      aggregator.ingestAgentEvent(
        event,
        resolveAgentEventIngestOptions({
          event,
          evidenceSource: "transcript",
          runtime: claudeIntegration.runtime,
        })
      );
    },
  });
  async function send(
    nativeEvent: string,
    fields: Record<string, unknown> = {}
  ) {
    const rawEvents = await producer.run({
      nativeEvent,
      checkpoints: [],
      expectedNativeEvents: [],
      payload: {
        hook_event_name: nativeEvent,
        session_id: "main",
        transcript_path: path,
        prompt_id: COMPACT,
        ...fields,
      },
    });
    for (const raw of rawEvents) {
      const event = enrichAgentEventFromRawPayload(
        agentHookEventSchema.parse(raw)
      );
      if (event.kind !== "agentEvent") throw new Error("Expected agent event");
      const observations: Promise<void>[] = [];
      await handleObservedAgentHookEvent(
        {
          aggregator,
          applySessionTitle: async () => {},
          notifyListeners() {},
          observeTranscript: (hook) => {
            const observed = reconciler.observe(hook);
            observations.push(observed);
            return observed;
          },
          recordResume() {},
          resolveRuntime: () => claudeIntegration.runtime,
        },
        event
      );
      await Promise.all(observations);
    }
  }
  return {
    activity: () => aggregator.snapshot().activities[0],
    complete: () => appendFile(path, COMPLETION),
    received,
    send,
    close: async () => {
      reconciler.dispose();
      aggregator.dispose();
      await producer.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

describe("Claude 压缩钩子与 transcript 混合轨迹", () => {
  it.each([
    ["auto", false],
    ["auto", true],
    ["manual", true],
  ])("%s 压缩后无工具或 Stop，匿名完成仍属于用户回合；SessionStart=%s", async (trigger, sessionStart) => {
    const driver = await setup();
    try {
      await driver.send("UserPromptSubmit", {
        prompt_id: TURN,
        prompt: "work",
      });
      await driver.send("PreCompact", { trigger });
      if (sessionStart)
        await driver.send("SessionStart", { source: "compact" });
      await driver.send("PostCompact", { trigger });
      expect(driver.received).toHaveLength(0);
      expect(driver.activity()).not.toHaveProperty("turnResult");
      await driver.complete();
      await vi.waitFor(() =>
        expect(driver.activity()).toMatchObject({
          status: "ready",
          turnResult: "completed",
        })
      );
      expect(driver.received).toHaveLength(1);
      expect(driver.received[0]).toMatchObject({
        event: "TurnCompleted",
        turnId: TURN,
      });
    } finally {
      await driver.close();
    }
  });

  it("旧压缩在新提问后收尾，不能改写新提问的 transcript 归属", async () => {
    const driver = await setup();
    try {
      await driver.send("UserPromptSubmit", {
        prompt_id: TURN,
        prompt: "work",
      });
      await driver.send("PreCompact", { trigger: "manual" });
      await driver.send("UserPromptSubmit", {
        prompt_id: NEXT,
        prompt: "new work",
      });
      await driver.send("SessionStart", { source: "compact" });
      await driver.send("PostCompact", { trigger: "manual" });
      expect(driver.activity()).toMatchObject({ status: "processing" });
      await driver.complete();
      await vi.waitFor(() =>
        expect(driver.activity()).toMatchObject({
          status: "ready",
          turnResult: "completed",
        })
      );
      expect(driver.received).toHaveLength(1);
      expect(driver.received[0]).toMatchObject({ turnId: NEXT });
    } finally {
      await driver.close();
    }
  });
});
