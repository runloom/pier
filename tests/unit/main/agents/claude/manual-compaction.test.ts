import {
  CLAUDE_HOOK_EVENTS,
  claudeIntegration,
} from "@main/services/agents/integrations/claude.ts";
import { resolveAgentEventIngestOptions } from "@main/services/agents/integrations/runtime/event-authority.ts";
import { createForegroundActivityAggregator } from "@main/services/foreground-activity/aggregator.ts";
import { enrichAgentEventFromRawPayload } from "@main/services/foreground-activity/jsonl-enrichment.ts";
import { agentHookEventSchema } from "@shared/contracts/agent/session.ts";
import type { AgentActivity } from "@shared/contracts/foreground-activity.ts";
import { describe, expect, it } from "vitest";
import { createNestedHookCommandProducer } from "../../../agent-integrations/status-traces/hook-command-driver.ts";

const TURN = "11111111-1111-4111-8111-111111111111";
const COMPACT = "22222222-2222-4222-8222-222222222222";
const NEXT = "33333333-3333-4333-8333-333333333333";

async function setup() {
  const producer = await createNestedHookCommandProducer(
    "claude",
    CLAUDE_HOOK_EVENTS
  );
  const aggregator = createForegroundActivityAggregator();
  async function send(
    nativeEvent: string,
    fields: Record<string, unknown> = {}
  ) {
    const raws = await producer.run({
      nativeEvent,
      checkpoints: [],
      expectedNativeEvents: [],
      payload: {
        hook_event_name: nativeEvent,
        session_id: "main",
        prompt_id: COMPACT,
        trigger: "manual",
        ...fields,
      },
    });
    return raws.map((raw) => {
      const parsed = agentHookEventSchema.parse(raw);
      if (parsed.kind !== "agentEvent") throw new Error("Expected agent event");
      const event = enrichAgentEventFromRawPayload(parsed);
      if (event.kind !== "agentEvent")
        throw new Error("Expected enriched agent event");
      return aggregator.ingestAgentEvent(
        event,
        resolveAgentEventIngestOptions({
          evidenceSource: "hook",
          event,
          runtime: claudeIntegration.runtime,
        })
      );
    });
  }
  await send("UserPromptSubmit", { prompt: "work", prompt_id: TURN });
  return {
    activity: () => aggregator.snapshot().activities[0] as AgentActivity,
    close: async () => {
      aggregator.dispose();
      await producer.close();
    },
    send,
  };
}

describe("Claude 手动压缩的实际钩子命令轨迹", () => {
  it("维护载荷即使复用用户 prompt ID，也不能借回合认领路由跨会话完成", async () => {
    const { activity, close, send } = await setup();
    try {
      await send("PreCompact", { prompt_id: TURN });
      expect(
        await send("PostCompact", { session_id: "foreign", prompt_id: TURN })
      ).toEqual([false]);
      expect(activity().status).toBe("processing");
      await send("PostCompact", { prompt_id: TURN });
      expect(activity().status).toBe("ready");
    } finally {
      await close();
    }
  });

  it("独立 compact ID 成功结束时回到 ready，不结算先前用户回合", async () => {
    const { activity, close, send } = await setup();
    try {
      await send("PreCompact");
      await send("SubagentStop", {
        agent_id: "summarizer",
        background_tasks: [],
        session_crons: [],
      });
      await send("SessionStart", { source: "compact" });
      await send("PostCompact", { compact_summary: "summary" });
      expect(activity().status).toBe("ready");
      expect(activity()).not.toHaveProperty("turnResult");
      await send("PreToolUse", {
        prompt_id: TURN,
        tool_name: "Read",
        tool_use_id: "tool-a",
      });
      expect(activity().status).toBe("tool");
    } finally {
      await close();
    }
  });

  it("只有 PreCompact 的提前中止不把原本空闲的会话改成忙碌", async () => {
    const { activity, close, send } = await setup();
    try {
      await send("Notification", {
        notification_type: "idle_prompt",
        prompt_id: TURN,
      });
      expect(activity().status).toBe("ready");
      await send("PreCompact");
      expect(activity().status).toBe("ready");
    } finally {
      await close();
    }
  });

  it("自动压缩保留原回合与忙碌状态，不让压缩 ID 抢占用户回合", async () => {
    const { activity, close, send } = await setup();
    try {
      await send("PreCompact", { trigger: "auto" });
      await send("SessionStart", { source: "compact" });
      await send("PostCompact", { trigger: "auto" });
      expect(activity().status).toBe("processing");
      expect(
        await send("PreToolUse", {
          prompt_id: TURN,
          tool_name: "Read",
          tool_use_id: "tool-a",
        })
      ).toEqual([true]);
      expect(activity().status).toBe("tool");
    } finally {
      await close();
    }
  });

  it("新提问或新工具进展会使旧压缩收尾失效", async () => {
    for (const newWork of ["prompt", "tool"]) {
      const { activity, close, send } = await setup();
      try {
        await send("PreCompact");
        if (newWork === "prompt")
          await send("UserPromptSubmit", {
            prompt_id: NEXT,
            prompt: "new work",
          });
        else
          await send("PreToolUse", {
            prompt_id: TURN,
            tool_name: "Read",
            tool_use_id: "tool-a",
          });
        expect(await send("PostCompact")).toEqual([false]);
        expect(activity().status).toBe(
          newWork === "prompt" ? "processing" : "tool"
        );
      } finally {
        await close();
      }
    }
  });

  it("孤立、重复、其他会话及子智能体的收尾不能改变主状态", async () => {
    const { activity, close, send } = await setup();
    try {
      expect(await send("PostCompact")).toEqual([false]);
      await send("PreCompact");
      expect(await send("PostCompact", { session_id: "foreign" })).toEqual([
        false,
      ]);
      expect(await send("PostCompact", { agent_id: "child" })).toEqual([false]);
      expect(activity().status).toBe("processing");
      await send("PostCompact");
      expect(activity().status).toBe("ready");
      expect(await send("PostCompact")).toEqual([false]);
    } finally {
      await close();
    }
  });

  it("压缩结束保留仍活跃的后台工具", async () => {
    const { activity, close, send } = await setup();
    try {
      await send("PreToolUse", {
        prompt_id: TURN,
        tool_name: "Bash",
        tool_use_id: "background",
      });
      await send("PreCompact");
      await send("PostCompact");
      expect(activity().status).toBe("tool");
      await send("PostToolUse", {
        prompt_id: TURN,
        tool_name: "Bash",
        tool_use_id: "background",
      });
      expect(activity().status).toBe("ready");
      expect(activity()).not.toHaveProperty("turnResult");
    } finally {
      await close();
    }
  });
});
