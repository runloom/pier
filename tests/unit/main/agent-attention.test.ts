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

describe("agent attention service", () => {
  const showNotification = vi.fn(
    async (
      _request: SystemNotificationRequest,
      _audio?: { silent?: boolean; sound?: string }
    ): Promise<SystemNotificationResult> => ({ shown: true })
  );
  const playAttentionSound = vi.fn();
  const isTargetPanelFocused = vi.fn(() => false);
  const isOwnerWindowFocused = vi.fn(() => false);
  let now = 1000;

  beforeEach(() => {
    showNotification.mockClear();
    showNotification.mockResolvedValue({ shown: true });
    playAttentionSound.mockClear();
    isTargetPanelFocused.mockReset();
    isTargetPanelFocused.mockReturnValue(false);
    isOwnerWindowFocused.mockReset();
    isOwnerWindowFocused.mockReturnValue(false);
    now = 1000;
  });

  function createService(
    settings: Partial<typeof DEFAULT_AGENT_ATTENTION_SETTINGS> = {},
    deps: {
      playAttentionSound?: typeof playAttentionSound;
      isOwnerWindowFocused?: typeof isOwnerWindowFocused | (() => boolean);
    } = {}
  ) {
    return createAgentAttentionService({
      isTargetPanelFocused,
      isOwnerWindowFocused: deps.isOwnerWindowFocused ?? isOwnerWindowFocused,
      now: () => now,
      resolveLocale: () => "en",
      settings: () => ({ ...DEFAULT_AGENT_ATTENTION_SETTINGS, ...settings }),
      showNotification,
      playAttentionSound: deps.playAttentionSound ?? playAttentionSound,
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
      }),
      expect.objectContaining({ silent: false })
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
    expect(
      service.lastNotifiedAt(makeAgentRef("11", "p1"), "waiting")
    ).toBeUndefined();

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

  it("requests app sound only when shown and builtin", async () => {
    const service = createService({
      soundEnabled: true,
      soundId: "abstract-sound1",
    });
    await service.observe(null, {
      activities: [agent({ panelId: "p1", status: "waiting", windowId: "11" })],
      ts: 1,
    });

    expect(showNotification).toHaveBeenCalledWith(
      expect.objectContaining({ kind: AGENT_ATTENTION_KIND }),
      { silent: true, sound: undefined }
    );
    expect(playAttentionSound).toHaveBeenCalledTimes(1);
    expect(playAttentionSound).toHaveBeenCalledWith({
      silent: true,
      appSoundId: "abstract-sound1",
    });
  });

  it("does not play app sound when notification not shown", async () => {
    showNotification.mockResolvedValue({
      reason: "denied",
      shown: false,
    });
    const service = createService({
      soundEnabled: true,
      soundId: "abstract-sound2",
    });
    await service.observe(null, {
      activities: [agent({ panelId: "p1", status: "waiting", windowId: "11" })],
      ts: 1,
    });
    expect(playAttentionSound).not.toHaveBeenCalled();
  });

  it("passes darwin system sound without app play payload", async () => {
    const service = createService({
      soundEnabled: true,
      soundId: "system",
    });
    await service.observe(null, {
      activities: [agent({ panelId: "p1", status: "waiting", windowId: "11" })],
      ts: 1,
    });

    const audioArg = showNotification.mock.calls[0]?.[1];
    expect(audioArg).toEqual(expect.objectContaining({ silent: false }));
    expect(playAttentionSound).toHaveBeenCalledTimes(1);
    expect(playAttentionSound.mock.calls[0]?.[0].appSoundId).toBeNull();
  });

  it("notifies on processing→ready when turnNotifyMode is unfocused and window unfocused", async () => {
    const service = createService(
      { turnNotifyMode: "unfocused" },
      { isOwnerWindowFocused: () => false }
    );
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
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it("skips ready notify when owner window focused and mode unfocused", async () => {
    const service = createService(
      { turnNotifyMode: "unfocused" },
      { isOwnerWindowFocused: () => true }
    );
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
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("notifies ready even when focused if turnNotifyMode is always", async () => {
    const service = createService(
      { turnNotifyMode: "always" },
      { isOwnerWindowFocused: () => true }
    );
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
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it("does not notify ready when turnNotifyMode is off", async () => {
    const service = createService(
      { turnNotifyMode: "off" },
      { isOwnerWindowFocused: () => false }
    );
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
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("does not notify ready on first projection of an agent panel", async () => {
    const service = createService(
      { turnNotifyMode: "always" },
      { isOwnerWindowFocused: () => false }
    );
    // previous broadcast 为 null（boot）与 previous 中无此面板（新面板）等价：
    // FA 新建层初始即 ready，没跑过回合，不得弹「回合已完成」。
    await service.observe(null, {
      activities: [agent({ panelId: "p1", status: "ready", windowId: "1" })],
      ts: 1,
    });
    await service.observe(
      {
        activities: [],
        ts: 1,
      },
      {
        activities: [agent({ panelId: "p2", status: "ready", windowId: "1" })],
        ts: 2,
      }
    );
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("keeps waiting and ready cooldowns independent per kind", async () => {
    const service = createService({ cooldownMs: 180_000 });
    // 进入 waiting → 通知（记 waiting 冷却）。
    await service.observe(
      {
        activities: [
          agent({ panelId: "p1", status: "processing", windowId: "11" }),
        ],
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

    // 30 秒后回合完成：waiting 冷却不得吞掉 ready 通知。
    now += 30_000;
    await service.observe(
      {
        activities: [
          agent({ panelId: "p1", status: "processing", windowId: "11" }),
        ],
        ts: 3,
      },
      {
        activities: [agent({ panelId: "p1", status: "ready", windowId: "11" })],
        ts: 4,
      }
    );
    expect(showNotification).toHaveBeenCalledTimes(2);

    // 再 30 秒后的第二次 ready：受 ready 自身冷却约束。
    now += 30_000;
    await service.observe(
      {
        activities: [
          agent({ panelId: "p1", status: "processing", windowId: "11" }),
        ],
        ts: 5,
      },
      {
        activities: [agent({ panelId: "p1", status: "ready", windowId: "11" })],
        ts: 6,
      }
    );
    expect(showNotification).toHaveBeenCalledTimes(2);

    // ready 冷却过期后恢复。
    now += 180_000;
    await service.observe(
      {
        activities: [
          agent({ panelId: "p1", status: "processing", windowId: "11" }),
        ],
        ts: 7,
      },
      {
        activities: [agent({ panelId: "p1", status: "ready", windowId: "11" })],
        ts: 8,
      }
    );
    expect(showNotification).toHaveBeenCalledTimes(3);
  });

  it("clears cooldown records when the agent panel disappears", async () => {
    const service = createService({ cooldownMs: 180_000 });
    const enterWaiting = async (ts: number) => {
      await service.observe(
        {
          activities: [
            agent({ panelId: "p1", status: "processing", windowId: "11" }),
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
    expect(
      service.lastNotifiedAt(makeAgentRef("11", "p1"), "waiting")
    ).toBeDefined();

    // 面板消失（关闭 / 会话结束）：冷却记录清理。
    await service.observe(
      {
        activities: [
          agent({ panelId: "p1", status: "waiting", windowId: "11" }),
        ],
        ts: 2,
      },
      { activities: [], ts: 3 }
    );
    expect(
      service.lastNotifiedAt(makeAgentRef("11", "p1"), "waiting")
    ).toBeUndefined();

    // 重开面板视为新会话：冷却窗口内也能再次通知。
    now += 10;
    await enterWaiting(4);
    expect(showNotification).toHaveBeenCalledTimes(2);
  });

  it("notifies error when enableErrorAttention even if enabled is false", async () => {
    const service = createService({
      enabled: false,
      enableErrorAttention: true,
    });
    await service.observe(
      {
        activities: [
          agent({ panelId: "p1", windowId: "11", status: "processing" }),
        ],
        ts: 1,
      },
      {
        activities: [agent({ panelId: "p1", windowId: "11", status: "error" })],
        ts: 2,
      }
    );
    expect(showNotification).toHaveBeenCalledTimes(1);
  });

  it("does not notify waiting when enabled is false", async () => {
    const service = createService({ enabled: false });
    await service.observe(
      {
        activities: [
          agent({ panelId: "p1", windowId: "11", status: "processing" }),
        ],
        ts: 1,
      },
      {
        activities: [
          agent({ panelId: "p1", windowId: "11", status: "waiting" }),
        ],
        ts: 2,
      }
    );
    expect(showNotification).not.toHaveBeenCalled();
  });
});
