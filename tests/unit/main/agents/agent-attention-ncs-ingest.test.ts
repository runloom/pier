import { createAgentAttentionService } from "@main/services/agent-attention/service.ts";
import { DEFAULT_AGENT_ATTENTION_SETTINGS } from "@shared/contracts/agent/attention.ts";
import { makeAgentRef } from "@shared/contracts/agent/runtime-index.ts";
import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
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
  const ingestNotification = vi.fn<(r: NotificationReport) => void>();

  beforeEach(() => {
    ingestNotification.mockClear();
  });

  function createService(
    settings: Partial<typeof DEFAULT_AGENT_ATTENTION_SETTINGS> = {}
  ) {
    return createAgentAttentionService({
      ingestNotification,
      resolveLocale: () => "en",
      settings: () => ({ ...DEFAULT_AGENT_ATTENTION_SETTINGS, ...settings }),
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
        body: "Claude — Awaiting confirmation or your next step",
        dedupeKey: `agent.attention:waiting:${agentRef}`,
        kind: "agent.attention",
        panelRef: { panelId: "p1" },
        severity: "warning",
        source: "agent-attention",
        title: "Needs you",
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
        actions: [
          {
            id: "focus-panel",
            labelKey: "notificationsCenter.action.openAgent",
          },
        ],
        body: "Claude — Ready for your next message",
        dedupeKey: `agent.turn-finished:${agentRef}`,
        kind: "agent.turn-finished",
        severity: "info",
        title: "Turn finished",
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

  it("focus does not block inbox ingest (DeliveryPlan silences interrupt)", async () => {
    const service = createService();
    await service.observe(null, {
      activities: [agent({ panelId: "p1", status: "waiting", windowId: "11" })],
      ts: 1,
    });
    expect(ingestNotification).toHaveBeenCalledTimes(1);
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

  it("re-entry always re-ingests; OS cooldown lives in NCS", async () => {
    const service = createService({ cooldownMs: 180_000 });
    const ready = {
      activities: [agent({ panelId: "p1", status: "ready", windowId: "11" })],
      ts: 2,
    };
    await service.observe(null, {
      activities: [agent({ panelId: "p1", status: "waiting", windowId: "11" })],
      ts: 1,
    });
    await service.observe(null, ready);
    await service.observe(ready, {
      activities: [agent({ panelId: "p1", status: "waiting", windowId: "11" })],
      ts: 3,
    });

    expect(ingestNotification).toHaveBeenCalledTimes(2);
  });
});
