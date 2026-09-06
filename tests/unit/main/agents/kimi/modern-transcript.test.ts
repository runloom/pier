import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kimiIntegration } from "@main/services/agents/integrations/kimi.ts";
import { resolveAgentEventIngestOptions } from "@main/services/agents/integrations/runtime/event-authority.ts";
import {
  classifyKimiWireLine,
  createKimiTranscriptReconciler,
} from "@main/services/agents/integrations/transcript/kimi-reconciler.ts";
import { readKimiMainTurnId } from "@main/services/agents/integrations/transcript/kimi-turn-identity.ts";
import { createForegroundActivityAggregator } from "@main/services/foreground-activity/aggregator.ts";
import type {
  AgentHookEventPayload,
  AgentHookEventPayloadV3,
} from "@shared/contracts/agent/session.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SimpleHookEvent = Exclude<
  AgentHookEventPayloadV3,
  { event: "InteractionRequested" | "InteractionResolved" }
>;

describe("Kimi Code 0.41 main turn completion", () => {
  let root: string;
  let path: string;
  let aggregator: ReturnType<typeof createForegroundActivityAggregator>;
  let reconciler: ReturnType<typeof createKimiTranscriptReconciler>;
  let received: AgentHookEventPayload[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pier-kimi-modern-"));
    const mainDir = join(root, "project", "session-main", "agents", "main");
    await mkdir(mainDir, { recursive: true });
    path = join(mainDir, "wire.jsonl");
    writeFileSync(path, "");
    received = [];
    aggregator = createForegroundActivityAggregator();
    reconciler = createKimiTranscriptReconciler({
      onTerminalEvent: (event) => {
        received.push(event);
        ingest(event, "transcript");
      },
      sessionsRoots: [root],
    });
  });

  afterEach(async () => {
    reconciler.dispose();
    aggregator.dispose();
    await rm(root, { force: true, recursive: true });
  });

  function ingest(
    event: AgentHookEventPayload,
    evidenceSource: "hook" | "transcript"
  ) {
    aggregator.ingestAgentEvent(
      event,
      resolveAgentEventIngestOptions({
        event,
        evidenceSource,
        runtime: kimiIntegration.runtime,
      })
    );
  }

  async function hook(
    event: SimpleHookEvent["event"],
    fields: Partial<SimpleHookEvent> = {}
  ) {
    const payload: AgentHookEventPayloadV3 = {
      agent: "kimi",
      event,
      kind: "agentEvent",
      nativeEvent: event,
      panelId: "panel-kimi",
      sessionId: "session-main",
      ts: Date.now(),
      v: 3,
      windowId: "1",
      ...fields,
    };
    if (event === "PromptSubmit") await reconciler.observe(payload);
    ingest(payload, "hook");
    if (event !== "PromptSubmit") await reconciler.observe(payload);
  }

  function status() {
    return aggregator
      .snapshot()
      .activities.find((activity) => activity.kind === "agent")?.status;
  }

  function wire(fields: Record<string, unknown>) {
    appendFileSync(
      path,
      `${JSON.stringify({ agentId: "main", time: Date.now(), ...fields })}\n`
    );
  }

  function step(turnId: number, toolCallId?: string) {
    wire({ origin: { kind: "user" }, type: "turn.prompt" });
    wire({
      event: { step: 1, turnId: String(turnId), type: "step.begin" },
      type: "context.append_loop_event",
    });
    if (toolCallId)
      wire({
        event: {
          name: "Agent",
          toolCallId,
          turnId: String(turnId),
          type: "tool.call",
        },
        type: "context.append_loop_event",
      });
  }

  it("StopFailure cannot associate a main failure from before this observation", async () => {
    const boundary = Date.now();
    wire({
      time: boundary - 20,
      type: "context.append_loop_event",
      event: { type: "step.begin", turnId: "0" },
    });
    wire({
      time: boundary - 10,
      type: "turn.ended",
      reason: "failed",
      turnId: 0,
    });
    expect(
      await readKimiMainTurnId(
        path,
        root,
        {
          agent: "kimi",
          event: "Stop",
          kind: "agentEvent",
          nativeEvent: "StopFailure",
          panelId: "panel-kimi",
          sessionId: "session-main",
          ts: boundary,
          v: 3,
          windowId: "1",
        },
        boundary
      )
    ).toBeUndefined();
  });

  it.each([
    ["completed", "TurnCompleted"],
    ["cancelled", "TurnInterrupted"],
    ["failed", "error"],
  ])("preserves numeric zero for main %s", (reason, pierEvent) => {
    expect(
      classifyKimiWireLine(
        JSON.stringify({
          agentId: "main",
          reason,
          turnId: 0,
          type: "turn.ended",
        })
      )
    ).toEqual({
      nativeEvent: `kimi.wire.turn.ended.${reason}`,
      pierEvent,
      turnId: "0",
    });
  });

  it.each([
    { agentId: "agent-0", reason: "completed", turnId: 0 },
    { reason: "completed", turnId: 0 },
    { agentId: "main", reason: "completed" },
    { agentId: "main", reason: "completed", turnId: "" },
    { agentId: "main", reason: "completed", turnId: -1 },
    { agentId: "agent-0", reason: "failed", turnId: 0 },
    { agentId: "main", reason: "blocked", turnId: 0 },
  ])("ignores child, malformed, and non-completion terminals: %j", (fields) => {
    expect(
      classifyKimiWireLine(JSON.stringify({ type: "turn.ended", ...fields }))
    ).toBeNull();
  });

  it("finishes two consecutive turns without PromptSubmit after ignoring child Stops", async () => {
    await hook("SessionStart");
    for (const turnId of [0, 1]) {
      const toolUseId = `main-tool-${turnId}`;
      step(turnId, toolUseId);
      await hook("ToolStart", { toolName: "Agent", toolUseId });
      await hook("Stop");
      expect(status()).toBe("tool");
      await hook("ToolComplete", { toolName: "Agent", toolUseId });
      expect(status()).toBe("processing");
      await hook("Stop");
      wire({ reason: "completed", turnId, type: "turn.ended" });
      await vi.waitFor(() => expect(status()).toBe("ready"));
      expect(received.at(-1)).toMatchObject({
        event: "TurnCompleted",
        turnId: String(turnId),
      });
    }
    expect(received).toHaveLength(2);
  });

  it.each([
    false,
    true,
  ])("finishes a no-tool turn when terminal is already flushed: %s", async (flushed) => {
    await hook("SessionStart");
    step(0);
    const ts = Date.now();
    if (flushed) wire({ reason: "completed", turnId: 0, type: "turn.ended" });
    await hook("Stop", { ts: ts * 1_000_000 });
    if (!flushed) wire({ reason: "completed", turnId: 0, type: "turn.ended" });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(status()).toBe("ready");
  });

  it.each([
    "completed",
    "failed",
  ])("cannot associate a child-only tool with historical main %s", async (reason) => {
    step(0, "old-main-tool");
    wire({
      reason,
      time: Date.now() - 10_000,
      turnId: 0,
      type: "turn.ended",
    });
    await hook("SessionStart");
    await hook("ToolStart", { toolName: "Read", toolUseId: "child-only-tool" });
    await hook("Stop");
    await hook("Stop", { nativeEvent: "StopFailure" });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(received).toHaveLength(0);
    expect(status()).toBe("tool");

    step(1, "new-main-tool");
    await hook("ToolStart", { toolName: "Read", toolUseId: "new-main-tool" });
    await hook("ToolComplete", {
      toolName: "Read",
      toolUseId: "new-main-tool",
    });
    wire({ reason: "completed", turnId: 1, type: "turn.ended" });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]?.turnId).toBe("1");
  });

  it.each([
    false,
    true,
  ])("main failure is authoritative, including a flushed no-tool failure: tool=%s", async (hasTool) => {
    await hook("SessionStart");
    step(0, hasTool ? "main-tool" : undefined);
    if (hasTool)
      await hook("ToolStart", { toolName: "Read", toolUseId: "main-tool" });
    wire({ reason: "failed", turnId: 0, type: "turn.ended" });
    // StopFailure is emitted after the native failed event, unlike Stop.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await hook("Stop", { nativeEvent: "StopFailure" });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({ event: "error", turnId: "0" });
    expect(status()).toBe("error");
  });

  it("a new PromptSubmit retires the previous native turn association", async () => {
    step(0, "old-main-tool");
    await hook("ToolStart", { toolName: "Read", toolUseId: "old-main-tool" });
    await hook("PromptSubmit");
    wire({ reason: "completed", turnId: 0, type: "turn.ended" });
    step(1, "new-main-tool");
    await hook("ToolStart", { toolName: "Read", toolUseId: "new-main-tool" });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(received).toHaveLength(0);
    expect(status()).toBe("tool");
    wire({ reason: "completed", turnId: 1, type: "turn.ended" });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]?.turnId).toBe("1");
  });

  it("a delayed prior-turn hook cannot rebind after a new prompt", async () => {
    step(0, "old-main-tool");
    await hook("ToolStart", { toolName: "Read", toolUseId: "old-main-tool" });
    const oldHookTime = Date.now();
    await hook("PromptSubmit");
    wire({ reason: "completed", turnId: 0, type: "turn.ended" });
    await hook("ToolComplete", {
      toolName: "Read",
      toolUseId: "old-main-tool",
      ts: oldHookTime,
    });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(received).toHaveLength(0);
    expect(status()).toBe("processing");
  });

  it("reconciles cancellation from the main turn's native terminal", async () => {
    step(0, "main-tool");
    await hook("ToolStart", { toolName: "Bash", toolUseId: "main-tool" });
    wire({ reason: "cancelled", turnId: 0, type: "turn.ended" });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({
      event: "TurnInterrupted",
      turnId: "0",
    });
    expect(status()).toBe("ready");
  });
});
