import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentHookEventPayload,
  AgentHookEventPayloadV1,
} from "@shared/contracts/agent/session.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COPILOT_TRANSCRIPT_TERMINAL_EVIDENCE,
  classifyCopilotEventsLine,
  createCopilotTranscriptReconciler,
} from "../../../../../src/main/services/agents/integrations/transcript/copilot-reconciler.ts";

function hookEvent(
  overrides: Partial<AgentHookEventPayloadV1> = {}
): AgentHookEventPayload {
  return {
    agent: "copilot",
    event: "PromptSubmit",
    kind: "agentEvent",
    panelId: "panel-1",
    sessionId: "sess-1",
    v: 1,
    windowId: "1",
    ...overrides,
  };
}

describe("copilot transcript reconciler", () => {
  let dir: string;
  let root: string;
  let path: string;

  beforeEach(async () => {
    vi.useRealTimers();
    dir = await mkdtemp(join(tmpdir(), "pier-copilot-transcript-"));
    root = join(dir, "session-state");
    const sessionDir = join(root, "sess-1");
    await mkdir(sessionDir, { recursive: true });
    path = join(sessionDir, "events.jsonl");
    writeFileSync(path, '{"type":"session.start"}\n');
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it("classify: user abort → TurnInterrupted", () => {
    expect(
      classifyCopilotEventsLine(
        JSON.stringify({
          data: { reason: "user_initiated" },
          type: "abort",
        })
      )
    ).toMatchObject({
      nativeEvent: "copilot.events.abort.user_initiated",
      pierEvent: "TurnInterrupted",
    });
    expect(
      classifyCopilotEventsLine(
        JSON.stringify({
          data: { reason: "user initiated" },
          type: "abort",
        })
      )?.pierEvent
    ).toBe("TurnInterrupted");
    expect(
      classifyCopilotEventsLine(
        JSON.stringify({
          data: { reason: "user_timeout" },
          type: "abort",
        })
      )
    ).toBeNull();
    expect(
      classifyCopilotEventsLine(
        JSON.stringify({
          data: { reason: "caused_by_user_error" },
          type: "abort",
        })
      )
    ).toBeNull();
  });

  it("classify: session.task_complete → TurnCompleted；turn_end 不是终态", () => {
    expect(
      classifyCopilotEventsLine(
        JSON.stringify({
          data: { summary: "done" },
          type: "session.task_complete",
        })
      )
    ).toEqual({
      ...COPILOT_TRANSCRIPT_TERMINAL_EVIDENCE[1],
      turnId: "",
    });
    expect(
      classifyCopilotEventsLine(
        JSON.stringify({
          data: { turnId: "3" },
          type: "assistant.turn_end",
        })
      )
    ).toBeNull();
  });

  it("sessionId 解析 events.jsonl 后对账 abort", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCopilotTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      sessionStateRoot: root,
    });
    await reconciler.observe(hookEvent({ sessionId: "sess-1" }));
    appendFileSync(
      path,
      `${JSON.stringify({ data: { reason: "user_initiated" }, type: "abort" })}\n`
    );

    await vi.waitFor(() => {
      expect(received).toHaveLength(1);
    });
    expect(received[0]).toMatchObject({
      event: "TurnInterrupted",
      nativeEvent: "copilot.events.abort.user_initiated",
      v: 3,
    });
    reconciler.dispose();
  });
});
