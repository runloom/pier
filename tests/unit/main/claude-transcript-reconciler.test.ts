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
import type { TranscriptTitleRecord } from "../../../src/main/services/agents/integrations/transcript-tail-reconciler.ts";

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

interface TitleCapture {
  panelId: string;
  record: TranscriptTitleRecord;
}

/** Claude transcript 里的标题行（sessionId 默认与 hookEvent 一致）。 */
function titleLine(fields: Record<string, unknown>): string {
  return `${JSON.stringify({ sessionId: "session-1", ...fields })}\n`;
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

  it("读出 provider 自己生成的会话名（ai-title）", async () => {
    const titles: TitleCapture[] = [];
    const reconciler = createClaudeTranscriptReconciler({
      onTerminalEvent: () => undefined,
      onTitleRecord: ({ context, record }) =>
        titles.push({ panelId: context.panelId, record }),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path));
    appendFileSync(
      path,
      titleLine({ aiTitle: "标题分层重构", type: "ai-title" })
    );

    await vi.waitFor(() => expect(titles).toHaveLength(1));
    expect(titles[0]).toEqual({
      panelId: "panel-1",
      record: {
        nativeEvent: "claude.transcript.ai_title",
        sessionId: "session-1",
        title: "标题分层重构",
      },
    });
    reconciler.dispose();
  });

  it("不收 custom-title / agent-name（那是 Pier 自己双写回去的 prompt 派生）", async () => {
    // 实测这两种记录装的就是我方 derive-claude-session-title 写回的标题，
    // 逐字相同（含 `…` 截断标记）。收下等于把自己的截断洗成更高的 provider
    // 秩；又因为它们先到，同秩不覆盖会把随后真正的 ai-title 永久挡在门外。
    const titles: TitleCapture[] = [];
    const reconciler = createClaudeTranscriptReconciler({
      onTerminalEvent: () => undefined,
      onTitleRecord: ({ context, record }) =>
        titles.push({ panelId: context.panelId, record }),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path));
    appendFileSync(
      path,
      `${titleLine({
        customTitle:
          "1、 打包后 app 打开对应的 canvas文件报错 2、当前项目 canv…",
        type: "custom-title",
      })}${titleLine({ agentName: "·", type: "agent-name" })}`
    );
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));
    expect(titles).toHaveLength(0);

    // 回声之后真正的 ai-title 仍然能拿到 provider 秩空槽。
    appendFileSync(
      path,
      titleLine({
        aiTitle: "Canvas 打包报错和 demo 场景示例",
        type: "ai-title",
      })
    );
    await vi.waitFor(() => expect(titles).toHaveLength(1));
    expect(titles[0]?.record.title).toBe("Canvas 打包报错和 demo 场景示例");
    reconciler.dispose();
  });

  it("每回合重写的同值 ai-title 只递一次", async () => {
    const titles: TitleCapture[] = [];
    const reconciler = createClaudeTranscriptReconciler({
      onTerminalEvent: () => undefined,
      onTitleRecord: ({ context, record }) =>
        titles.push({ panelId: context.panelId, record }),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path));
    const line = titleLine({ aiTitle: "标题分层重构", type: "ai-title" });
    appendFileSync(path, `${line}${line}${line}`);

    await vi.waitFor(() => expect(titles).toHaveLength(1));
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 200));
    expect(titles).toHaveLength(1);
    reconciler.dispose();
  });

  it("观察前已存在的历史标题不回放（旧标题不得占空槽）", async () => {
    appendFileSync(path, titleLine({ aiTitle: "旧标题", type: "ai-title" }));
    const titles: TitleCapture[] = [];
    const reconciler = createClaudeTranscriptReconciler({
      onTerminalEvent: () => undefined,
      onTitleRecord: ({ context, record }) =>
        titles.push({ panelId: context.panelId, record }),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path));
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));

    expect(titles).toHaveLength(0);
    reconciler.dispose();
  });

  it("多面板持有同一 transcript 时按会话号认领标题", async () => {
    const titles: TitleCapture[] = [];
    const reconciler = createClaudeTranscriptReconciler({
      onTerminalEvent: () => undefined,
      onTitleRecord: ({ context, record }) =>
        titles.push({ panelId: context.panelId, record }),
      transcriptRoot,
    });
    await Promise.all([
      reconciler.observe(
        hookEvent(path, { panelId: "panel-a", sessionId: "session-a" })
      ),
      reconciler.observe(
        hookEvent(path, { panelId: "panel-b", sessionId: "session-b" })
      ),
    ]);
    appendFileSync(
      path,
      titleLine({
        aiTitle: "属于 b 的标题",
        sessionId: "session-b",
        type: "ai-title",
      })
    );

    await vi.waitFor(() => expect(titles).toHaveLength(1));
    expect(titles[0]?.panelId).toBe("panel-b");
    reconciler.dispose();
  });

  it("多面板且会话号对不上时放弃标题（不猜）", async () => {
    const titles: TitleCapture[] = [];
    const reconciler = createClaudeTranscriptReconciler({
      onTerminalEvent: () => undefined,
      onTitleRecord: ({ context, record }) =>
        titles.push({ panelId: context.panelId, record }),
      transcriptRoot,
    });
    await Promise.all([
      reconciler.observe(
        hookEvent(path, { panelId: "panel-a", sessionId: "session-a" })
      ),
      reconciler.observe(
        hookEvent(path, { panelId: "panel-b", sessionId: "session-b" })
      ),
    ]);
    appendFileSync(
      path,
      titleLine({
        aiTitle: "无主标题",
        sessionId: "session-zzz",
        type: "ai-title",
      })
    );
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 300));

    expect(titles).toHaveLength(0);
    reconciler.dispose();
  });

  it("空标题与坏行不递，也不影响终态对账", async () => {
    const received: AgentHookEventPayload[] = [];
    const titles: TitleCapture[] = [];
    const reconciler = createClaudeTranscriptReconciler({
      onTerminalEvent: (event) => received.push(event),
      onTitleRecord: ({ context, record }) =>
        titles.push({ panelId: context.panelId, record }),
      transcriptRoot,
    });
    await reconciler.observe(hookEvent(path));
    appendFileSync(
      path,
      `${titleLine({ aiTitle: "   ", type: "ai-title" })}{"type":"ai-title","aiTitle":\n${interruptLine()}`
    );

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(titles).toHaveLength(0);
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
