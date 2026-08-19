import { formatAttentionNotificationCopy } from "@main/services/agent-attention/notification-copy.ts";
import { createAgentAttentionService } from "@main/services/agent-attention/service.ts";
import {
  attentionPathLeaf,
  formatAttentionIdentity,
  formatAttentionNotificationCopy as formatShared,
} from "@shared/agent-attention-copy.ts";
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
  it("uses event title and identity+next-step body (zh-CN / en)", () => {
    const waiting = agent({
      panelId: "p1",
      status: "waiting",
      windowId: "1",
    });
    const waitingZh = formatAttentionNotificationCopy(waiting, "zh-CN");
    expect(waitingZh.title).toBe("需要你处理");
    expect(waitingZh.body).toBe("Claude — 等待确认或继续");
    expect(waitingZh.actionLabelKey).toBe(
      "notificationsCenter.action.goToAgent"
    );

    const waitingEn = formatAttentionNotificationCopy(waiting, "en");
    expect(waitingEn.title).toBe("Needs attention");
    expect(waitingEn.titleKey).toBe("notificationsCenter.attention.waiting");
    expect(waitingEn.body).toBe(
      "Claude — Awaiting confirmation or your next step"
    );

    const waitingJa = formatAttentionNotificationCopy(waiting, "ja");
    expect(waitingJa.title).toBe("対応が必要");
    expect(waitingJa.body).toContain("確認または続きの操作を待っています");
    const waitingKo = formatAttentionNotificationCopy(waiting, "ko");
    expect(waitingKo.title).toBe("처리 필요");

    const errored = agent({
      panelId: "p1",
      status: "error",
      windowId: "1",
    });
    const errorZh = formatAttentionNotificationCopy(errored, "zh-CN");
    expect(errorZh.title).toBe("智能体出错了");
    expect(errorZh.body).toContain("打开对话查看输出");
    expect(errorZh.actionLabelKey).toBe(
      "notificationsCenter.action.viewAgentOutput"
    );
    const errorEn = formatAttentionNotificationCopy(errored, "en");
    expect(errorEn.body).toContain("Open the conversation to view the output");
  });

  it("localizes ready with open-agent action", () => {
    const ready = agent({ panelId: "p1", status: "ready", windowId: "1" });
    const zh = formatAttentionNotificationCopy(ready, "zh-CN");
    expect(zh.title).toBe("回合已完成");
    expect(zh.body).toBe("Claude — 可以继续输入");
    expect(zh.actionLabelKey).toBe("notificationsCenter.action.openAgent");

    const en = formatAttentionNotificationCopy(ready, "en");
    expect(en.title).toBe("Turn finished");
    expect(en.body).toContain("Ready for your next message");
  });

  it("includes session title and project leaf in body identity", () => {
    const activity = agent({
      panelId: "p1",
      status: "waiting",
      windowId: "1",
      sessionTitle: "重构登录流",
    });
    const copy = formatAttentionNotificationCopy(activity, "zh-CN", {
      projectRootPath: "/Users/me/ABC/pier",
    });
    expect(copy.title).toBe("需要你处理");
    expect(copy.body).toBe("Claude · 重构登录流 · pier — 等待确认或继续");
  });

  it("does not put brand name alone in title", () => {
    const copy = formatShared({ agentLabel: "Grok", status: "ready" }, "zh-CN");
    expect(copy.title).not.toBe("Grok");
    expect(copy.body.startsWith("Grok")).toBe(true);
  });
});

describe("formatAttentionIdentity / attentionPathLeaf", () => {
  it("takes path leaf and dedupes against session title", () => {
    expect(attentionPathLeaf("/Users/me/ABC/pier")).toBe("pier");
    expect(attentionPathLeaf("/Users/me/ABC/pier/")).toBe("pier");
    expect(
      formatAttentionIdentity({
        agentLabel: "Grok",
        sessionTitle: "pier",
        projectRootPath: "/tmp/pier",
      })
    ).toBe("Grok · pier");
  });

  it("falls back to cwd leaf when projectRootPath is absent", () => {
    expect(
      formatAttentionIdentity({
        agentLabel: "Grok",
        cwd: "/tmp/feature-branch",
      })
    ).toBe("Grok · feature-branch");
  });

  it("prefers projectRootPath leaf over cwd", () => {
    expect(
      formatAttentionIdentity({
        agentLabel: "Grok",
        projectRootPath: "/Users/me/ABC/pier",
        cwd: "/Users/me/ABC/pier/packages/ui",
      })
    ).toBe("Grok · pier");
  });

  it("uses locale-aware empty label fallback", () => {
    expect(formatAttentionIdentity({ agentLabel: "  " }, "zh-CN")).toBe(
      "智能体"
    );
    expect(formatAttentionIdentity({ agentLabel: "" }, "en")).toBe("Agent");
    expect(formatAttentionIdentity({ agentLabel: "" }, "ja")).toBe(
      "エージェント"
    );
    expect(formatAttentionIdentity({ agentLabel: "" }, "ko")).toBe("에이전트");
  });
});

describe("agent attention service (classify → NCS ingest only)", () => {
  const ingestNotification = vi.fn<(r: NotificationReport) => void>();

  beforeEach(() => {
    ingestNotification.mockClear();
  });

  function createService(
    settings: Partial<typeof DEFAULT_AGENT_ATTENTION_SETTINGS> = {},
    resolveLocation?: Parameters<
      typeof createAgentAttentionService
    >[0]["resolveLocation"]
  ) {
    return createAgentAttentionService({
      ingestNotification,
      resolveLocale: () => "en",
      settings: () => ({ ...DEFAULT_AGENT_ATTENTION_SETTINGS, ...settings }),
      ...(resolveLocation ? { resolveLocation } : {}),
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
        body: "Claude — Awaiting confirmation or your next step",
        dedupeKey: `agent.attention:waiting:${agentRef}`,
        kind: "agent.attention",
        panelRef: { panelId: "p1" },
        severity: "warning",
        source: "agent-attention",
        title: "Needs attention",
        titleKey: "notificationsCenter.attention.waiting",
        trigger: "system-event",
      })
    );
  });

  it("enriches body from resolveLocation project leaf", async () => {
    const service = createService({}, () => ({
      projectRootPath: "/Users/me/work/pier",
    }));
    await service.observe(null, {
      activities: [
        agent({
          panelId: "p1",
          status: "waiting",
          windowId: "11",
          sessionTitle: "Fix notifications",
        }),
      ],
      ts: 1,
    });
    expect(ingestNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Claude · Fix notifications · pier — Awaiting confirmation or your next step",
        title: "Needs attention",
        titleKey: "notificationsCenter.attention.waiting",
      })
    );
  });

  it("uses view-output action label on error", async () => {
    const service = createService({ enableErrorAttention: true });
    await service.observe(null, {
      activities: [agent({ panelId: "p1", status: "error", windowId: "11" })],
      ts: 1,
    });
    expect(ingestNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [
          {
            id: "focus-panel",
            labelKey: "notificationsCenter.action.viewAgentOutput",
          },
        ],
        body: "Claude — Open the conversation to view the output",
        title: "Agent ran into an error",
        titleKey: "notificationsCenter.attention.error",
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
      expect.objectContaining({
        kind: "agent.turn-finished",
        severity: "info",
        title: "Turn finished",
        titleKey: "notificationsCenter.attention.ready",
        actions: [
          {
            id: "focus-panel",
            labelKey: "notificationsCenter.action.openAgent",
          },
        ],
      })
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
