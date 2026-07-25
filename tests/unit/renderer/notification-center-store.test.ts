import type {
  AppNotification,
  NotificationCenterSnapshot,
} from "@shared/contracts/notification-center.ts";
import { beforeEach, describe, expect, it } from "vitest";
import {
  attentionUnreadCount,
  useNotificationCenterStore,
} from "@/stores/notification-center.store.ts";

function snapshot(
  overrides: Partial<NotificationCenterSnapshot> = {}
): NotificationCenterSnapshot {
  return {
    dndEnabled: false,
    items: [],
    seq: 1,
    unreadCount: 0,
    ...overrides,
  };
}

function item(id: string): AppNotification {
  return {
    id,
    kind: "app.update",
    read: false,
    severity: "info",
    source: "host",
    title: id,
    trigger: "system-event",
    ts: 1000,
  };
}

describe("notification-center mirror store", () => {
  beforeEach(() => {
    useNotificationCenterStore.setState({
      dndEnabled: false,
      items: [],
      seq: -1,
      unreadCount: 0,
    });
  });

  it("accepts the first post-restart snapshot (seq=0) as hydration", () => {
    useNotificationCenterStore
      .getState()
      .apply(snapshot({ items: [item("a")], seq: 0, unreadCount: 1 }));
    expect(useNotificationCenterStore.getState().items).toHaveLength(1);
  });

  it("applies snapshot", () => {
    useNotificationCenterStore
      .getState()
      .apply(snapshot({ items: [item("a")], seq: 2, unreadCount: 1 }));
    const state = useNotificationCenterStore.getState();
    expect(state.items).toHaveLength(1);
    expect(state.unreadCount).toBe(1);
    expect(state.seq).toBe(2);
  });

  it("rejects stale / out-of-order snapshots", () => {
    useNotificationCenterStore.getState().apply(snapshot({ seq: 5 }));
    useNotificationCenterStore
      .getState()
      .apply(snapshot({ items: [item("old")], seq: 4 }));
    useNotificationCenterStore
      .getState()
      .apply(snapshot({ items: [item("same")], seq: 5 }));
    expect(useNotificationCenterStore.getState().items).toEqual([]);
  });

  it("reflects dnd state from snapshot", () => {
    useNotificationCenterStore
      .getState()
      .apply(snapshot({ dndEnabled: true, seq: 3 }));
    expect(useNotificationCenterStore.getState().dndEnabled).toBe(true);
  });

  it("attentionUnreadCount only counts warning/error unread", () => {
    const items = [
      { ...item("a"), severity: "error" as const },
      { ...item("b"), severity: "warning" as const },
      { ...item("c"), severity: "info" as const },
      { ...item("d"), severity: "success" as const },
      { ...item("e"), read: true, severity: "error" as const },
    ];
    expect(attentionUnreadCount(items)).toBe(2);
  });
});
