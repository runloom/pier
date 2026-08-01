import { createAgentAttentionService } from "@main/services/agent-attention/service.ts";
import { DEFAULT_AGENT_ATTENTION_SETTINGS } from "@shared/contracts/agent/attention.ts";
import { makeAgentRef } from "@shared/contracts/agent/runtime-index.ts";
import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import type {
  SystemNotificationRequest,
  SystemNotificationResult,
} from "@shared/contracts/notification.ts";
import type { NotificationReport } from "@shared/contracts/notification-center.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

function agent(
  overrides: Partial<Extract<ForegroundActivity, { kind: "agent" }>> & {
    panelId: string;
    windowId: string;
  }
): Extract<ForegroundActivity, { kind: "agent" }> {
  return {
    agentId: "claude",
    kind: "agent",
    source: "hook",
    spawnedAt: 1,
    subagentCount: 0,
    updatedAt: 10,
    ...overrides,
  };
}

describe("agent-attention → NCS ingest", () => {
  const showNotification = vi.fn(
    async (
      _request: SystemNotificationRequest,
      _audio?: { silent?: boolean; sound?: string }
    ): Promise<SystemNotificationResult> => ({ shown: true })
  );
  const ingestNotification = vi.fn<(r: NotificationReport) => void>();
  const isTargetPanelFocused = vi.fn(() => false);
  const isOwnerWindowFocused = vi.fn(() => false);
  let now = 1000;

  beforeEach(() => {
    showNotification.mockClear();
    ingestNotification.mockClear();
    isTargetPanelFocused.mockReset().mockReturnValue(false);
    isOwnerWindowFocused.mockReset().mockReturnValue(false);
    now = 1000;
  });

  function createService(
    settings: Partial<typeof DEFAULT_AGENT_ATTENTION_SETTINGS> = {}
  ) {
    return createAgentAttentionService({
      ingestNotification,
      isTargetPanelFocused,
      isOwnerWindowFocused,
      now: () => now,
      resolveLocale: () => "en",
      settings: () => ({ ...DEFAULT_AGENT_ATTENTION_SETTINGS, ...settings }),
      showNotification,
    });
  }

  it("waiting edge → agent.attention inbox entry with focus-panel action", async () => {
    const service = createService();
    await service.observe(null, {
      activities: [agent({ panelId: "p1", status: "waiting", windowId: "11" })],
      ts: 1,
    });

    expect(ingestNotification).toHaveBeenCalledTimes(1);
    const agentRef = makeAgentRef("11", "p1");
    expect(ingestNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        actionParams: { agentRef },
        actions: [
          {
            id: "focus-panel",
            labelKey: "notificationsCenter.action.goToAgent",
          },
        ],
        agentRef,
        dedupeKey: `agent.attention:waiting:${agentRef}`,
        kind: "agent.attention",
        panelRef: { panelId: "p1" },
        severity: "warning",
        source: "agent-attention",
        trigger: "system-event",
      })
    );
  });

  it("turn finished edge → agent.turn-finished (info)", async () => {
    const service = createService();
    const processing = {
      activities: [
        agent({ panelId: "p1", status: "processing" as const, windowId: "11" }),
      ],
      ts: 1,
    };
    await service.observe(null, processing);
    await service.observe(processing, {
      activities: [agent({ panelId: "p1", status: "ready", windowId: "11" })],
      ts: 2,
    });

    const agentRef = makeAgentRef("11", "p1");
    expect(ingestNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: `agent.turn-finished:${agentRef}`,
        kind: "agent.turn-finished",
        severity: "info",
      })
    );
  });

  it("error edge → severity error (enableErrorAttention)", async () => {
    const service = createService({ enableErrorAttention: true });
    await service.observe(null, {
      activities: [agent({ panelId: "p1", status: "error", windowId: "11" })],
      ts: 1,
    });
    expect(ingestNotification).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "agent.attention", severity: "error" })
    );
  });

  it("focus-suppressed events do not reach inbox", async () => {
    isTargetPanelFocused.mockReturnValue(true);
    const service = createService();
    await service.observe(null, {
      activities: [agent({ panelId: "p1", status: "waiting", windowId: "11" })],
      ts: 1,
    });
    expect(ingestNotification).not.toHaveBeenCalled();
  });

  it("turnNotifyMode=off records nothing for turn finished", async () => {
    const service = createService({ turnNotifyMode: "off" });
    const processing = {
      activities: [
        agent({ panelId: "p1", status: "processing" as const, windowId: "11" }),
      ],
      ts: 1,
    };
    await service.observe(null, processing);
    await service.observe(processing, {
      activities: [agent({ panelId: "p1", status: "ready", windowId: "11" })],
      ts: 2,
    });
    expect(ingestNotification).not.toHaveBeenCalled();
  });

  it("cooldown blocks OS notify but inbox still records (NCS dedupes)", async () => {
    const service = createService({ cooldownMs: 180_000 });
    const enterWaiting = async (ts: number) => {
      await service.observe(null, {
        activities: [
          agent({ panelId: "p1", status: "waiting", windowId: "11" }),
        ],
        ts,
      });
    };
    await enterWaiting(1);
    // 离开 waiting（面板短暂 ready 后再进 waiting 才会再次触发边沿；
    // 这里直接第二次观察同一快照不会重分类——用 ready → waiting 制造二次边沿）
    const ready = {
      activities: [agent({ panelId: "p1", status: "ready", windowId: "11" })],
      ts: 2,
    };
    await service.observe(null, ready);
    now += 1000;
    await service.observe(ready, {
      activities: [agent({ panelId: "p1", status: "waiting", windowId: "11" })],
      ts: 3,
    });

    expect(ingestNotification).toHaveBeenCalledTimes(2);
    // 第二次在冷却窗内：OS 通知只发一次
    const waitingCalls = showNotification.mock.calls.filter(([request]) =>
      request.kind?.includes("agent.attention")
    );
    expect(waitingCalls).toHaveLength(1);
  });
});
