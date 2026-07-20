import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentHookEventPayload,
  AgentHookEventPayloadV1,
} from "@shared/contracts/agent-session.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClaudeTranscriptReconciler } from "../../../src/main/services/agents/integrations/claude-transcript-reconciler.ts";

function hookEvent(
  transcriptPath: string,
  overrides: Partial<AgentHookEventPayloadV1> = {}
): AgentHookEventPayload {
  return {
    agent: "claude",
    event: "PromptSubmit",
    kind: "agentEvent",
    panelId: "panel-1",
    sessionId: "session-1",
    transcriptPath,
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

describe("claude transcript reconciler", () => {
  let dir: string;
  let path: string;
  let transcriptRoot: string;

  beforeEach(async () => {
    vi.useRealTimers();
    dir = await mkdtemp(join(tmpdir(), "pier-claude-transcript-"));
    transcriptRoot = join(dir, "projects");
    await mkdir(transcriptRoot);
    path = join(transcriptRoot, "session.jsonl");
    writeFileSync(path, '{"type":"summary"}\n');
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it("把主链中断标记对账为 TurnInterrupted", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createClaudeTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path));
    appendFileSync(path, interruptLine());

    await vi.waitFor(() => {
      expect(received).toHaveLength(1);
    });
    expect(received[0]).toMatchObject({
      event: "TurnInterrupted",
      nativeEvent: "claude.transcript.user_interrupt",
      panelId: "panel-1",
      sessionId: "session-1",
      v: 2,
      windowId: "1",
    });
    reconciler.dispose();
  });

  it("工具中中断变体（for tool use）同样对账", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createClaudeTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path));
    appendFileSync(
      path,
      interruptLine("[Request interrupted by user for tool use]")
    );

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]?.event).toBe("TurnInterrupted");
    reconciler.dispose();
  });

  it("sidechain（子代理链）的中断标记不派发", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createClaudeTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path));
    appendFileSync(
      path,
      interruptLine("[Request interrupted by user]", { isSidechain: true })
    );
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));

    expect(received).toHaveLength(0);
    reconciler.dispose();
  });

  it("长文本内嵌标记子串（resume summary/用户粘贴）不算中断", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createClaudeTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path));
    appendFileSync(
      path,
      `${JSON.stringify({
        message: {
          content:
            'Summary: user said "[Request interrupted by user] 注意这里还是不正确"',
          role: "user",
        },
        type: "user",
      })}\n${JSON.stringify({
        message: {
          content: [
            { text: "[Request interrupted by user]", type: "text" },
            { text: "second block", type: "text" },
          ],
          role: "user",
        },
        type: "user",
      })}\n`
    );
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));

    expect(received).toHaveLength(0);
    reconciler.dispose();
  });

  it("观察前已存在的历史中断标记不回放", async () => {
    appendFileSync(path, interruptLine());
    const received: AgentHookEventPayload[] = [];
    const reconciler = createClaudeTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path));
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));

    expect(received).toHaveLength(0);
    reconciler.dispose();
  });

  it("同一 transcript 多面板持有时无回合身份, 不歧义派发", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createClaudeTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await Promise.all([
      reconciler.observe(hookEvent(path, { panelId: "panel-a" })),
      reconciler.observe(hookEvent(path, { panelId: "panel-b" })),
    ]);
    appendFileSync(path, interruptLine());
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));

    expect(received).toHaveLength(0);
    reconciler.dispose();
  });

  it("面板释放后停止监听", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createClaudeTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path));
    reconciler.releasePanel("panel-1", "1");
    appendFileSync(path, interruptLine());
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));

    expect(received).toHaveLength(0);
    reconciler.dispose();
  });

  it("拒绝 projects 根目录之外的 transcript 路径", async () => {
    const outside = join(dir, "outside.jsonl");
    writeFileSync(outside, '{"type":"summary"}\n');
    const received: AgentHookEventPayload[] = [];
    const reconciler = createClaudeTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(outside));
    appendFileSync(outside, interruptLine());
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));

    expect(received).toHaveLength(0);
    reconciler.dispose();
  });

  it("连续两次中断标记各派发一次（无回合身份不误去重）", async () => {
    const received: AgentHookEventPayload[] = [];
    const reconciler = createClaudeTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path));
    appendFileSync(path, interruptLine());
    await vi.waitFor(() => expect(received).toHaveLength(1));
    appendFileSync(path, interruptLine());
    await vi.waitFor(() => expect(received).toHaveLength(2));
    reconciler.dispose();
  });
});
