import {
  type AppNotification,
  appNotificationSchema,
  DEFAULT_NOTIFICATION_CENTER_PREFS,
  NOTIFICATION_KINDS,
  notificationCenterPrefsSchema,
  notificationCenterSnapshotSchema,
  notificationReportSchema,
} from "@shared/contracts/notification-center.ts";
import { describe, expect, it } from "vitest";

function validNotification(): AppNotification {
  return {
    id: "n1",
    kind: "task-run.finished",
    read: false,
    severity: "success",
    source: "host",
    title: "Finished: build",
    titleKey: "terminal.runtimeControl.finishedSuccess",
    titleParams: { label: "build" },
    trigger: "system-event",
    ts: 1000,
  };
}

describe("notification-center contract", () => {
  it("accepts a valid notification", () => {
    expect(appNotificationSchema.safeParse(validNotification()).success).toBe(
      true
    );
  });

  it("rejects unknown kind / severity and >2 actions", () => {
    const base = validNotification();
    expect(
      appNotificationSchema.safeParse({ ...base, kind: "nope" }).success
    ).toBe(false);
    expect(
      appNotificationSchema.safeParse({ ...base, severity: "fatal" }).success
    ).toBe(false);
    expect(
      appNotificationSchema.safeParse({
        ...base,
        actions: [
          { id: "a", labelKey: "k" },
          { id: "b", labelKey: "k" },
          { id: "c", labelKey: "k" },
        ],
      }).success
    ).toBe(false);
  });

  it("report omits server-assigned fields", () => {
    const { id: _id, read: _read, ts: _ts, ...report } = validNotification();
    expect(notificationReportSchema.safeParse(report).success).toBe(true);
    expect(
      notificationReportSchema.safeParse({ ...report, id: "x" }).success
    ).toBe(false);
  });

  it("snapshot enforces bounded items", () => {
    const items = Array.from({ length: 201 }, (_, i) => ({
      ...validNotification(),
      id: `n${i}`,
    }));
    expect(
      notificationCenterSnapshotSchema.safeParse({
        dndEnabled: false,
        items,
        seq: 1,
        unreadCount: 0,
      }).success
    ).toBe(false);
  });

  it("prefs default and strict unknown keys", () => {
    expect(notificationCenterPrefsSchema.parse({})).toEqual(
      DEFAULT_NOTIFICATION_CENTER_PREFS
    );
    expect(
      notificationCenterPrefsSchema.safeParse({ unknown: true }).success
    ).toBe(false);
  });

  it("kind vocabulary stays aligned with design routing matrix", () => {
    expect(NOTIFICATION_KINDS).toContain("agent.attention");
    expect(NOTIFICATION_KINDS).toContain("task-run.finished");
    expect(NOTIFICATION_KINDS).toContain("app.update");
    expect(NOTIFICATION_KINDS).toContain("channel.health");
    expect(NOTIFICATION_KINDS).toContain("plugin.event");
  });
});
