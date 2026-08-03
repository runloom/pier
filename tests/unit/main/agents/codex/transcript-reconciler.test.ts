import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentHookEventPayload,
  agentHookEventSchema,
} from "@shared/contracts/agent/session.ts";
import type { AgentActivity } from "@shared/contracts/foreground-activity.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCodexTranscriptReconciler } from "../../../../../src/main/services/agents/integrations/transcript/codex-reconciler.ts";
import { createForegroundActivityAggregator } from "../../../../../src/main/services/foreground-activity/aggregator.ts";

function hookEvent(
  transcriptPath: string,
  turnId: string
): AgentHookEventPayload {
  return {
    agent: "codex",
    event: "PromptSubmit",
    kind: "agentEvent",
    panelId: "panel-1",
    sessionId: "session-1",
    transcriptPath,
    turnId,
    v: 1,
    windowId: "1",
  };
}

/** Full-suite load can delay fs.watch; keep waits above default 1s. */
const TRANSCRIPT_WAIT_MS = 5000;

function waitForTranscript(
  assertion: () => void,
  timeout = TRANSCRIPT_WAIT_MS
): Promise<void> {
  return vi.waitFor(assertion, { timeout });
}

describe("codex transcript reconciler", () => {
  let dir: string;
  let path: string;
  let transcriptRoot: string;

  beforeEach(async () => {
    vi.useRealTimers();
    dir = await mkdtemp(join(tmpdir(), "pier-codex-transcript-"));
    transcriptRoot = join(dir, "sessions");
    await mkdir(transcriptRoot);
    path = join(transcriptRoot, "rollout.jsonl");
    writeFileSync(path, '{"type":"session_meta"}\n');
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it("把 Esc 中断记录对账为 TurnInterrupted", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path, "turn-1"));
    appendFileSync(
      path,
      `${JSON.stringify({
        type: "event_msg",
        payload: {
          reason: "interrupted",
          turn_id: "turn-1",
          type: "turn_aborted",
        },
      })}\n`
    );

    await waitForTranscript(() => {
      expect(received).toHaveLength(1);
    });
    expect(received[0]).toMatchObject({
      event: "TurnInterrupted",
      nativeEvent: "codex.transcript.turn_aborted",
      panelId: "panel-1",
      turnId: "turn-1",
      v: 3,
      windowId: "1",
    });
    expect(agentHookEventSchema.safeParse(received[0]).success).toBe(true);
    reconciler.dispose();
  });

  it("把正常完成记录对账为 TurnCompleted，并按 turn 去重", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path, "turn-2"));
    const line = `${JSON.stringify({
      type: "event_msg",
      payload: { turn_id: "turn-2", type: "task_complete" },
    })}\n`;
    appendFileSync(path, line + line);

    await waitForTranscript(() => {
      expect(received).toHaveLength(1);
    });
    expect(received[0]?.event).toBe("TurnCompleted");
    reconciler.dispose();
  });

  it("官方 rollout function_call/output 形状形成提问与权限交互闭环", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path, "turn-interaction"));
    appendFileSync(
      path,
      `${[
        {
          payload: {
            turn_id: "turn-interaction",
          },
          type: "turn_context",
        },
        {
          payload: {
            call_id: "question-1",
            questions: [{ id: "confirm", question: "Continue?" }],
            turn_id: "turn-interaction",
            type: "request_user_input",
          },
          type: "event_msg",
        },
        {
          payload: {
            call_id: "question-1",
            output: '{"answers":{"confirm":{"answers":["yes"]}}}',
            type: "function_call_output",
          },
          type: "response_item",
        },
        {
          payload: {
            call_id: "permission-1",
            permissions: { file_system: { write: ["/tmp"] } },
            reason: "write",
            turn_id: "turn-interaction",
            type: "request_permissions",
          },
          type: "event_msg",
        },
        {
          payload: {
            call_id: "permission-1",
            output:
              '{"permissions":{"file_system":{"write":["/tmp"]}},"scope":"turn"}',
            type: "function_call_output",
          },
          type: "response_item",
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n")}\n`
    );

    await waitForTranscript(() => expect(received).toHaveLength(4));
    expect(received).toMatchObject([
      {
        event: "InteractionRequested",
        interactionId: "question-1",
        interactionKind: "question",
        nativeEvent: "codex.transcript.request_user_input",
        turnId: "turn-interaction",
        v: 3,
      },
      {
        event: "InteractionResolved",
        interactionId: "question-1",
        interactionKind: "question",
        interactionOutcome: "completed",
        nativeEvent: "codex.transcript.request_user_input.output",
        turnId: "turn-interaction",
        v: 3,
      },
      {
        event: "InteractionRequested",
        interactionId: "permission-1",
        interactionKind: "permission",
        nativeEvent: "codex.transcript.request_permissions",
        turnId: "turn-interaction",
        v: 3,
      },
      {
        event: "InteractionResolved",
        interactionId: "permission-1",
        interactionKind: "permission",
        interactionOutcome: "accepted",
        nativeEvent: "codex.transcript.request_permissions.output",
        turnId: "turn-interaction",
        v: 3,
      },
    ]);
    for (const event of received) {
      expect(agentHookEventSchema.safeParse(event).success).toBe(true);
    }
    reconciler.dispose();
  });

  it("两个 transcript 的相同 call_id 与 turn_id 只解除各自 entry", async () => {
    const secondPath = join(transcriptRoot, "rollout-second.jsonl");
    writeFileSync(secondPath, '{"type":"session_meta"}\n');
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await Promise.all([
      reconciler.observe({
        ...hookEvent(path, "turn-shared"),
        panelId: "panel-a",
      }),
      reconciler.observe({
        ...hookEvent(secondPath, "turn-shared"),
        panelId: "panel-b",
      }),
    ]);
    const request = `${JSON.stringify({
      payload: {
        call_id: "call-shared",
        turn_id: "turn-shared",
        type: "request_user_input",
      },
      type: "event_msg",
    })}\n`;
    appendFileSync(path, request);
    appendFileSync(secondPath, request);
    await waitForTranscript(() =>
      expect(
        received.filter((event) => event.event === "InteractionRequested")
      ).toHaveLength(2)
    );
    const output = `${JSON.stringify({
      payload: {
        call_id: "call-shared",
        output: '{"answers":{"confirm":{"answers":["yes"]}}}',
        type: "function_call_output",
      },
      type: "response_item",
    })}\n`;
    appendFileSync(path, output);
    await waitForTranscript(() =>
      expect(
        received.filter((event) => event.event === "InteractionResolved")
      ).toHaveLength(1)
    );
    expect(received.at(-1)?.panelId).toBe("panel-a");

    appendFileSync(secondPath, output);
    await waitForTranscript(() =>
      expect(
        received.filter((event) => event.event === "InteractionResolved")
      ).toHaveLength(2)
    );
    expect(received.at(-1)?.panelId).toBe("panel-b");
    reconciler.dispose();
  });

  it("transcript 截断会清理该 entry 的未决 interaction", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path, "turn-truncated-interaction"));
    appendFileSync(
      path,
      '{"type":"event_msg","payload":{"call_id":"stale-call","turn_id":"turn-truncated-interaction","type":"request_user_input"}}\n'
    );
    await waitForTranscript(() => expect(received).toHaveLength(1));

    writeFileSync(path, '{"type":"session_meta"}\n');
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 350));
    appendFileSync(
      path,
      '{"type":"response_item","payload":{"call_id":"stale-call","output":"{}","type":"function_call_output"}}\n'
    );
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 350));

    expect(received).toHaveLength(1);
    reconciler.dispose();
  });

  it("entry 释放后旧 interaction 不会在新 transcript 中闭合", async () => {
    const secondPath = join(transcriptRoot, "rollout-after-dispose.jsonl");
    writeFileSync(secondPath, '{"type":"session_meta"}\n');
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path, "turn-disposed"));
    appendFileSync(
      path,
      '{"type":"event_msg","payload":{"call_id":"disposed-call","turn_id":"turn-disposed","type":"request_user_input"}}\n'
    );
    await waitForTranscript(() => expect(received).toHaveLength(1));
    reconciler.releasePanel("panel-1", "1");

    await reconciler.observe(hookEvent(secondPath, "turn-disposed"));
    appendFileSync(
      secondPath,
      '{"type":"response_item","payload":{"call_id":"disposed-call","output":"{}","type":"function_call_output"}}\n'
    );
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 350));

    expect(received).toHaveLength(1);
    reconciler.dispose();
  });

  it("未决 Codex interaction 超限时丢弃最旧匹配状态", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    const pendingLimit = 128;
    await reconciler.observe(hookEvent(path, "turn-capacity"));
    appendFileSync(
      path,
      `${Array.from({ length: pendingLimit + 1 }, (_, index) =>
        JSON.stringify({
          payload: {
            call_id: `call-${index}`,
            turn_id: "turn-capacity",
            type: "request_user_input",
          },
          type: "event_msg",
        })
      ).join("\n")}\n`
    );
    await waitForTranscript(() =>
      expect(received).toHaveLength(pendingLimit + 1)
    );
    appendFileSync(
      path,
      `${[
        {
          payload: {
            call_id: "call-0",
            output: "{}",
            type: "function_call_output",
          },
          type: "response_item",
        },
        {
          payload: {
            call_id: `call-${pendingLimit}`,
            output: "{}",
            type: "function_call_output",
          },
          type: "response_item",
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n")}\n`
    );
    await waitForTranscript(() =>
      expect(
        received.filter((event) => event.event === "InteractionResolved")
      ).toHaveLength(1)
    );
    expect(received.at(-1)).toMatchObject({
      event: "InteractionResolved",
      interactionId: `call-${pendingLimit}`,
    });
    reconciler.dispose();
  });

  it("上下文晚到时按 transcript 原顺序重放交互与终态", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path, "turn-owner"));
    appendFileSync(
      path,
      `${[
        {
          payload: {
            call_id: "late-call",
            turn_id: "turn-late",
            type: "request_user_input",
          },
          type: "event_msg",
        },
        {
          payload: {
            call_id: "late-call",
            output: "{}",
            type: "function_call_output",
          },
          type: "response_item",
        },
        {
          payload: { turn_id: "turn-late", type: "task_complete" },
          type: "event_msg",
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n")}\n`
    );
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 350));
    expect(received).toHaveLength(0);

    await reconciler.observe(hookEvent(path, "turn-late"));

    expect(received.map((event) => event.event)).toEqual([
      "InteractionRequested",
      "InteractionResolved",
      "TurnCompleted",
    ]);
    reconciler.dispose();
  });

  it("晚到上下文暂存队列超限时只保留最近记录", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    const pendingRecordLimit = 64;
    await reconciler.observe(hookEvent(path, "turn-owner"));
    appendFileSync(
      path,
      `${Array.from({ length: pendingRecordLimit + 1 }, (_, index) =>
        JSON.stringify({
          payload: {
            call_id: `late-${index}`,
            turn_id: `turn-late-${index}`,
            type: "request_user_input",
          },
          type: "event_msg",
        })
      ).join("\n")}\n`
    );
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 350));

    await reconciler.observe(hookEvent(path, "turn-late-0"));
    expect(received).toHaveLength(0);
    await reconciler.observe(
      hookEvent(path, `turn-late-${pendingRecordLimit}`)
    );
    expect(received).toMatchObject([
      {
        event: "InteractionRequested",
        interactionId: `late-${pendingRecordLimit}`,
      },
    ]);
    reconciler.dispose();
  });

  it("权限接受、拒绝、取消都以同一 call_id 立即解除 waiting", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    const turnId = "turn-permission-outcomes";
    await reconciler.observe(hookEvent(path, turnId));
    const cases = [
      {
        callId: "permission-accepted",
        output:
          '{"permissions":{"file_system":{"write":["/tmp"]}},"scope":"turn"}',
        outcome: "accepted",
      },
      {
        callId: "permission-rejected",
        output: '{"permissions":{},"scope":"turn"}',
        outcome: "rejected",
      },
      {
        callId: "permission-cancelled",
        output: "request_permissions was cancelled before receiving a response",
        outcome: "cancelled",
      },
    ] as const;
    appendFileSync(
      path,
      `${cases
        .flatMap(({ callId, output }) => [
          {
            payload: {
              call_id: callId,
              permissions: { file_system: { write: ["/tmp"] } },
              reason: "write",
              turn_id: turnId,
              type: "request_permissions",
            },
            type: "event_msg",
          },
          {
            payload: {
              call_id: callId,
              output,
              type: "function_call_output",
            },
            type: "response_item",
          },
        ])
        .map((line) => JSON.stringify(line))
        .join("\n")}\n`
    );

    await waitForTranscript(() => expect(received).toHaveLength(6));
    expect(
      received
        .filter((event) => event.event === "InteractionResolved")
        .map((event) =>
          "interactionOutcome" in event ? event.interactionOutcome : undefined
        )
    ).toEqual(cases.map(({ outcome }) => outcome));
    expect(
      received.map((event) =>
        "interactionId" in event ? event.interactionId : undefined
      )
    ).toEqual(cases.flatMap(({ callId }) => [callId, callId]));

    const aggregator = createForegroundActivityAggregator();
    aggregator.ingestAgentEvent(hookEvent(path, turnId), {
      evidenceSource: "hook",
      stopAuthority: "advisory",
      turnStartAuthority: "none",
    });
    const statuses: Array<string | undefined> = [];
    for (const event of received) {
      aggregator.ingestAgentEvent(event, {
        evidenceSource: "transcript",
        stopAuthority: "authoritative",
        turnStartAuthority: "none",
      });
      statuses.push(
        (aggregator.snapshot().activities[0] as AgentActivity | undefined)
          ?.status
      );
    }
    expect(statuses).toEqual([
      "waiting",
      "processing",
      "waiting",
      "processing",
      "waiting",
      "processing",
    ]);
    reconciler.dispose();
    aggregator.dispose();
  });

  it("Codex 中断在可信终态解除未响应提问，不伪造 function output", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path, "turn-cancel"));
    appendFileSync(
      path,
      `${[
        {
          payload: { turn_id: "turn-cancel" },
          type: "turn_context",
        },
        {
          payload: {
            call_id: "question-cancel",
            questions: [],
            turn_id: "turn-cancel",
            type: "request_user_input",
          },
          type: "event_msg",
        },
        {
          payload: {
            reason: "interrupted",
            turn_id: "turn-cancel",
            type: "turn_aborted",
          },
          type: "event_msg",
        },
      ]
        .map((line) => JSON.stringify(line))
        .join("\n")}\n`
    );

    await waitForTranscript(() => expect(received).toHaveLength(2));
    expect(received.map((event) => event.event)).toEqual([
      "InteractionRequested",
      "TurnInterrupted",
    ]);
    expect(received).not.toContainEqual(
      expect.objectContaining({ event: "InteractionResolved" })
    );
    reconciler.dispose();
  });

  it("v3 交互上下文对账为标准终态时只保留公共字段", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    const common = {
      actorHint: "subagent" as const,
      agent: "codex" as const,
      agentInstanceId: "worker-1",
      agentType: "researcher",
      kind: "agentEvent" as const,
      metadataBase64: Buffer.from('{"source":"hook"}').toString("base64"),
      nativeState: "waiting",
      panelId: "panel-1",
      parentSessionId: "parent-1",
      pid: 42,
      promptSnippet: "保留这段提示摘要",
      sessionId: "session-1",
      toolName: "Shell",
      toolUseId: "tool-1",
      transcriptPath: path,
      ts: 123,
      v: 3 as const,
      windowId: "1",
    };
    const contexts: AgentHookEventPayload[] = [
      {
        ...common,
        event: "InteractionRequested",
        interactionId: "permission-requested",
        interactionKind: "permission",
        nativeEvent: "PermissionRequest",
        turnId: "turn-requested",
      },
      {
        ...common,
        event: "InteractionResolved",
        interactionId: "permission-resolved",
        interactionKind: "permission",
        interactionOutcome: "accepted",
        nativeEvent: "PermissionResult",
        turnId: "turn-resolved",
      },
    ];

    for (const [index, context] of contexts.entries()) {
      await reconciler.observe(context);
      appendFileSync(
        path,
        `${JSON.stringify({
          type: "event_msg",
          payload: {
            turn_id: context.turnId,
            type: "task_complete",
          },
        })}\n`
      );
      await waitForTranscript(() => expect(received).toHaveLength(index + 1));
    }

    for (const event of received) {
      expect(agentHookEventSchema.safeParse(event).success).toBe(true);
      expect(event).toMatchObject({
        actorHint: "subagent",
        agentInstanceId: "worker-1",
        agentType: "researcher",
        event: "TurnCompleted",
        metadataBase64: common.metadataBase64,
        nativeEvent: "codex.transcript.task_complete",
        nativeState: "waiting",
        panelId: "panel-1",
        parentSessionId: "parent-1",
        pid: 42,
        promptSnippet: "保留这段提示摘要",
        sessionId: "session-1",
        toolName: "Shell",
        toolUseId: "tool-1",
        ts: 123,
        v: 3,
        windowId: "1",
      });
      expect(event).not.toHaveProperty("interactionId");
      expect(event).not.toHaveProperty("interactionKind");
      expect(event).not.toHaveProperty("interactionOutcome");
    }
    reconciler.dispose();
  });

  it("终态先于对应 hook 到达时暂存，注册 turn 上下文后补派发", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path, "turn-existing"));
    appendFileSync(
      path,
      '{"type":"event_msg","payload":{"reason":"interrupted","turn_id":"turn-late-hook","type":"turn_aborted"}}\n'
    );
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));
    expect(received).toHaveLength(0);

    await reconciler.observe(hookEvent(path, "turn-late-hook"));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      event: "TurnInterrupted",
      turnId: "turn-late-hook",
    });
    reconciler.dispose();
  });

  it("首次绑定会回看尾部，补获 watcher 建立前已写入的终态", async () => {
    appendFileSync(
      path,
      '{"type":"event_msg","payload":{"reason":"interrupted","turn_id":"turn-before-observe","type":"turn_aborted"}}\n'
    );
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });

    await reconciler.observe(hookEvent(path, "turn-before-observe"));

    await waitForTranscript(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({
      event: "TurnInterrupted",
      turnId: "turn-before-observe",
    });
    reconciler.dispose();
  });

  it("首次回看忽略历史无 turn_id 终态，不得绑定到当前新回合", async () => {
    appendFileSync(
      path,
      '{"type":"event_msg","payload":{"type":"task_complete"}}\n'
    );
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });

    await reconciler.observe(hookEvent(path, "turn-current"));
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));

    expect(received).toHaveLength(0);
    reconciler.dispose();
  });

  it("同一 turn 出现冲突终态时以 transcript 中第一个终态为准", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path, "turn-conflict"));
    appendFileSync(
      path,
      '{"type":"event_msg","payload":{"reason":"interrupted","turn_id":"turn-conflict","type":"turn_aborted"}}\n' +
        '{"type":"event_msg","payload":{"turn_id":"turn-conflict","type":"task_complete"}}\n'
    );

    await waitForTranscript(() => expect(received).toHaveLength(1));
    expect(received[0]?.event).toBe("TurnInterrupted");
    reconciler.dispose();
  });

  it("缺少 turn_id 的多个终态不会跨回合误去重", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path, "turn-1"));
    const aborted = `${JSON.stringify({
      payload: { reason: "interrupted", type: "turn_aborted" },
      type: "event_msg",
    })}\n`;
    appendFileSync(path, aborted);
    await waitForTranscript(() => expect(received).toHaveLength(1));
    await reconciler.observe(hookEvent(path, "turn-2"));
    appendFileSync(path, aborted);
    await waitForTranscript(() => expect(received).toHaveLength(2));
    reconciler.dispose();
  });

  it("拒绝 Codex sessions 根目录之外的 transcript 路径", async () => {
    const outside = join(dir, "outside.jsonl");
    writeFileSync(outside, '{"type":"session_meta"}\n');
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });

    await reconciler.observe(hookEvent(outside, "turn-outside"));
    appendFileSync(
      outside,
      '{"type":"event_msg","payload":{"type":"task_complete"}}\n'
    );
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));

    expect(received).toHaveLength(0);
    reconciler.dispose();
  });

  it("同一路径并发首次 observe 只创建一个监听并只派发一次", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    const event = hookEvent(path, "turn-concurrent");

    await Promise.all([reconciler.observe(event), reconciler.observe(event)]);
    appendFileSync(
      path,
      '{"type":"event_msg","payload":{"turn_id":"turn-concurrent","type":"task_complete"}}\n'
    );
    await waitForTranscript(() => expect(received).toHaveLength(1));

    reconciler.dispose();
  });

  it("面板释放后停止监听 transcript", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path, "turn-release"));

    reconciler.releasePanel("panel-1", "1");
    appendFileSync(
      path,
      '{"type":"event_msg","payload":{"turn_id":"turn-release","type":"task_complete"}}\n'
    );
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));

    expect(received).toHaveLength(0);
    reconciler.dispose();
  });

  it("并发首次 observe 尚未完成时释放面板，不会晚建 watcher", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });

    const observing = reconciler.observe(hookEvent(path, "turn-race"));
    reconciler.releasePanel("panel-1", "1");
    await observing;
    appendFileSync(
      path,
      '{"type":"event_msg","payload":{"turn_id":"turn-race","type":"task_complete"}}\n'
    );
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));

    expect(received).toHaveLength(0);
    reconciler.dispose();
  });

  it("retain 对账能取消尚在创建中的 inactive panel watcher", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    const observing = reconciler.observe(hookEvent(path, "turn-retain-race"));

    reconciler.releasePanelsWhere(
      (panelId, windowId) => windowId === "1" && panelId === "panel-1"
    );
    await observing;
    appendFileSync(
      path,
      '{"type":"event_msg","payload":{"turn_id":"turn-retain-race","type":"task_complete"}}\n'
    );
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));

    expect(received).toHaveLength(0);
    reconciler.dispose();
  });

  it("同一 transcript 的多个面板独立持有，释放其一不关闭另一方", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await Promise.all([
      reconciler.observe({
        ...hookEvent(path, "turn-a"),
        panelId: "panel-a",
      }),
      reconciler.observe({
        ...hookEvent(path, "turn-b"),
        panelId: "panel-b",
      }),
    ]);

    reconciler.releasePanel("panel-b", "1");
    appendFileSync(
      path,
      '{"type":"event_msg","payload":{"turn_id":"turn-a","type":"task_complete"}}\n'
    );
    await waitForTranscript(() => expect(received).toHaveLength(1));

    expect(received[0]).toMatchObject({
      event: "TurnCompleted",
      panelId: "panel-a",
    });
    reconciler.dispose();
  });

  it("跳过超过 1 MiB 的 transcript 单行后仍能读取终态", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path, "turn-large"));

    appendFileSync(
      path,
      `${JSON.stringify({ payload: "x".repeat(1024 * 1024 + 100) })}\n${JSON.stringify(
        {
          payload: { turn_id: "turn-large", type: "task_complete" },
          type: "event_msg",
        }
      )}\n`
    );
    await waitForTranscript(() => expect(received).toHaveLength(1));

    expect(received[0]?.event).toBe("TurnCompleted");
    reconciler.dispose();
  });

  it("transcript 截断后无 turn_id 的新增终态仍属于增量区间", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path, "turn-truncate"));
    writeFileSync(path, "");
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));
    appendFileSync(
      path,
      '{"type":"event_msg","payload":{"type":"task_complete"}}\n'
    );

    await waitForTranscript(() => expect(received).toHaveLength(1));
    expect(received[0]?.event).toBe("TurnCompleted");
    reconciler.dispose();
  });

  it("截断检测时已存在的无 turn_id 终态仍按历史区间忽略", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    appendFileSync(path, `${"x".repeat(1024)}\n`);
    await reconciler.observe(hookEvent(path, "turn-replaced"));
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));
    writeFileSync(
      path,
      '{"type":"event_msg","payload":{"type":"task_complete"}}\n'
    );

    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));
    expect(received).toHaveLength(0);
    reconciler.dispose();
  });

  it("同一面板切换大量 transcript 时淘汰旧 watcher，不触发 32 项上限", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    let latestPath = path;
    for (let index = 0; index < 40; index += 1) {
      latestPath = join(transcriptRoot, `rollout-${index}.jsonl`);
      writeFileSync(latestPath, '{"type":"session_meta"}\n');
      await reconciler.observe(hookEvent(latestPath, `turn-${index}`));
    }

    appendFileSync(
      latestPath,
      '{"type":"event_msg","payload":{"turn_id":"turn-39","type":"task_complete"}}\n'
    );
    await waitForTranscript(() => expect(received).toHaveLength(1));

    expect(received[0]).toMatchObject({
      event: "TurnCompleted",
      turnId: "turn-39",
    });
    reconciler.dispose();
  });
});
