import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentHookEventPayload,
  AgentHookEventPayloadV1,
} from "@shared/contracts/agent-session.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyGrokUpdatesLine,
  createGrokTranscriptReconciler,
} from "../../../src/main/services/agents/integrations/grok-transcript-reconciler.ts";

function hookEvent(
  overrides: Partial<AgentHookEventPayloadV1> = {}
): AgentHookEventPayload {
  return {
    agent: "grok",
    event: "PromptSubmit",
    kind: "agentEvent",
    panelId: "panel-1",
    sessionId: "session-1",
    v: 1,
    windowId: "1",
    ...overrides,
  };
}

function turnCompletedLine(
  stopReason: string,
  method: "session/update" | "_x.ai/session/update" = "_x.ai/session/update"
): string {
  return `${JSON.stringify({
    method,
    params: {
      sessionId: "session-1",
      update: {
        sessionUpdate: "turn_completed",
        stop_reason: stopReason,
        prompt_id: "prompt-1",
      },
    },
    timestamp: 1,
  })}\n`;
}

describe("classifyGrokUpdatesLine", () => {
  it("cancelled → TurnInterrupted", () => {
    expect(
      classifyGrokUpdatesLine(turnCompletedLine("cancelled").trim())
    ).toEqual({
      nativeEvent: "grok.updates.turn_completed.cancelled",
      pierEvent: "TurnInterrupted",
      turnId: "",
    });
  });

  it("end_turn → TurnCompleted", () => {
    expect(
      classifyGrokUpdatesLine(turnCompletedLine("end_turn").trim())
    ).toEqual({
      nativeEvent: "grok.updates.turn_completed.end_turn",
      pierEvent: "TurnCompleted",
      turnId: "",
    });
  });

  it("error / rate_limit 不对账为 ready（避免谎报）", () => {
    expect(
      classifyGrokUpdatesLine(turnCompletedLine("error").trim())
    ).toBeNull();
    expect(
      classifyGrokUpdatesLine(turnCompletedLine("rate_limit").trim())
    ).toBeNull();
  });

  it("非 turn_completed 行忽略", () => {
    expect(
      classifyGrokUpdatesLine(
        JSON.stringify({
          method: "session/update",
          params: { update: { sessionUpdate: "tool_call" } },
        })
      )
    ).toBeNull();
  });
});

describe("createGrokTranscriptReconciler", () => {
  let dir: string;
  let sessionsRoot: string;
  let updatesPath: string;

  beforeEach(async () => {
    vi.useRealTimers();
    dir = await mkdtemp(join(tmpdir(), "pier-grok-transcript-"));
    sessionsRoot = join(dir, "sessions");
    const sessionDir = join(sessionsRoot, "encoded-cwd", "session-1");
    await mkdir(sessionDir, { recursive: true });
    updatesPath = join(sessionDir, "updates.jsonl");
    writeFileSync(updatesPath, '{"method":"session/update","params":{}}\n');
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it("按 sessionId 解析 updates.jsonl，cancelled 对账为 TurnInterrupted", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createGrokTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      sessionsRoot,
    });
    await reconciler.observe(hookEvent({ sessionId: "session-1" }));
    appendFileSync(updatesPath, turnCompletedLine("cancelled"));

    await vi.waitFor(() => {
      expect(received).toHaveLength(1);
    });
    expect(received[0]).toMatchObject({
      event: "TurnInterrupted",
      nativeEvent: "grok.updates.turn_completed.cancelled",
      panelId: "panel-1",
      sessionId: "session-1",
      v: 2,
      windowId: "1",
    });
    reconciler.dispose();
  });

  it("end_turn 对账为 TurnCompleted（覆盖 Stop 漏报）", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createGrokTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      sessionsRoot,
    });
    await reconciler.observe(hookEvent({ sessionId: "session-1" }));
    appendFileSync(
      updatesPath,
      turnCompletedLine("end_turn", "session/update")
    );

    await vi.waitFor(() => {
      expect(received).toHaveLength(1);
    });
    expect(received[0]?.event).toBe("TurnCompleted");
    reconciler.dispose();
  });

  it("显式 transcriptPath 优先于 session 扫描", async () => {
    const otherDir = join(sessionsRoot, "other", "session-1");
    await mkdir(otherDir, { recursive: true });
    const explicit = join(otherDir, "updates.jsonl");
    writeFileSync(explicit, "{}\n");

    const received: AgentHookEventPayload[] = [];
    const reconciler = createGrokTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      sessionsRoot,
    });
    await reconciler.observe(
      hookEvent({ sessionId: "session-1", transcriptPath: explicit })
    );
    appendFileSync(explicit, turnCompletedLine("cancelled"));

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]?.event).toBe("TurnInterrupted");
    reconciler.dispose();
  });

  it("非 grok agent 忽略", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createGrokTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      sessionsRoot,
    });
    await reconciler.observe(
      hookEvent({ agent: "claude", sessionId: "session-1" })
    );
    appendFileSync(updatesPath, turnCompletedLine("cancelled"));
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));
    expect(received).toHaveLength(0);
    reconciler.dispose();
  });
});
