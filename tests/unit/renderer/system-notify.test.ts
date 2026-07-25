import type {
  AppNotification,
  NotificationReport,
} from "@shared/contracts/notification-center.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import {
  registerSystemToastRenderer,
  resetSystemNotifyRecentKeysForTests,
  systemNotify,
} from "@/lib/notifications/system-notify.ts";
import { useNotificationCenterStore } from "@/stores/notification-center.store.ts";

const toastRendererMock = vi.fn<(n: AppNotification) => void>();
registerSystemToastRenderer(toastRendererMock);

const reportMock = vi.fn<(r: NotificationReport) => Promise<null>>();

function baseInput() {
  return {
    kind: "app.update" as const,
    severity: "success" as const,
    titleKey: "settings.appUpdate.toast.ready",
    titleParams: { version: "0.2.0" },
  };
}

function lastToastNotification(): AppNotification {
  return toastRendererMock.mock.calls.at(-1)?.[0] as AppNotification;
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

  it("shows a rich card toast (title/detail/type/time model) and reports to NCS", () => {
    systemNotify({ ...baseInput(), body: "detail-body" });
    expect(toastRendererMock).toHaveBeenCalledTimes(1);
    const notification = lastToastNotification();
    expect(notification.title).toBe("Update ready");
    expect(notification.body).toBe("detail-body");
    expect(notification.kind).toBe("app.update");
    expect(notification.severity).toBe("success");
    expect(reportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "app.update",
        titleKey: "settings.appUpdate.toast.ready",
        trigger: "system-event",
      })
    );
  });

  it("suppresses toast when dedupeKey already recorded (dedupe sink)", () => {
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
    expect(toastRendererMock).not.toHaveBeenCalled();
    expect(reportMock).toHaveBeenCalledTimes(1);
  });

  it("toasts again when the same dedupeKey is outside the 24h merge window", () => {
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
    expect(toastRendererMock).toHaveBeenCalledTimes(1);
  });

  it("suppresses rapid repeat toasts before the NCS broadcast returns", () => {
    // 广播往返窗口内的同 key 连发：镜像尚无记录，靠本地近因 dedupe 抑制
    systemNotify({ ...baseInput(), dedupeKey: "app-update:0.3.0" });
    systemNotify({ ...baseInput(), dedupeKey: "app-update:0.3.0" });
    expect(toastRendererMock).toHaveBeenCalledTimes(1);
    // 两次都照常落档（合并由 main 侧负责）
    expect(reportMock).toHaveBeenCalledTimes(2);
  });

  it("suppressToast reports without toasting", () => {
    systemNotify({ ...baseInput(), suppressToast: true });
    expect(toastRendererMock).not.toHaveBeenCalled();
    expect(reportMock).toHaveBeenCalledTimes(1);
  });

  it("DND silences non-error toast but error still toasts", () => {
    useNotificationCenterStore.setState({ dndEnabled: true });
    systemNotify(baseInput());
    expect(toastRendererMock).not.toHaveBeenCalled();
    systemNotify({ ...baseInput(), severity: "error" });
    expect(toastRendererMock).toHaveBeenCalledTimes(1);
  });

  it("mutedKinds silence toast but still report to inbox", async () => {
    const { useNotificationCenterPrefsStore } = await import(
      "@/stores/notification-center-prefs.store.ts"
    );
    useNotificationCenterPrefsStore.setState({
      prefs: {
        dndEnabled: false,
        mutedKinds: ["app.update"],
        retentionDays: 7,
        showUnreadBadge: true,
      },
    });
    systemNotify(baseInput());
    expect(toastRendererMock).not.toHaveBeenCalled();
    expect(reportMock).toHaveBeenCalledTimes(1);
    useNotificationCenterPrefsStore.setState({
      prefs: {
        dndEnabled: false,
        mutedKinds: [],
        retentionDays: 7,
        showUnreadBadge: true,
      },
    });
  });

  it("survives missing preload (report is best-effort)", () => {
    (window as { pier?: unknown }).pier = undefined;
    expect(() => {
      systemNotify(baseInput());
    }).not.toThrow();
    expect(toastRendererMock).toHaveBeenCalledTimes(1);
  });
});
