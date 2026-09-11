import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleObservedAgentHookEvent } from "@main/ipc/foreground-activity/hook-pipeline.ts";
import {
  kimiIntegration,
  withPierKimiHooks,
} from "@main/services/agents/integrations/kimi.ts";
import { resolveAgentEventIngestOptions } from "@main/services/agents/integrations/runtime/event-authority.ts";
import { createKimiTranscriptReconciler } from "@main/services/agents/integrations/transcript/kimi-reconciler.ts";
import { createForegroundActivityAggregator } from "@main/services/foreground-activity/aggregator.ts";
import { enrichAgentEventFromRawPayload } from "@main/services/foreground-activity/jsonl-enrichment.ts";
import {
  type AgentHookEventPayload,
  agentHookEventSchema,
} from "@shared/contracts/agent/session.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstalledCommandProducer } from "../../../agent-integrations/status-traces/installed-command-driver.ts";

describe("Kimi 原生取消的钩子与 main wire 混合轨迹", () => {
  let root: string;
  let path: string;
  let producer: Awaited<ReturnType<typeof createInstalledCommandProducer>>;
  let aggregator: ReturnType<typeof createForegroundActivityAggregator>;
  let reconciler: ReturnType<typeof createKimiTranscriptReconciler>;
  let received: AgentHookEventPayload[];
  let commands: Map<string, string>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pier-kimi-cancel-"));
    const main = join(root, "project", "session-main", "agents", "main");
    await mkdir(main, { recursive: true });
    path = join(main, "wire.jsonl");
    await writeFile(path, "");
    commands = new Map();
    for (const block of withPierKimiHooks("").split("[[hooks]]")) {
      const event = /^event = (.+)$/m.exec(block)?.[1];
      const command = /^command = (.+)$/m.exec(block)?.[1];
      if (event && command)
        commands.set(JSON.parse(event), JSON.parse(command));
    }
    producer = await createInstalledCommandProducer("kimi", commands);
    aggregator = createForegroundActivityAggregator();
    aggregator.agentLaunched("w1", "p1", "kimi");
    received = [];
    reconciler = createKimiTranscriptReconciler({
      sessionsRoots: [root],
      onTerminalEvent: (event) => {
        received.push(event);
        aggregator.ingestAgentEvent(
          event,
          resolveAgentEventIngestOptions({
            event,
            evidenceSource: "transcript",
            runtime: kimiIntegration.runtime,
          })
        );
      },
    });
  });

  afterEach(async () => {
    reconciler.dispose();
    aggregator.dispose();
    await producer.close();
    await rm(root, { recursive: true, force: true });
  });

  async function send(
    nativeEvent: string,
    fields: Record<string, unknown> = {}
  ) {
    // Kimi only invokes installed native hooks; missing Interrupt leaves no event.
    if (!commands.has(nativeEvent)) return;
    const events = await producer.run({
      nativeEvent,
      checkpoints: [],
      expectedNativeEvents: [],
      payload: {
        hook_event_name: nativeEvent,
        session_id: "session-main",
        ...fields,
      },
    });
    for (const raw of events) {
      const event = enrichAgentEventFromRawPayload(
        agentHookEventSchema.parse(raw)
      );
      if (event.kind !== "agentEvent") throw new Error("Expected agent event");
      const observations: Promise<void>[] = [];
      await handleObservedAgentHookEvent(
        {
          aggregator,
          applySessionTitle: async () => {},
          notifyListeners() {},
          observeTranscript: (hook) => {
            const observed = reconciler.observe(hook);
            observations.push(observed);
            return observed;
          },
          recordResume() {},
          resolveRuntime: () => kimiIntegration.runtime,
        },
        event
      );
      await Promise.all(observations);
    }
  }

  const activity = () => aggregator.snapshot().activities[0];
  const wire = (row: Record<string, unknown>) =>
    appendFile(
      path,
      `${JSON.stringify({ agentId: "main", time: Date.now(), ...row })}\n`
    );
  async function begin(turnId: number, step = true, time = Date.now()) {
    await wire({
      type: "turn.prompt",
      origin: { kind: "user" },
      input: [],
      time,
    });
    if (step)
      await wire({
        type: "context.append_loop_event",
        event: { type: "step.begin", turnId: String(turnId) },
        time,
      });
  }
  async function expectInterrupted(turnId: string, count = 1) {
    await vi.waitFor(() =>
      expect(activity()).toMatchObject({
        status: "ready",
        turnResult: "interrupted",
      })
    );
    expect(received).toHaveLength(count);
    expect(received.at(-1)).toMatchObject({ event: "TurnInterrupted", turnId });
  }

  it.each([
    true,
    false,
  ])("第一次工具前原生取消，保留零号回合；已开始模型步骤=%s", async (step) => {
    await send("UserPromptSubmit", { prompt: "work" });
    await begin(0, step);
    await wire({ type: "turn.ended", turnId: 0, reason: "cancelled" });
    await send("Interrupt", { turnId: 0, reason: "cancelled" });
    await expectInterrupted("0");
  });

  it("取消记录晚于 Interrupt 落盘，也能完成对账", async () => {
    await send("UserPromptSubmit", { prompt: "work" });
    const time = Date.now();
    await begin(0, false, time);
    await send("Interrupt", { turnId: 0, reason: "cancelled" });
    expect(activity()).toMatchObject({ status: "processing" });
    await wire({ type: "turn.ended", turnId: 0, reason: "cancelled", time });
    await expectInterrupted("0");
  });

  it.each([
    0, 1,
  ])("子智能体取消（编号 %s）不能结束仍在运行的主回合", async (childTurn) => {
    await send("UserPromptSubmit", { prompt: "work" });
    await begin(0);
    await wire({
      agentId: "child",
      type: "turn.ended",
      turnId: childTurn,
      reason: "cancelled",
    });
    await send("Interrupt", { turnId: childTurn, reason: "cancelled" });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(activity()).toMatchObject({ status: "processing" });
    expect(received).toHaveLength(0);
    await wire({ type: "turn.ended", turnId: 0, reason: "cancelled" });
    await send("Interrupt", { turnId: 0, reason: "cancelled" });
    await expectInterrupted("0");
  });

  it("新提问不能收养工具尚未建立关联的旧回合取消", async () => {
    await send("UserPromptSubmit", { prompt: "old work" });
    await begin(0);
    await send("UserPromptSubmit", { prompt: "new work" });
    await wire({ type: "turn.ended", turnId: 0, reason: "cancelled" });
    await send("Interrupt", { turnId: 0, reason: "cancelled" });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(activity()).toMatchObject({ status: "processing" });
    expect(received).toHaveLength(0);
    await begin(1);
    await wire({ type: "turn.ended", turnId: 1, reason: "cancelled" });
    await send("Interrupt", { turnId: 1, reason: "cancelled" });
    await expectInterrupted("1");
  });

  it("恢复会话时忽略历史取消，下一回合原生取消仍有效", async () => {
    const time = Date.now() - 10_000;
    await begin(0, true, time);
    await wire({ type: "turn.ended", turnId: 0, reason: "cancelled", time });
    await send("SessionStart");
    await send("Interrupt", { turnId: 0, reason: "cancelled" });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(received).toHaveLength(0);
    await send("UserPromptSubmit", { prompt: "new work" });
    await begin(1);
    await wire({ type: "turn.ended", turnId: 1, reason: "cancelled" });
    await send("Interrupt", { turnId: 1, reason: "cancelled" });
    await expectInterrupted("1");
  });

  it("连续回合保留字符串零号身份，重复取消不重复通知", async () => {
    for (const turnId of [0, 1]) {
      await send("UserPromptSubmit", { prompt: "work" });
      await begin(turnId);
      await wire({ type: "turn.ended", turnId, reason: "cancelled" });
      await send("Interrupt", { turnId: String(turnId), reason: "cancelled" });
      await expectInterrupted(String(turnId), turnId + 1);
      await send("Interrupt", { turnId: String(turnId), reason: "cancelled" });
      expect(received).toHaveLength(turnId + 1);
    }
  });

  it("关闭面板后晚到的取消记录不能重建观察或发出结果", async () => {
    await send("UserPromptSubmit", { prompt: "work" });
    const time = Date.now();
    await begin(0, false, time);
    await send("Interrupt", { turnId: 0, reason: "cancelled" });
    reconciler.releasePanel("p1", "w1");
    await wire({ type: "turn.ended", turnId: 0, reason: "cancelled", time });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(received).toHaveLength(0);
  });

  it("迁移面板后晚到的取消记录只发送给新窗口", async () => {
    await send("UserPromptSubmit", { prompt: "work" });
    const time = Date.now();
    await begin(0, false, time);
    await send("Interrupt", { turnId: 0, reason: "cancelled" });
    const transfer = {
      panelId: "p1",
      sourceWindowId: "w1",
      targetWindowId: "w2",
    };
    aggregator.transferPanelOwnership(transfer);
    reconciler.transferPanelOwnership(transfer);
    await wire({ type: "turn.ended", turnId: 0, reason: "cancelled", time });
    await expectInterrupted("0");
    expect(received[0]).toMatchObject({ windowId: "w2" });
  });
});
