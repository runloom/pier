/**
 * W5-S2：notifications CLI 命令 — NCS 读写 + focus 同构 Runtime Index。
 */

import type { PierCoreServices } from "@main/app-core/command-router-services.ts";
import {
  executeNotificationsFocusCommand,
  executeNotificationsGetCommand,
  executeNotificationsListCommand,
  executeNotificationsMarkReadCommand,
  executeNotificationsWatchCommand,
  type NotificationCenterCommandFacade,
} from "@main/app-core/commands/notifications.ts";
import type { AppNotification } from "@shared/contracts/notification-center.ts";
import { describe, expect, it, vi } from "vitest";

function item(
  partial: Partial<AppNotification> & Pick<AppNotification, "id" | "title">
): AppNotification {
  return {
    kind: "agent.attention",
    source: "agent-attention",
    severity: "warning",
    trigger: "system-event",
    read: false,
    ts: 1_700_000_000_000,
    ...partial,
  };
}

function makeNcs(initial: AppNotification[]): NotificationCenterCommandFacade {
  let seq = 0;
  const items = [...initial];
  return {
    snapshot: () => ({
      items: [...items],
      seq,
      unreadCount: items.filter((row) => !row.read).length,
      dndEnabled: false,
    }),
    markRead: (id) => {
      const row = items.find((entry) => entry.id === id);
      if (row && !row.read) {
        row.read = true;
        seq += 1;
      }
    },
    markAllRead: () => {
      let changed = false;
      for (const row of items) {
        if (!row.read) {
          row.read = true;
          changed = true;
        }
      }
      if (changed) {
        seq += 1;
      }
    },
  };
}

function services(
  ncs: NotificationCenterCommandFacade,
  focus: () => Promise<{ status: string; message?: string }> = async () => ({
    status: "ok",
  })
): PierCoreServices {
  return {
    notificationCenter: ncs,
    agentRuntimeIndex: {
      focus,
      listMachine: () => ({ entries: [], ts: 1 }),
      focusWaiting: async () => ({ status: "empty" as const }),
    },
  } as never;
}

describe("notifications commands (W5-S2)", () => {
  it("lists items and filters unread", async () => {
    const ncs = makeNcs([
      item({ id: "a", title: "需要你处理", read: false }),
      item({ id: "b", title: "已读", read: true }),
    ]);
    const all = await executeNotificationsListCommand(
      "r1",
      { type: "notifications.list" },
      services(ncs)
    );
    expect(all.ok).toBe(true);
    if (all.ok) {
      expect((all.data as { items: unknown[] }).items).toHaveLength(2);
    }
    const unread = await executeNotificationsListCommand(
      "r2",
      { type: "notifications.list", unreadOnly: true },
      services(ncs)
    );
    expect(unread.ok).toBe(true);
    if (unread.ok) {
      const data = unread.data as { items: Array<{ id: string }> };
      expect(data.items.map((row) => row.id)).toEqual(["a"]);
    }
  });

  it("get returns not_found for missing id", async () => {
    const result = await executeNotificationsGetCommand(
      "r3",
      { type: "notifications.get", id: "missing" },
      services(makeNcs([]))
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not_found");
    }
  });

  it("mark-read does not call runtime focus and flips read", async () => {
    const focus = vi.fn(async () => ({ status: "ok" as const }));
    const ncs = makeNcs([
      item({
        id: "n1",
        title: "需要你处理",
        agentRef: "w\0p",
        read: false,
      }),
    ]);
    const result = await executeNotificationsMarkReadCommand(
      "r4",
      { type: "notifications.mark-read", id: "n1" },
      services(ncs, focus)
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as { marked: number }).marked).toBe(1);
    }
    expect(focus).not.toHaveBeenCalled();
    expect(ncs.snapshot().items[0]?.read).toBe(true);
    const again = await executeNotificationsMarkReadCommand(
      "r4b",
      { type: "notifications.mark-read", id: "n1" },
      services(ncs, focus)
    );
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect((again.data as { marked: number }).marked).toBe(0);
    }
  });

  it("focus uses agentRuntimeIndex.focus only", async () => {
    const focus = vi.fn(async () => ({ status: "ok" as const }));
    const ncs = makeNcs([
      item({
        id: "n1",
        title: "需要你处理",
        agentRef: "9\0panel-1",
      }),
    ]);
    const result = await executeNotificationsFocusCommand(
      "r5",
      { type: "notifications.focus", id: "n1" },
      services(ncs, focus)
    );
    expect(result.ok).toBe(true);
    expect(focus).toHaveBeenCalledWith("9\0panel-1");
  });

  it("focus fails when agent panel is gone without mutating NCS read", async () => {
    const focus = vi.fn(async () => ({ status: "panel_gone" as const }));
    const ncs = makeNcs([
      item({
        id: "n1",
        title: "需要你处理",
        agentRef: "9\0panel-1",
        read: false,
      }),
    ]);
    const result = await executeNotificationsFocusCommand(
      "r6",
      { type: "notifications.focus", id: "n1" },
      services(ncs, focus)
    );
    expect(result.ok).toBe(false);
    expect(ncs.snapshot().items[0]?.read).toBe(false);
  });

  it("watch returns snapshot immediately and uses notifications cursorScope", async () => {
    const ncs = makeNcs([item({ id: "n1", title: "x" })]);
    const result = await executeNotificationsWatchCommand(
      "r7",
      { type: "notifications.watch", timeoutMs: 100, pollMs: 20 },
      services(ncs)
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as {
        mode: string;
        cursorScope: string;
        items: unknown[];
      };
      expect(data.mode).toBe("snapshot");
      expect(data.cursorScope).toBe("notifications");
      expect(data.items).toHaveLength(1);
    }
  });

  it("watch times out when after is current seq", async () => {
    const ncs = makeNcs([item({ id: "n1", title: "x" })]);
    const seq = ncs.snapshot().seq;
    const result = await executeNotificationsWatchCommand(
      "r8",
      {
        type: "notifications.watch",
        after: seq,
        timeoutMs: 60,
        pollMs: 15,
      },
      services(ncs)
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { mode: string; items: unknown[] };
      expect(data.mode).toBe("timeout");
      expect(data.items).toEqual([]);
    }
  });

  it("watch deadline is not overrun by large pollMs", async () => {
    const ncs = makeNcs([item({ id: "n1", title: "x" })]);
    const seq = ncs.snapshot().seq;
    const started = Date.now();
    const result = await executeNotificationsWatchCommand(
      "r9",
      {
        type: "notifications.watch",
        after: seq,
        timeoutMs: 80,
        pollMs: 60_000,
      },
      services(ncs)
    );
    const elapsed = Date.now() - started;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as { mode: string }).mode).toBe("timeout");
    }
    // Must not sleep full pollMs; allow small timer slack.
    expect(elapsed).toBeLessThan(2000);
  });

  it("watch aborts promptly when abortSignal fires", async () => {
    const ncs = makeNcs([item({ id: "n1", title: "x" })]);
    const seq = ncs.snapshot().seq;
    const ac = new AbortController();
    const started = Date.now();
    const pending = executeNotificationsWatchCommand(
      "r10",
      {
        type: "notifications.watch",
        after: seq,
        timeoutMs: 30_000,
        pollMs: 5000,
      },
      services(ncs),
      { abortSignal: ac.signal }
    );
    setTimeout(() => {
      ac.abort();
    }, 40);
    const result = await pending;
    const elapsed = Date.now() - started;
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { mode: string; cancelled?: boolean };
      expect(data.mode).toBe("cancelled");
      expect(data.cancelled).toBe(true);
    }
    expect(elapsed).toBeLessThan(2000);
  });
});
