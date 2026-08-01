import type { NotificationReport } from "@shared/contracts/notification-center.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import {
  resetSystemNotifyRecentKeysForTests,
  systemNotify,
} from "@/lib/notifications/system-notify.ts";
import { useNotificationCenterStore } from "@/stores/notification-center.store.ts";

const reportMock = vi.fn<(r: NotificationReport) => Promise<null>>();

function baseInput() {
  return {
    kind: "app.update" as const,
    severity: "success" as const,
    titleKey: "settings.appUpdate.toast.ready",
    titleParams: { version: "0.2.0" },
  };
}

function lastReport(): NotificationReport {
  return reportMock.mock.calls.at(-1)?.[0] as NotificationReport;
}

describe("systemNotify", () => {
  beforeEach(async () => {
    await initI18n();
    vi.clearAllMocks();
    resetSystemNotifyRecentKeysForTests();
    reportMock.mockResolvedValue(null);
    (window as { pier?: unknown }).pier = {
      notificationCenter: { report: reportMock },
    };
    useNotificationCenterStore.setState({
      dndEnabled: false,
      hydrated: true,
      items: [],
      seq: 0,
      unreadCount: 0,
    });
  });

  afterEach(() => {
    (window as { pier?: unknown }).pier = undefined;
  });

  it("reports to NCS without local shape-B toast (Strict main-owned)", () => {
    systemNotify({ ...baseInput(), body: "detail-body" });
    expect(reportMock).toHaveBeenCalledTimes(1);
    const report = lastReport();
    expect(report.title).toBe("Update ready");
    expect(report.body).toBe("detail-body");
    expect(report.kind).toBe("app.update");
    expect(report.severity).toBe("success");
    expect(report.trigger).toBe("system-event");
    expect(report.suppressToast).toBeUndefined();
  });

  it("passes suppressToast when dedupeKey already recorded (dedupe sink)", () => {
    useNotificationCenterStore.setState({
      items: [
        {
          dedupeKey: "app-update:0.2.0",
          id: "n1",
          kind: "app.update",
          read: false,
          severity: "success",
          source: "host",
          title: "x",
          trigger: "system-event",
          ts: Date.now(),
        },
      ],
    });
    systemNotify({ ...baseInput(), dedupeKey: "app-update:0.2.0" });
    expect(reportMock).toHaveBeenCalledTimes(1);
    expect(lastReport().suppressToast).toBe(true);
  });

  it("does not suppress when the same dedupeKey is outside the 24h merge window", () => {
    useNotificationCenterStore.setState({
      hydrated: true,
      items: [
        {
          dedupeKey: "app-update:0.2.0",
          id: "n1",
          kind: "app.update",
          read: false,
          severity: "success",
          source: "host",
          title: "x",
          trigger: "system-event",
          ts: Date.now() - 25 * 60 * 60 * 1000,
        },
      ],
    });
    systemNotify({ ...baseInput(), dedupeKey: "app-update:0.2.0" });
    expect(reportMock).toHaveBeenCalledTimes(1);
    expect(lastReport().suppressToast).toBeUndefined();
  });

  it("suppresses rapid repeat toasts before the NCS broadcast returns", () => {
    systemNotify({ ...baseInput(), dedupeKey: "app-update:0.3.0" });
    systemNotify({ ...baseInput(), dedupeKey: "app-update:0.3.0" });
    expect(reportMock).toHaveBeenCalledTimes(2);
    expect(reportMock.mock.calls[0]?.[0].suppressToast).toBeUndefined();
    expect(reportMock.mock.calls[1]?.[0].suppressToast).toBe(true);
  });

  it("explicit suppressToast reports without toasting intent", () => {
    systemNotify({ ...baseInput(), suppressToast: true });
    expect(reportMock).toHaveBeenCalledTimes(1);
    expect(lastReport().suppressToast).toBe(true);
  });

  it("survives missing preload (report is best-effort)", () => {
    (window as { pier?: unknown }).pier = undefined;
    expect(() => {
      systemNotify(baseInput());
    }).not.toThrow();
  });
});
