import {
  type AppUpdateNotifyService,
  appUpdateReadyDedupeKey,
  buildAppUpdateReadyReport,
  notifyAppUpdateReady,
  shouldSuppressAppUpdateReadyToast,
} from "@main/services/app-updates/notify-ready.ts";
import type { AppNotification } from "@shared/contracts/notification-center.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

function makeService(items: AppNotification[] = []) {
  const ingest = vi.fn();
  const service: AppUpdateNotifyService = {
    ingest,
    snapshot: () => ({
      items,
    }),
  };
  return { ingest, service };
}

describe("notifyAppUpdateReady", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds a stable dedupe key per version", () => {
    expect(appUpdateReadyDedupeKey("1.2.3")).toBe("app-update:1.2.3");
  });

  it("suppress helper matches history within the window", () => {
    const now = 1_000_000;
    expect(
      shouldSuppressAppUpdateReadyToast(
        [{ dedupeKey: "app-update:0.2.0", ts: now - 1000 }],
        "0.2.0",
        now
      )
    ).toBe(true);
    expect(
      shouldSuppressAppUpdateReadyToast(
        [{ dedupeKey: "app-update:0.2.0", ts: now - 25 * 60 * 60 * 1000 }],
        "0.2.0",
        now
      )
    ).toBe(false);
  });

  it("buildReport omits suppressToast unless requested", () => {
    expect(buildAppUpdateReadyReport("0.2.0", "en", false).suppressToast).toBe(
      undefined
    );
    expect(buildAppUpdateReadyReport("0.2.0", "en", true).suppressToast).toBe(
      true
    );
  });

  it("ingests with toast on first ready for a version", async () => {
    const { ingest, service } = makeService();
    notifyAppUpdateReady("0.2.0", {
      getService: async () => service,
      resolveLocale: async () => "en",
    });
    await vi.waitFor(() => {
      expect(ingest).toHaveBeenCalledTimes(1);
    });
    expect(ingest.mock.calls[0]?.[0]).toMatchObject({
      body: "Pier 0.2.0 · restart to finish installing",
      dedupeKey: "app-update:0.2.0",
      kind: "app.update",
      severity: "success",
      title: "Update ready",
      titleKey: "settings.appUpdate.toast.ready",
      trigger: "system-event",
    });
    expect(ingest.mock.calls[0]?.[0].suppressToast).toBeUndefined();
    expect(ingest.mock.calls[0]?.[0].actions).toEqual([
      { id: "relaunch", labelKey: "settings.appUpdate.action.restart" },
    ]);
  });

  it("suppresses toast when the same version is already in history", async () => {
    const { ingest, service } = makeService([
      {
        dedupeKey: "app-update:0.2.0",
        id: "n1",
        kind: "app.update",
        read: false,
        severity: "success",
        source: "host",
        title: "Update ready",
        trigger: "system-event",
        ts: Date.now(),
      },
    ]);
    notifyAppUpdateReady("0.2.0", {
      getService: async () => service,
      resolveLocale: async () => "zh-CN",
    });
    await vi.waitFor(() => {
      expect(ingest).toHaveBeenCalledTimes(1);
    });
    expect(ingest.mock.calls[0]?.[0]).toMatchObject({
      body: "Pier 0.2.0 · 重启后自动安装",
      suppressToast: true,
      title: "更新已就绪",
    });
  });

  it("no-ops when NCS is unavailable", async () => {
    const getService = vi.fn(async () => null);
    notifyAppUpdateReady("0.2.0", {
      getService,
      resolveLocale: async () => "en",
    });
    await vi.waitFor(() => {
      expect(getService).toHaveBeenCalled();
    });
  });
});
