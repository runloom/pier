import { createAgentAttentionService } from "@main/services/agent-attention/attention-service.ts";
import { createAgentRuntimeIndexService } from "@main/services/agent-runtime-index/index.ts";
import { AGENT_ATTENTION_KIND } from "@shared/contracts/agent-attention.ts";
import { makeAgentRef } from "@shared/contracts/agent-runtime-index.ts";
import type { ForegroundActivity } from "@shared/contracts/foreground-activity.ts";
import type { SystemNotificationRequest } from "@shared/contracts/notification.ts";
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
  const showNotification = vi.fn(
    async (_request: SystemNotificationRequest) => ({ shown: true as const })
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

  it("notifies on waiting, skips when focused, and focusWaiting targets same order", async () => {
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
      isTargetPanelFocused,
      now: () => now,
      resolveLocale: () => "en",
      showNotification,
    });

    await attention.observe(null, { activities, ts: 3 });
    expect(showNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        agentRef: makeAgentRef("22", "wait"),
        kind: AGENT_ATTENTION_KIND,
      })
    );

    showNotification.mockClear();
    isTargetPanelFocused.mockReturnValue(true);
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
    expect(showNotification).not.toHaveBeenCalled();

    const listed = index.listMachine({ preferredWindowId: "11" });
    expect(listed.entries[0]?.panelId).toBe("wait");
    await expect(index.focusWaiting()).resolves.toEqual({ status: "ok" });
  });

  it("does not notify on ready or default error", async () => {
    const attention = createAgentAttentionService({
      isTargetPanelFocused,
      now: () => now,
      showNotification,
    });
    await attention.observe(null, {
      activities: [
        agent({ panelId: "r", status: "ready", windowId: "1" }),
        agent({ panelId: "e", status: "error", windowId: "1" }),
      ],
      ts: 1,
    });
    expect(showNotification).not.toHaveBeenCalled();
  });
});
