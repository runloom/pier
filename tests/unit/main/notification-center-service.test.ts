import { createNotificationCenterService } from "@main/services/notification-center/service.ts";
import type { NotificationHistoryStore } from "@main/services/notification-center/store.ts";
import {
  type AppNotification,
  DEFAULT_NOTIFICATION_CENTER_PREFS,
  type NotificationCenterSnapshot,
  type NotificationReport,
} from "@shared/contracts/notification-center.ts";
import { beforeEach, describe, expect, it } from "vitest";

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
  let now: number;
  let idSeq: number;

  async function makeService(
    items: AppNotification[] = [],
    prefs = { ...DEFAULT_NOTIFICATION_CENTER_PREFS }
  ) {
    broadcasts = [];
    return createNotificationCenterService({
      broadcast: (snapshot) => {
        broadcasts.push(snapshot);
      },
      history: memoryHistory(items),
      idGen: () => `id-${idSeq++}`,
      now: () => now,
      readPrefs: async () => prefs,
      writeDnd: async (enabled) => {
        prefs.dndEnabled = enabled;
      },
    });
  }

  beforeEach(() => {
    now = 10_000;
    idSeq = 0;
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
});
