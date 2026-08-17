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
  CODEBUDDY_TRANSCRIPT_TERMINAL_EVIDENCE,
  classifyCodebuddyTranscriptLine,
  createCodebuddyTranscriptReconciler,
} from "../../../../../src/main/services/agents/integrations/transcript/codebuddy-reconciler.ts";

function hookEvent(
  overrides: Partial<AgentHookEventPayloadV1> = {}
): AgentHookEventPayload {
  return {
    agent: "codebuddy",
    event: "PromptSubmit",
    kind: "agentEvent",
    panelId: "panel-1",
    sessionId: "session-1",
    v: 1,
    windowId: "1",
    ...overrides,
  };
}

function interruptLine(
  text = "[Request interrupted by user]",
  extra: Record<string, unknown> = {}
): string {
  return `${JSON.stringify({
    message: { content: [{ text, type: "text" }], role: "user" },
    type: "user",
    ...extra,
  })}\n`;
}

describe("codebuddy transcript reconciler", () => {
  let dir: string;
  let projectsRoot: string;
  let path: string;

  beforeEach(async () => {
    vi.useRealTimers();
    dir = await mkdtemp(join(tmpdir(), "pier-codebuddy-transcript-"));
    projectsRoot = join(dir, "projects");
    const cwdDir = join(projectsRoot, "Users-test-project");
    await mkdir(cwdDir, { recursive: true });
    path = join(cwdDir, "session-1.jsonl");
    writeFileSync(path, '{"type":"summary"}\n');
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it("导出中断与完成证据", () => {
    expect(CODEBUDDY_TRANSCRIPT_TERMINAL_EVIDENCE).toEqual([
      {
        nativeEvent: "codebuddy.transcript.user_interrupt",
        pierEvent: "TurnInterrupted",
      },
      {
        nativeEvent: "codebuddy.transcript.assistant_completed",
        pierEvent: "TurnCompleted",
      },
    ]);
  });

  it("sessionId 扫描后对账 TurnInterrupted", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodebuddyTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot: projectsRoot,
    });
    await reconciler.observe(hookEvent({ sessionId: "session-1" }));
    appendFileSync(path, interruptLine());

    await vi.waitFor(() => {
      expect(received).toHaveLength(1);
    });
    expect(received[0]).toMatchObject({
      event: "TurnInterrupted",
      nativeEvent: "codebuddy.transcript.user_interrupt",
      v: 3,
    });
    reconciler.dispose();
  });

  it("assistant status=completed 对账 TurnCompleted", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodebuddyTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot: projectsRoot,
    });
    await reconciler.observe(hookEvent({ sessionId: "session-1" }));
    appendFileSync(
      path,
      `${JSON.stringify({
        role: "assistant",
        status: "completed",
        type: "message",
      })}\n`
    );

    await vi.waitFor(() => {
      expect(received).toHaveLength(1);
    });
    expect(received[0]).toMatchObject({
      event: "TurnCompleted",
      nativeEvent: "codebuddy.transcript.assistant_completed",
      v: 3,
    });
    reconciler.dispose();
  });

  it("assistant completed 但带 tool_use 不算终态", () => {
    expect(
      classifyCodebuddyTranscriptLine(
        JSON.stringify({
          content: [{ name: "Bash", type: "tool_use" }],
          role: "assistant",
          status: "completed",
          type: "message",
        })
      )
    ).toBeNull();
    expect(
      classifyCodebuddyTranscriptLine(
        JSON.stringify({
          message: {
            content: [{ name: "Read", type: "tool_use" }],
            stop_reason: "tool_use",
          },
          role: "assistant",
          status: "completed",
          type: "message",
        })
      )
    ).toBeNull();
  });

  it("function_call_result status=completed 不算终态", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodebuddyTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot: projectsRoot,
    });
    await reconciler.observe(hookEvent({ sessionId: "session-1" }));
    appendFileSync(
      path,
      `${JSON.stringify({
        role: "tool",
        status: "completed",
        type: "function_call_result",
      })}\n`
    );
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));

    expect(received).toHaveLength(0);
    reconciler.dispose();
  });
});
