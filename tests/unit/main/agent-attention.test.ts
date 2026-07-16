import { createAgentAttentionService } from "@main/services/agent-attention/attention-service.ts";
import { formatAttentionNotificationCopy } from "@main/services/agent-attention/notification-copy.ts";
import {
  AGENT_ATTENTION_KIND,
  DEFAULT_AGENT_ATTENTION_SETTINGS,
} from "@shared/contracts/agent-attention.ts";
import { makeAgentRef } from "@shared/contracts/agent-runtime-index.ts";
import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import type {
  SystemNotificationRequest,
  SystemNotificationResult,
} from "@shared/contracts/notification.ts";
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
});

describe("agent attention service", () => {
  const showNotification = vi.fn(
    async (
      _request: SystemNotificationRequest
    ): Promise<SystemNotificationResult> => ({ shown: true })
  );
  const isTargetPanelFocused = vi.fn(() => false);
  let now = 1000;

  beforeEach(() => {
    showNotification.mockClear();
    showNotification.mockResolvedValue({ shown: true });
    isTargetPanelFocused.mockReset();
    isTargetPanelFocused.mockReturnValue(false);
    now = 1000;
  });

  function createService(
    settings: Partial<typeof DEFAULT_AGENT_ATTENTION_SETTINGS> = {}
  ) {
    return createAgentAttentionService({
      isTargetPanelFocused,
      now: () => now,
      resolveLocale: () => "en",
      settings: () => ({ ...DEFAULT_AGENT_ATTENTION_SETTINGS, ...settings }),
      showNotification,
    });
  }

  it("notifies when entering waiting while unfocused", async () => {
    const service = createService();
    await service.observe(null, {
      activities: [
        agent({
          panelId: "p1",
          status: "waiting",
          windowId: "11",
        }),
      ],
      ts: 1,
    });

    expect(showNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        agentRef: makeAgentRef("11", "p1"),
        body: "Claude is awaiting confirmation",
        kind: AGENT_ATTENTION_KIND,
        tag: `${AGENT_ATTENTION_KIND}:${makeAgentRef("11", "p1")}`,
      })
    );
  });

  it("skips notify when target panel is focused", async () => {
    isTargetPanelFocused.mockReturnValue(true);
    const service = createService();
    await service.observe(null, {
      activities: [agent({ panelId: "p1", status: "waiting", windowId: "11" })],
      ts: 1,
    });
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("respects cooldown for the same agentRef across re-entry", async () => {
    const service = createService({ cooldownMs: 180_000 });
    const enterWaiting = async (ts: number) => {
      await service.observe(
        {
          activities: [
            agent({
              panelId: "p1",
              status: "processing",
              windowId: "11",
            }),
          ],
          ts,
        },
        {
          activities: [
            agent({ panelId: "p1", status: "waiting", windowId: "11" }),
          ],
          ts: ts + 1,
        }
      );
    };

    await enterWaiting(1);
    expect(showNotification).toHaveBeenCalledTimes(1);

    now += 60_000;
    await enterWaiting(10);
    expect(showNotification).toHaveBeenCalledTimes(1);

    now += 130_000;
    await enterWaiting(20);
    expect(showNotification).toHaveBeenCalledTimes(2);
  });

  it("does not re-notify while staying in waiting", async () => {
    const service = createService();
    const snap = {
      activities: [
        agent({ panelId: "p1", status: "waiting" as const, windowId: "11" }),
      ],
      ts: 1,
    };
    await service.observe(null, snap);
    await service.observe(snap, { ...snap, ts: 2 });
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it("does not notify on error by default", async () => {
    const service = createService();
    await service.observe(null, {
      activities: [agent({ panelId: "p1", status: "error", windowId: "11" })],
      ts: 1,
    });
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("notifies on error when enableErrorAttention is true", async () => {
    const service = createService({ enableErrorAttention: true });
    await service.observe(null, {
      activities: [agent({ panelId: "p1", status: "error", windowId: "11" })],
      ts: 1,
    });
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it("does not record cooldown when shown is false", async () => {
    showNotification.mockResolvedValue({
      reason: "denied",
      shown: false,
    });
    const service = createService({ cooldownMs: 180_000 });
    const waiting = {
      activities: [
        agent({ panelId: "p1", status: "waiting" as const, windowId: "11" }),
      ],
      ts: 1,
    };
    await service.observe(
      {
        activities: [
          agent({
            panelId: "p1",
            status: "processing",
            windowId: "11",
          }),
        ],
        ts: 1,
      },
      waiting
    );
    expect(service.lastNotifiedAt(makeAgentRef("11", "p1"))).toBeUndefined();

    showNotification.mockResolvedValue({ shown: true });
    now += 10;
    await service.observe(
      {
        activities: [
          agent({
            panelId: "p1",
            status: "processing",
            windowId: "11",
          }),
        ],
        ts: 2,
      },
      { ...waiting, ts: 3 }
    );
    expect(showNotification).toHaveBeenCalledTimes(2);
  });

  it("skips notify when enabled is false", async () => {
    const service = createService({ enabled: false });
    await service.observe(null, {
      activities: [agent({ panelId: "p1", status: "waiting", windowId: "11" })],
      ts: 1,
    });
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("notifies even when focused if suppressWhenFocused is false", async () => {
    isTargetPanelFocused.mockReturnValue(true);
    const service = createService({ suppressWhenFocused: false });
    await service.observe(null, {
      activities: [agent({ panelId: "p1", status: "waiting", windowId: "11" })],
      ts: 1,
    });
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it("does not re-notify waiting→error when both in trigger set", async () => {
    const service = createService({ enableErrorAttention: true });
    await service.observe(null, {
      activities: [agent({ panelId: "p1", status: "waiting", windowId: "11" })],
      ts: 1,
    });
    expect(showNotification).toHaveBeenCalledTimes(1);

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
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it("does not re-notify error→waiting when both in trigger set", async () => {
    const service = createService({ enableErrorAttention: true });
    await service.observe(null, {
      activities: [agent({ panelId: "p1", status: "error", windowId: "11" })],
      ts: 1,
    });
    expect(showNotification).toHaveBeenCalledTimes(1);

    await service.observe(
      {
        activities: [agent({ panelId: "p1", status: "error", windowId: "11" })],
        ts: 1,
      },
      {
        activities: [
          agent({ panelId: "p1", status: "waiting", windowId: "11" }),
        ],
        ts: 2,
      }
    );
    expect(showNotification).toHaveBeenCalledTimes(1);
  });
});
