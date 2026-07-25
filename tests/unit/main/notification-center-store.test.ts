import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNotificationHistoryStore } from "@main/services/notification-center/store.ts";
import {
  type AppNotification,
  NOTIFICATION_CENTER_HISTORY_LIMIT,
} from "@shared/contracts/notification-center.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function item(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: "n1",
    kind: "channel.health",
    read: false,
    severity: "info",
    source: "host",
    title: "x",
    trigger: "system-event",
    ts: 1000,
    ...overrides,
  };
}

describe("notificationHistoryStore", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pier-nc-"));
    filePath = join(dir, "notifications.json");
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it("starts empty when file is missing", async () => {
    const store = await createNotificationHistoryStore({ filePath });
    expect(store.items()).toEqual([]);
  });

  it("prepends and caps at history limit", async () => {
    const store = await createNotificationHistoryStore({ filePath });
    for (let i = 0; i < NOTIFICATION_CENTER_HISTORY_LIMIT + 10; i++) {
      store.prepend(item({ id: `n${i}`, ts: i }));
    }
    const items = store.items();
    expect(items).toHaveLength(NOTIFICATION_CENTER_HISTORY_LIMIT);
    expect(items[0]?.id).toBe(`n${NOTIFICATION_CENTER_HISTORY_LIMIT + 9}`);
  });

  it("persists and reloads across instances", async () => {
    const first = await createNotificationHistoryStore({ filePath });
    first.prepend(item({ id: "persisted" }));
    await first.flush();

    const second = await createNotificationHistoryStore({ filePath });
    expect(second.items().map((i) => i.id)).toEqual(["persisted"]);
  });

  it("resets on corrupt file", async () => {
    const first = await createNotificationHistoryStore({ filePath });
    first.prepend(item({ id: "bad", severity: "fatal" as never }));
    await first.flush();
    const second = await createNotificationHistoryStore({ filePath });
    expect(second.items()).toEqual([]);
  });

  it("prunes items older than retention window", async () => {
    const store = await createNotificationHistoryStore({ filePath });
    const now = 10 * 24 * 60 * 60 * 1000;
    store.prepend(item({ id: "old", ts: now - 8 * 24 * 60 * 60 * 1000 }));
    store.prepend(item({ id: "fresh", ts: now - 1000 }));
    store.pruneExpired(7, now);
    expect(store.items().map((i) => i.id)).toEqual(["fresh"]);
  });

  it("mergeExisting bumps item to head", async () => {
    const store = await createNotificationHistoryStore({ filePath });
    store.prepend(item({ id: "a", ts: 1 }));
    store.prepend(item({ id: "b", ts: 2 }));
    const merged = store.mergeExisting("a", { ts: 3, repeatCount: 2 });
    expect(merged).toMatchObject({ id: "a", ts: 3, repeatCount: 2 });
    expect(store.items().map((i) => i.id)).toEqual(["a", "b"]);
    expect(store.mergeExisting("ghost", {})).toBeNull();
  });
});
