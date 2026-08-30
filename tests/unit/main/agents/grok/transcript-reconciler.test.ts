import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentHookEventPayload,
  AgentHookEventPayloadV1,
} from "@shared/contracts/agent/session.ts";
import { agentHookEventSchema } from "@shared/contracts/agent/session.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyGrokQuestionLine,
  scanGrokQuestionState,
} from "../../../../../src/main/services/agents/integrations/transcript/grok-question.ts";
import {
  classifyGrokUpdatesLine,
  createGrokTranscriptReconciler,
  defaultGrokSessionsRoot,
} from "../../../../../src/main/services/agents/integrations/transcript/grok-reconciler.ts";

function hookEvent(
  overrides: Partial<AgentHookEventPayloadV1> = {}
): AgentHookEventPayload {
  return {
    agent: "grok",
    event: "PromptSubmit",
    kind: "agentEvent",
    panelId: "panel-1",
    sessionId: "session-1",
    turnId: "prompt-1",
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
      turnId: "prompt-1",
    });
  });

  it("end_turn → TurnCompleted", () => {
    expect(
      classifyGrokUpdatesLine(turnCompletedLine("end_turn").trim())
    ).toEqual({
      nativeEvent: "grok.updates.turn_completed.end_turn",
      pierEvent: "TurnCompleted",
      turnId: "prompt-1",
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

  it("缺少 prompt_id 时丢弃终态，禁止空 id owner 回退", () => {
    expect(
      classifyGrokUpdatesLine(
        JSON.stringify({
          method: "session/update",
          params: {
            update: {
              sessionUpdate: "turn_completed",
              stop_reason: "end_turn",
            },
          },
        })
      )
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

describe("defaultGrokSessionsRoot", () => {
  it("使用去除两端空白后的 GROK_HOME", () => {
    expect(
      defaultGrokSessionsRoot({
        GROK_HOME: "  /custom/grok  ",
        HOME: "/home/test",
      })
    ).toBe("/custom/grok/sessions");
  });

  it("空白 GROK_HOME 回落 HOME/.grok", () => {
    expect(
      defaultGrokSessionsRoot({
        GROK_HOME: "   ",
        HOME: "/home/test",
      })
    ).toBe("/home/test/.grok/sessions");
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
      turnId: "prompt-1",
      v: 3,
      windowId: "1",
    });
    expect(agentHookEventSchema.safeParse(received[0]).success).toBe(true);
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

  it("首次扫描缺失不会永久缓存，文件稍后创建仍可建立终态对账", async () => {
    await rm(updatesPath);
    const received: AgentHookEventPayload[] = [];
    const reconciler = createGrokTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      sessionsRoot,
    });

    await reconciler.observe(hookEvent({ sessionId: "session-1" }));
    writeFileSync(updatesPath, '{"method":"session/update","params":{}}\n');
    await reconciler.observe(hookEvent({ sessionId: "session-1" }));
    appendFileSync(updatesPath, turnCompletedLine("cancelled"));

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({
      event: "TurnInterrupted",
      nativeEvent: "grok.updates.turn_completed.cancelled",
    });
    reconciler.dispose();
  });

  it("缓存路径消失后重新扫描同 session 的替代 updates.jsonl", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createGrokTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      sessionsRoot,
    });
    await reconciler.observe(hookEvent({ sessionId: "session-1" }));
    await rm(updatesPath);
    const replacementDir = join(sessionsRoot, "replacement-cwd", "session-1");
    await mkdir(replacementDir, { recursive: true });
    const replacementPath = join(replacementDir, "updates.jsonl");
    writeFileSync(replacementPath, '{"method":"session/update","params":{}}\n');

    await reconciler.observe(hookEvent({ sessionId: "session-1" }));
    appendFileSync(replacementPath, turnCompletedLine("end_turn"));

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({
      event: "TurnCompleted",
      nativeEvent: "grok.updates.turn_completed.end_turn",
    });
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

  it("backfills an open ask_user_question as waiting", async () => {
    writeFileSync(
      updatesPath,
      `${JSON.stringify({
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "tool_call",
            title: "ask_user_question",
            toolCallId: "call-ask-1",
          },
        },
      })}\n`
    );
    const received: AgentHookEventPayload[] = [];
    const reconciler = createGrokTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      sessionsRoot,
    });
    await reconciler.observe(hookEvent({ sessionId: "session-1" }));
    expect(received).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "InteractionRequested",
          interactionId: "call-ask-1",
          interactionKind: "question",
          nativeEvent: "grok.updates.ask_user_question",
        }),
      ])
    );
    reconciler.dispose();
  });

  it("resolves the question only when tool_call_update is completed", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createGrokTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      sessionsRoot,
    });
    await reconciler.observe(hookEvent({ sessionId: "session-1" }));
    appendFileSync(
      updatesPath,
      `${JSON.stringify({
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "tool_call",
            title: "ask_user_question",
            toolCallId: "call-ask-2",
          },
        },
      })}\n`
    );
    await vi.waitFor(() => {
      expect(
        received.some((event) => event.event === "InteractionRequested")
      ).toBe(true);
    });
    appendFileSync(
      updatesPath,
      `${JSON.stringify({
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "call-ask-2",
            status: "completed",
          },
        },
      })}\n`
    );
    await vi.waitFor(() => {
      expect(
        received.some((event) => event.event === "InteractionResolved")
      ).toBe(true);
    });
    expect(
      received.find((event) => event.event === "InteractionResolved")
    ).toMatchObject({
      interactionId: "call-ask-2",
      interactionOutcome: "completed",
    });
    reconciler.dispose();
  });

  it("does not cancel an open question on TurnCompleted", async () => {
    writeFileSync(
      updatesPath,
      `${JSON.stringify({
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "tool_call",
            title: "ask_user_question",
            toolCallId: "call-ask-keep",
          },
        },
      })}\n`
    );
    const received: AgentHookEventPayload[] = [];
    const reconciler = createGrokTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      sessionsRoot,
    });
    await reconciler.observe(hookEvent({ sessionId: "session-1" }));
    expect(
      received.some((event) => event.event === "InteractionRequested")
    ).toBe(true);
    await reconciler.observe(
      hookEvent({ event: "TurnCompleted", sessionId: "session-1" })
    );
    expect(
      received.filter((event) => event.event === "InteractionResolved")
    ).toHaveLength(0);
    reconciler.dispose();
  });

  it("does not cancel another panel's open question", async () => {
    const otherDir = join(sessionsRoot, "encoded-cwd", "session-2");
    await mkdir(otherDir, { recursive: true });
    const otherPath = join(otherDir, "updates.jsonl");
    writeFileSync(
      updatesPath,
      `${JSON.stringify({
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "tool_call",
            title: "ask_user_question",
            toolCallId: "ask-a",
          },
        },
      })}\n`
    );
    writeFileSync(
      otherPath,
      `${JSON.stringify({
        method: "session/update",
        params: {
          update: {
            sessionUpdate: "tool_call",
            title: "ask_user_question",
            toolCallId: "ask-b",
          },
        },
      })}\n`
    );
    const received: AgentHookEventPayload[] = [];
    const reconciler = createGrokTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      sessionsRoot,
    });
    await reconciler.observe(
      hookEvent({ sessionId: "session-1", panelId: "panel-a" })
    );
    await reconciler.observe(
      hookEvent({
        sessionId: "session-2",
        panelId: "panel-b",
        windowId: "2",
      })
    );
    await reconciler.observe(
      hookEvent({
        event: "TurnInterrupted",
        sessionId: "session-1",
        panelId: "panel-a",
      })
    );
    expect(
      received.filter(
        (event) =>
          event.event === "InteractionResolved" &&
          "interactionId" in event &&
          event.interactionId === "ask-a"
      )
    ).toHaveLength(1);
    expect(
      received.filter(
        (event) =>
          event.event === "InteractionResolved" &&
          "interactionId" in event &&
          event.interactionId === "ask-b"
      )
    ).toHaveLength(0);
    reconciler.dispose();
  });
});

describe("applyGrokQuestionLine", () => {
  it("keeps pending until completed, not on a later tool_call_update title", () => {
    const state = scanGrokQuestionState(
      [
        JSON.stringify({
          method: "session/update",
          params: {
            update: {
              sessionUpdate: "tool_call",
              title: "ask_user_question",
              toolCallId: "q1",
            },
          },
        }),
        JSON.stringify({
          method: "session/update",
          params: {
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "q1",
              title: "Ask: 下一步从哪来",
            },
          },
        }),
      ].join("\n")
    );
    expect(state.pendingIds).toEqual(["q1"]);
    const after = { pendingIds: [...state.pendingIds] };
    expect(
      applyGrokQuestionLine(
        after,
        JSON.stringify({
          method: "session/update",
          params: {
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "q1",
              status: "completed",
            },
          },
        })
      )?.pierEvent
    ).toBe("InteractionResolved");
    expect(after.pendingIds).toEqual([]);
  });
});
