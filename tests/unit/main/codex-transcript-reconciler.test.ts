import { appendFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentHookEventPayload } from "@shared/contracts/agent-session.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCodexTranscriptReconciler } from "../../../src/main/services/agents/integrations/codex-transcript-reconciler.ts";

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

    await vi.waitFor(() => {
      expect(received).toHaveLength(1);
    });
    expect(received[0]).toMatchObject({
      event: "TurnInterrupted",
      nativeEvent: "codex.transcript.turn_aborted",
      panelId: "panel-1",
      turnId: "turn-1",
      v: 2,
      windowId: "1",
    });
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

    await vi.waitFor(() => {
      expect(received).toHaveLength(1);
    });
    expect(received[0]?.event).toBe("TurnCompleted");
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

    await vi.waitFor(() => expect(received).toHaveLength(1));
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

    await vi.waitFor(() => expect(received).toHaveLength(1));
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
    await vi.waitFor(() => expect(received).toHaveLength(1));
    await reconciler.observe(hookEvent(path, "turn-2"));
    appendFileSync(path, aborted);
    await vi.waitFor(() => expect(received).toHaveLength(2));
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
    await vi.waitFor(() => expect(received).toHaveLength(1));

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
    await vi.waitFor(() => expect(received).toHaveLength(1));

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
    await vi.waitFor(() => expect(received).toHaveLength(1));

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

    await vi.waitFor(() => expect(received).toHaveLength(1));
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
    await vi.waitFor(() => expect(received).toHaveLength(1));

    expect(received[0]).toMatchObject({
      event: "TurnCompleted",
      turnId: "turn-39",
    });
    reconciler.dispose();
  });
});
