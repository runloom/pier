/**
 * reconciler 路径 → 未决交互注册表（Task 8 Important 修复）。
 *
 * codex 等 reconciled-only agent 的 InteractionRequested/Resolved 由
 * transcript reconciler 合成，经 onTerminalEvent → agent-hook-event-fanout
 * 投递；本文件用真实 codex reconciler + fan-out + pendingInteractionListener
 * + 注册表锁这条链：合成事件必须登记/清除，且重复投递不破坏登记。
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPendingInteractionRegistry,
  type PendingInteractionRegistry,
  pendingInteractionListener,
} from "@main/services/agent-attention/pending-interactions.ts";
import { createCodexTranscriptReconciler } from "@main/services/agents/integrations/transcript/codex-reconciler.ts";
import {
  notifyAgentHookEventListeners,
  onAgentHookEvent,
} from "@main/services/foreground-activity/agent-hook-event-fanout.ts";
import { makeAgentRef } from "@shared/contracts/agent/runtime-index.ts";
import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AGENT_REF = makeAgentRef("1", "panel-1");

/** Full-suite load can delay fs.watch; keep waits above default 1s. */
const TRANSCRIPT_WAIT_MS = 5000;

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

function requestedEvent(interactionId: string): AgentHookEventPayload {
  return {
    agent: "codex",
    event: "InteractionRequested",
    interactionId,
    interactionKind: "question",
    kind: "agentEvent",
    nativeEvent: "codex.transcript.request_user_input",
    panelId: "panel-1",
    sessionId: "session-1",
    turnId: "turn-dup",
    v: 3,
    windowId: "1",
  };
}

function resolvedEvent(interactionId: string): AgentHookEventPayload {
  return {
    agent: "codex",
    event: "InteractionResolved",
    interactionId,
    interactionKind: "question",
    interactionOutcome: "completed",
    kind: "agentEvent",
    nativeEvent: "codex.transcript.request_user_input.output",
    panelId: "panel-1",
    sessionId: "session-1",
    turnId: "turn-dup",
    v: 3,
    windowId: "1",
  };
}

describe("reconciler 路径 → 未决交互注册表", () => {
  let dir: string;
  let transcriptPath: string;
  let transcriptRoot: string;
  let registry: PendingInteractionRegistry;
  let unsubscribe: () => void;

  beforeEach(async () => {
    vi.useRealTimers();
    dir = await mkdtemp(join(tmpdir(), "pier-pending-interaction-fanout-"));
    transcriptRoot = join(dir, "sessions");
    await mkdir(transcriptRoot);
    transcriptPath = join(transcriptRoot, "rollout.jsonl");
    writeFileSync(transcriptPath, '{"type":"session_meta"}\n');
    registry = createPendingInteractionRegistry();
    // 与 registerAgentAttention 同一订阅：严格 v3 + makeAgentRef 组装。
    unsubscribe = onAgentHookEvent(pendingInteractionListener(registry));
  });

  afterEach(async () => {
    unsubscribe();
    await rm(dir, { force: true, recursive: true });
  });

  it("合成 InteractionRequested → 登记；InteractionResolved → 清除", async () => {
    // 与 registerForegroundActivityIpc 的 onTerminalEvent 回调同一接线：
    // reconciler 合成事件先投递旁路 fan-out，再进聚合器。
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: notifyAgentHookEventListeners,
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(transcriptPath, "turn-1"));
    appendFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: "event_msg",
        payload: {
          call_id: "question-1",
          questions: [{ id: "confirm", question: "Continue?" }],
          turn_id: "turn-1",
          type: "request_user_input",
        },
      })}\n`
    );

    await vi.waitFor(
      () => {
        expect(registry.assertCurrent(AGENT_REF, "question-1")).toBe(true);
      },
      { timeout: TRANSCRIPT_WAIT_MS }
    );
    expect(registry.currentInteractionId(AGENT_REF)).toBe("question-1");

    appendFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: "response_item",
        payload: {
          call_id: "question-1",
          output: '{"answers":{"confirm":{"answers":["yes"]}}}',
          type: "function_call_output",
        },
      })}\n`
    );

    await vi.waitFor(
      () => {
        expect(registry.currentInteractionId(AGENT_REF)).toBeUndefined();
      },
      { timeout: TRANSCRIPT_WAIT_MS }
    );
    expect(registry.assertCurrent(AGENT_REF, "question-1")).toBe(false);
    reconciler.dispose();
  });

  it("重复投递不破坏登记：重复 Requested 幂等，重复/陈旧 Resolved 不误清", () => {
    notifyAgentHookEventListeners(requestedEvent("question-1"));
    // 同一事件经 fan-out 重复投递（如双路径交汇）：覆盖语义下幂等。
    notifyAgentHookEventListeners(requestedEvent("question-1"));
    expect(registry.currentInteractionId(AGENT_REF)).toBe("question-1");

    // 陈旧 Resolved（id 不符）不得误清当前登记。
    notifyAgentHookEventListeners(resolvedEvent("question-0"));
    expect(registry.currentInteractionId(AGENT_REF)).toBe("question-1");

    notifyAgentHookEventListeners(resolvedEvent("question-1"));
    expect(registry.currentInteractionId(AGENT_REF)).toBeUndefined();
    // 清除后重复 Resolved 无副作用。
    notifyAgentHookEventListeners(resolvedEvent("question-1"));
    expect(registry.currentInteractionId(AGENT_REF)).toBeUndefined();
  });

  it("reconciler 对重复 transcript 行去重，合成事件只投递一次", async () => {
    const received: AgentHookEventPayload[] = [];
    const unsubscribeTap = onAgentHookEvent((event) => {
      received.push(event);
    });
    const reconciler = createCodexTranscriptReconciler({
      onTerminalEvent: notifyAgentHookEventListeners,
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(transcriptPath, "turn-2"));
    const line = `${JSON.stringify({
      type: "event_msg",
      payload: {
        call_id: "question-2",
        questions: [{ id: "confirm", question: "Continue?" }],
        turn_id: "turn-2",
        type: "request_user_input",
      },
    })}\n`;
    appendFileSync(transcriptPath, line + line);

    await vi.waitFor(
      () => {
        expect(registry.assertCurrent(AGENT_REF, "question-2")).toBe(true);
      },
      { timeout: TRANSCRIPT_WAIT_MS }
    );
    expect(
      received.filter(
        (event) =>
          event.kind === "agentEvent" && event.event === "InteractionRequested"
      )
    ).toHaveLength(1);
    reconciler.dispose();
    unsubscribeTap();
  });
});
