import { formatAttentionNotificationCopy } from "@main/services/agent-attention/notification-copy.ts";
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

describe("formatAttentionNotificationCopy", () => {
  it("localizes waiting and error bodies", () => {
    const waiting = agent({
      panelId: "p1",
      status: "waiting",
      windowId: "1",
    });
    expect(formatAttentionNotificationCopy(waiting, "zh-CN").body).toContain(
      "等待确认"
    );
    expect(formatAttentionNotificationCopy(waiting, "en").body).toContain(
      "awaiting confirmation"
    );

    const errored = agent({
      panelId: "p1",
      status: "error",
      windowId: "1",
    });
    expect(formatAttentionNotificationCopy(errored, "zh-CN").body).toContain(
      "出错了"
    );
  });

  it("localizes ready bodies", () => {
    const ready = agent({ panelId: "p1", status: "ready", windowId: "1" });
    expect(formatAttentionNotificationCopy(ready, "zh-CN").body).toContain(
      "回合已完成"
    );
    expect(formatAttentionNotificationCopy(ready, "en").body).toContain(
      "finished a turn"
    );
  });
});

describe("agent attention service (classify → NCS ingest only)", () => {
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

  it("ingests waiting edge with focus-panel action", async () => {
    const service = createService();
    await service.observe(null, {
      activities: [agent({ panelId: "p1", status: "waiting", windowId: "11" })],
      ts: 1,
    });

    const agentRef = makeAgentRef("11", "p1");
    expect(ingestNotification).toHaveBeenCalledTimes(1);
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
        body: "Claude is awaiting confirmation",
        dedupeKey: `agent.attention:waiting:${agentRef}`,
        kind: "agent.attention",
        panelRef: { panelId: "p1" },
        severity: "warning",
        source: "agent-attention",
        trigger: "system-event",
      })
    );
  });

  it("still ingests when target panel is focused (silence is NCS plan)", async () => {
    const service = createService();
    await service.observe(null, {
      activities: [agent({ panelId: "p1", status: "waiting", windowId: "11" })],
      ts: 1,
    });
    expect(ingestNotification).toHaveBeenCalledTimes(1);
  });

  it("does not re-ingest while staying in waiting", async () => {
    const service = createService();
    const snap = {
      activities: [
        agent({ panelId: "p1", status: "waiting" as const, windowId: "11" }),
      ],
      ts: 1,
    };
    await service.observe(null, snap);
    await service.observe(snap, { ...snap, ts: 2 });
    expect(ingestNotification).toHaveBeenCalledTimes(1);
  });

  it("does not ingest on error by default", async () => {
    const service = createService();
    await service.observe(null, {
      activities: [agent({ panelId: "p1", status: "error", windowId: "11" })],
      ts: 1,
    });
    expect(ingestNotification).not.toHaveBeenCalled();
  });

  it("ingests error when enableErrorAttention is true", async () => {
    const service = createService({ enableErrorAttention: true });
    await service.observe(null, {
      activities: [agent({ panelId: "p1", status: "error", windowId: "11" })],
      ts: 1,
    });
    expect(ingestNotification).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "agent.attention", severity: "error" })
    );
  });

  it("skips waiting when enabled is false", async () => {
    const service = createService({ enabled: false });
    await service.observe(null, {
      activities: [agent({ panelId: "p1", status: "waiting", windowId: "11" })],
      ts: 1,
    });
    expect(ingestNotification).not.toHaveBeenCalled();
  });

  it("does not re-ingest waiting→error when both in trigger set", async () => {
    const service = createService({ enableErrorAttention: true });
    await service.observe(null, {
      activities: [agent({ panelId: "p1", status: "waiting", windowId: "11" })],
      ts: 1,
    });
    expect(ingestNotification).toHaveBeenCalledTimes(1);

    await service.observe(
      {
        activities: [
          agent({ panelId: "p1", status: "waiting", windowId: "11" }),
        ],
        ts: 1,
      },
      {
        activities: [agent({ panelId: "p1", status: "error", windowId: "11" })],
        ts: 2,
      }
    );
    expect(ingestNotification).toHaveBeenCalledTimes(1);
  });

  it("ingests processing→ready when turnNotifyMode is unfocused", async () => {
    const service = createService({ turnNotifyMode: "unfocused" });
    await service.observe(
      {
        activities: [
          agent({ panelId: "p1", windowId: "1", status: "processing" }),
        ],
        ts: 1,
      },
      {
        activities: [agent({ panelId: "p1", windowId: "1", status: "ready" })],
        ts: 2,
      }
    );
    expect(ingestNotification).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "agent.turn-finished", severity: "info" })
    );
  });

  it("does not ingest ready when turnNotifyMode is off", async () => {
    const service = createService({ turnNotifyMode: "off" });
    await service.observe(
      {
        activities: [
          agent({ panelId: "p1", windowId: "1", status: "processing" }),
        ],
        ts: 1,
      },
      {
        activities: [agent({ panelId: "p1", windowId: "1", status: "ready" })],
        ts: 2,
      }
    );
    expect(ingestNotification).not.toHaveBeenCalled();
  });

  it("ingests ready even when turnNotifyMode is always", async () => {
    const service = createService({ turnNotifyMode: "always" });
    await service.observe(
      {
        activities: [
          agent({ panelId: "p1", windowId: "1", status: "processing" }),
        ],
        ts: 1,
      },
      {
        activities: [agent({ panelId: "p1", windowId: "1", status: "ready" })],
        ts: 2,
      }
    );
    expect(ingestNotification).toHaveBeenCalledTimes(1);
  });
});
