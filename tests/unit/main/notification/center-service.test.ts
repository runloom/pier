import { createOsCooldownStore } from "@main/services/notification-center/os-cooldown.ts";
import { createNotificationCenterService } from "@main/services/notification-center/service.ts";
import type { NotificationHistoryStore } from "@main/services/notification-center/store.ts";
import {
  type AppNotification,
  DEFAULT_NOTIFICATION_CENTER_PREFS,
  type NotificationCenterSnapshot,
  type NotificationReport,
} from "@shared/contracts/notification-center.ts";
import {
  DEFAULT_DELIVERY_AGENT_ATTENTION,
  type ToastTarget,
} from "@shared/notification-delivery.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** 内存 history stub（文件持久化由 store 单测覆盖）。 */
function memoryHistory(
  items: AppNotification[] = []
): NotificationHistoryStore {
  let state = [...items];
  return {
    flush: async () => undefined,
    items: () => [...state],
    markAllRead: () => {
      state = state.map((item) => ({ ...item, read: true }));
    },
    markRead: (id) => {
      const found = state.some((item) => item.id === id && !item.read);
      state = state.map((item) =>
        item.id === id ? { ...item, read: true } : item
      );
      return found;
    },
    mergeExisting: (id, patch) => {
      const existing = state.find((item) => item.id === id);
      if (!existing) {
        return null;
      }
      const merged = { ...existing, ...patch, id: existing.id };
      state = [merged, ...state.filter((item) => item.id !== id)];
      return merged;
    },
    prepend: (item) => {
      state = [item, ...state];
    },
    pruneExpired: () => undefined,
    removeWhere: (predicate) => {
      const before = state.length;
      state = state.filter((item) => !predicate(item));
      return before - state.length;
    },
  };
}

function report(
  overrides: Partial<NotificationReport> = {}
): NotificationReport {
  return {
    kind: "app.update",
    severity: "success",
    source: "host",
    title: "Ready",
    trigger: "system-event",
    ...overrides,
  };
}

describe("notificationCenterService", () => {
  let broadcasts: NotificationCenterSnapshot[];
  let deliveries: { notification: AppNotification; target: ToastTarget }[];
  let osDeliveries: AppNotification[];
  let now: number;
  let idSeq: number;
  let hasFocusedPierWindow: boolean;
  let isTargetPanelFocused: boolean;
  let isOwnerWindowFocused: boolean;

  async function makeService(
    items: AppNotification[] = [],
    prefs = { ...DEFAULT_NOTIFICATION_CENTER_PREFS },
    options: {
      agentAttention?: Partial<typeof DEFAULT_DELIVERY_AGENT_ATTENTION>;
      deliverOs?: boolean;
    } = {}
  ) {
    broadcasts = [];
    deliveries = [];
    osDeliveries = [];
    const osCooldown = createOsCooldownStore();
    return createNotificationCenterService({
      broadcast: (snapshot) => {
        broadcasts.push(snapshot);
      },
      deliverToast: (notification, target) => {
        deliveries.push({ notification, target });
      },
      ...(options.deliverOs
        ? {
            deliverOs: async (notification: AppNotification) => {
              osDeliveries.push(notification);
              return true;
            },
          }
        : {}),
      history: memoryHistory(items),
      idGen: () => `id-${idSeq++}`,
      now: () => now,
      osCooldown,
      readFocusBase: () => ({ hasFocusedPierWindow }),
      resolveAgentFocus: () => ({
        isOwnerWindowFocused,
        isTargetPanelFocused,
      }),
      readAgentAttentionPrefs: () => ({
        ...DEFAULT_DELIVERY_AGENT_ATTENTION,
        ...options.agentAttention,
      }),
      readPrefs: async () => prefs,
      writeDnd: async (enabled) => {
        prefs.dndEnabled = enabled;
      },
    });
  }

  beforeEach(() => {
    now = 10_000;
    idSeq = 0;
    hasFocusedPierWindow = true;
    isTargetPanelFocused = false;
    isOwnerWindowFocused = false;
  });

  it("ingest prepends unread item and broadcasts seq-increasing snapshot", async () => {
    const service = await makeService();
    const first = service.ingest(report());
    expect(first).toMatchObject({ id: "id-0", read: false, ts: 10_000 });
    service.ingest(report({ title: "Second" }));
    const snapshot = service.snapshot();
    expect(snapshot.items.map((item) => item.title)).toEqual([
      "Second",
      "Ready",
    ]);
    expect(snapshot.unreadCount).toBe(2);
    expect(broadcasts.map((b) => b.seq)).toEqual([1, 2]);
  });

  it("drops invalid reports without broadcast", async () => {
    const service = await makeService();
    expect(service.ingest({ kind: "nope" })).toBeNull();
    expect(service.ingest(null)).toBeNull();
    expect(broadcasts).toHaveLength(0);
  });

  it("dedupes by dedupeKey within window: merge, bump unread, repeatCount++", async () => {
    const service = await makeService();
    service.ingest(report({ dedupeKey: "app-update:0.2.0" }));
    now += 1000;
    const merged = service.ingest(report({ dedupeKey: "app-update:0.2.0" }));
    expect(merged).toMatchObject({
      id: "id-0",
      repeatCount: 2,
      read: false,
      ts: 11_000,
    });
    expect(service.snapshot().items).toHaveLength(1);
  });

  it("does not dedupe different keys or expired window", async () => {
    const service = await makeService();
    service.ingest(report({ dedupeKey: "k1" }));
    service.ingest(report({ dedupeKey: "k2" }));
    now += 25 * 60 * 60 * 1000;
    service.ingest(report({ dedupeKey: "k1" }));
    expect(service.snapshot().items).toHaveLength(3);
  });

  it("markRead / markAllRead update unreadCount and broadcast", async () => {
    const service = await makeService();
    const item = service.ingest(report());
    service.markRead(item?.id ?? "");
    expect(service.snapshot().unreadCount).toBe(0);
    service.ingest(report({ title: "a" }));
    service.ingest(report({ title: "b" }));
    service.markAllRead();
    expect(service.snapshot().unreadCount).toBe(0);
    expect(service.snapshot().items.every((i) => i.read)).toBe(true);
  });

  it("markRead on unknown id does not broadcast", async () => {
    const service = await makeService();
    service.markRead("ghost");
    expect(broadcasts).toHaveLength(0);
  });

  it("setDnd writes prefs and reflects in snapshot", async () => {
    const service = await makeService();
    await service.setDnd(true);
    expect(service.snapshot().dndEnabled).toBe(true);
    // 相同值不重复写、不广播
    const count = broadcasts.length;
    await service.setDnd(true);
    expect(broadcasts).toHaveLength(count);
  });

  it("markReadByDedupeKey marks the latest matching item; unknown key is a no-op", async () => {
    const service = await makeService();
    service.ingest(report({ dedupeKey: "k1", title: "first" }));
    const merged = service.ingest(report({ dedupeKey: "k1", title: "second" }));
    service.markReadByDedupeKey("k1");
    expect(service.snapshot().unreadCount).toBe(0);
    expect(service.snapshot().items[0]?.id).toBe(merged?.id);
    const count = broadcasts.length;
    service.markReadByDedupeKey("ghost");
    expect(broadcasts).toHaveLength(count);
  });

  it("syncPrefs applies external writes; broadcasts only when dnd flips", async () => {
    const prefs = { ...DEFAULT_NOTIFICATION_CENTER_PREFS };
    const service = await makeService([], prefs);
    const count = broadcasts.length;
    // 外部改 retention/mutedKinds：静默生效，不广播
    service.syncPrefs({
      ...prefs,
      mutedKinds: ["app.update"],
      retentionDays: 30,
    });
    expect(broadcasts).toHaveLength(count);
    // 外部改 dnd：快照可见，广播
    service.syncPrefs({ ...prefs, dndEnabled: true });
    expect(service.snapshot().dndEnabled).toBe(true);
    expect(broadcasts).toHaveLength(count + 1);
  });

  it("delivers shape-B toast to key-window after ingest (not suppressToast)", async () => {
    const service = await makeService();
    service.ingest(report({ kind: "agent.attention", severity: "warning" }));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.target).toEqual({ mode: "key-window" });
    expect(deliveries[0]?.notification.kind).toBe("agent.attention");
  });

  it("delivers task-run toast to origin-window when context has origin", async () => {
    const service = await makeService();
    service.ingest(report({ kind: "task-run.finished", severity: "success" }), {
      originWindowId: "7",
    });
    expect(deliveries[0]?.target).toEqual({
      mode: "origin-window",
      originWindowId: "7",
    });
  });

  it("skips toast delivery when suppressToast is set", async () => {
    const service = await makeService();
    service.ingest(report({ suppressToast: true }));
    expect(broadcasts).toHaveLength(1);
    expect(deliveries).toHaveLength(0);
  });

  it("skips toast under DND for non-error", async () => {
    const service = await makeService([], {
      ...DEFAULT_NOTIFICATION_CENTER_PREFS,
      dndEnabled: true,
    });
    service.ingest(report({ severity: "info" }));
    expect(deliveries).toHaveLength(0);
    service.ingest(report({ severity: "error", title: "boom" }));
    expect(deliveries).toHaveLength(1);
  });

  it("re-delivers toast on dedupe merge (repeat attention)", async () => {
    const service = await makeService();
    service.ingest(
      report({
        agentRef: "a1",
        dedupeKey: "agent.attention:a1",
        kind: "agent.attention",
        severity: "warning",
      })
    );
    service.ingest(
      report({
        agentRef: "a1",
        dedupeKey: "agent.attention:a1",
        kind: "agent.attention",
        severity: "warning",
      })
    );
    expect(deliveries).toHaveLength(2);
  });

  it("unfocused + agent.attention → OS only (no toast)", async () => {
    hasFocusedPierWindow = false;
    const service = await makeService([], undefined, { deliverOs: true });
    service.ingest(
      report({
        agentRef: "11\0p1",
        kind: "agent.attention",
        severity: "warning",
        title: "Need you",
      })
    );
    expect(deliveries).toHaveLength(0);
    // deliverOs is async fire-and-forget
    await vi.waitFor(() => {
      expect(osDeliveries).toHaveLength(1);
    });
    expect(osDeliveries[0]?.kind).toBe("agent.attention");
  });

  it("unfocused + task-run → neither toast nor OS", async () => {
    hasFocusedPierWindow = false;
    const service = await makeService([], undefined, { deliverOs: true });
    service.ingest(report({ kind: "task-run.finished", severity: "success" }));
    expect(deliveries).toHaveLength(0);
    await Promise.resolve();
    expect(osDeliveries).toHaveLength(0);
  });

  it("panel focused suppresses toast/OS but still records inbox", async () => {
    isTargetPanelFocused = true;
    const service = await makeService([], undefined, { deliverOs: true });
    service.ingest(
      report({
        agentRef: "11\0p1",
        kind: "agent.attention",
        panelRef: { panelId: "p1" },
        severity: "warning",
      })
    );
    expect(broadcasts).toHaveLength(1);
    expect(service.snapshot().unreadCount).toBe(1);
    expect(deliveries).toHaveLength(0);
    await Promise.resolve();
    expect(osDeliveries).toHaveLength(0);
  });

  it("OS cooldown skips second OS but re-toasts when focused", async () => {
    hasFocusedPierWindow = false;
    const service = await makeService([], undefined, {
      agentAttention: { cooldownMs: 180_000 },
      deliverOs: true,
    });
    const payload = report({
      agentRef: "11\0p1",
      dedupeKey: "agent.attention:waiting:11\0p1",
      kind: "agent.attention",
      severity: "warning",
    });
    service.ingest(payload);
    await vi.waitFor(() => {
      expect(osDeliveries).toHaveLength(1);
    });
    now += 1000;
    service.ingest(payload);
    await Promise.resolve();
    await Promise.resolve();
    expect(osDeliveries).toHaveLength(1);

    hasFocusedPierWindow = true;
    now += 1000;
    service.ingest(payload);
    expect(deliveries.length).toBeGreaterThanOrEqual(1);
  });

  it("serializes concurrent OS delivers for the same cooldown key", async () => {
    hasFocusedPierWindow = false;
    let resolveFirst!: (shown: boolean) => void;
    const firstGate = new Promise<boolean>((resolve) => {
      resolveFirst = resolve;
    });
    let osAttempts = 0;
    broadcasts = [];
    deliveries = [];
    osDeliveries = [];
    const osCooldown = createOsCooldownStore();
    const prefs = { ...DEFAULT_NOTIFICATION_CENTER_PREFS };
    const service = await createNotificationCenterService({
      broadcast: (snapshot) => {
        broadcasts.push(snapshot);
      },
      deliverToast: (notification, target) => {
        deliveries.push({ notification, target });
      },
      deliverOs: async (notification) => {
        osAttempts += 1;
        osDeliveries.push(notification);
        if (osAttempts === 1) {
          return firstGate;
        }
        return true;
      },
      history: memoryHistory(),
      idGen: () => `id-${idSeq++}`,
      now: () => now,
      osCooldown,
      readFocusBase: () => ({ hasFocusedPierWindow: false }),
      resolveAgentFocus: () => ({
        isOwnerWindowFocused: false,
        isTargetPanelFocused: false,
      }),
      readAgentAttentionPrefs: () => ({
        ...DEFAULT_DELIVERY_AGENT_ATTENTION,
        cooldownMs: 180_000,
      }),
      readPrefs: async () => prefs,
      writeDnd: async () => undefined,
    });

    const payload = report({
      agentRef: "11\0p1",
      dedupeKey: "agent.attention:waiting:11\0p1",
      kind: "agent.attention",
      severity: "warning",
    });
    service.ingest(payload);
    service.ingest(payload);
    await Promise.resolve();
    expect(osAttempts).toBe(1);
    resolveFirst(true);
    await vi.waitFor(() => {
      expect(osDeliveries).toHaveLength(1);
    });
  });

  it("pruneOsCooldown clears cooldown for dead agent refs", async () => {
    hasFocusedPierWindow = false;
    const service = await makeService([], undefined, {
      agentAttention: { cooldownMs: 180_000 },
      deliverOs: true,
    });
    const agentRef = "11\0p1";
    service.ingest(
      report({
        agentRef,
        dedupeKey: `agent.attention:waiting:${agentRef}`,
        kind: "agent.attention",
        severity: "warning",
      })
    );
    await vi.waitFor(() => {
      expect(osDeliveries).toHaveLength(1);
    });
    service.pruneOsCooldown(new Set());
    now += 1000;
    service.ingest(
      report({
        agentRef,
        dedupeKey: `agent.attention:waiting:${agentRef}`,
        kind: "agent.attention",
        severity: "warning",
        title: "again",
      })
    );
    await vi.waitFor(() => {
      expect(osDeliveries).toHaveLength(2);
    });
  });
});
