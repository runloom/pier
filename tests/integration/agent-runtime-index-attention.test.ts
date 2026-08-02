import { createAgentAttentionService } from "@main/services/agent-attention/service.ts";
import { createAgentRuntimeIndexService } from "@main/services/agent-runtime-index/index.ts";
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

describe("agent runtime index + attention integration", () => {
  const ingestNotification = vi.fn<(r: NotificationReport) => void>();

  beforeEach(() => {
    ingestNotification.mockClear();
  });

  it("ingests waiting; focusWaiting still orders needs-you first", async () => {
    const activities = [
      agent({
        panelId: "ready",
        status: "ready",
        updatedAt: 1,
        windowId: "11",
      }),
      agent({
        panelId: "wait",
        status: "waiting",
        updatedAt: 9,
        windowId: "22",
      }),
    ];
    const index = createAgentRuntimeIndexService({
      snapshot: () => ({ activities, ts: 3 }),
      rendererCommand: {
        execute: vi.fn(async () => ({
          data: null,
          ok: true as const,
          requestId: "r1",
        })),
        resolve: () => undefined,
      },
      resolveInternalWindowId: (id) => `internal-${id}`,
    });

    const attention = createAgentAttentionService({
      ingestNotification,
      resolveLocale: () => "en",
    });

    await attention.observe(null, { activities, ts: 3 });
    expect(ingestNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        agentRef: makeAgentRef("22", "wait"),
        kind: "agent.attention",
      })
    );

    // 再次进入 waiting：仍会 ingest（打断静音由 NCS plan 负责）
    ingestNotification.mockClear();
    await attention.observe(
      {
        activities: [
          agent({
            panelId: "wait",
            status: "processing",
            windowId: "22",
          }),
        ],
        ts: 4,
      },
      {
        activities: [
          agent({
            panelId: "wait",
            status: "waiting",
            windowId: "22",
          }),
        ],
        ts: 5,
      }
    );
    expect(ingestNotification).toHaveBeenCalledTimes(1);

    const listed = index.listMachine({ preferredWindowId: "11" });
    expect(listed.entries[0]?.panelId).toBe("wait");
    await expect(index.focusWaiting()).resolves.toEqual({ status: "ok" });
  });

  it("ingests turn-end ready when unfocused, not on first projection or default error", async () => {
    const attention = createAgentAttentionService({
      ingestNotification,
    });
    // 首次投影（boot / 新面板）即 ready 或 error：不通知。
    await attention.observe(null, {
      activities: [
        agent({ panelId: "r", status: "ready", windowId: "1" }),
        agent({ panelId: "e", status: "error", windowId: "1" }),
      ],
      ts: 1,
    });
    expect(ingestNotification).not.toHaveBeenCalled();

    // 真实回合结束边沿 processing→ready：ingest；error 默认关不 ingest。
    await attention.observe(
      {
        activities: [
          agent({ panelId: "r", status: "processing", windowId: "1" }),
          agent({ panelId: "e", status: "processing", windowId: "1" }),
        ],
        ts: 2,
      },
      {
        activities: [
          agent({ panelId: "r", status: "ready", windowId: "1" }),
          agent({ panelId: "e", status: "error", windowId: "1" }),
        ],
        ts: 3,
      }
    );
    expect(ingestNotification).toHaveBeenCalledTimes(1);
    expect(ingestNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        agentRef: makeAgentRef("1", "r"),
        kind: "agent.turn-finished",
      })
    );
  });
});
