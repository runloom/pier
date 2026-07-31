import type { NotificationReport } from "@shared/contracts/notification-center.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportPluginSystemEvent } from "@/lib/plugins/notification-report.ts";

const reportMock = vi.fn<(r: NotificationReport) => Promise<null>>();

describe("reportPluginSystemEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportMock.mockResolvedValue(null);
    (window as { pier?: unknown }).pier = {
      notificationCenter: { report: reportMock },
    };
  });

  afterEach(() => {
    (window as { pier?: unknown }).pier = undefined;
  });

  it("reports only when systemEvent is true, with plugin id as source", () => {
    reportPluginSystemEvent("pier.codex", "error", "sync failed", {
      systemEvent: true,
    });
    expect(reportMock).toHaveBeenCalledWith({
      kind: "plugin.event",
      severity: "error",
      source: "pier.codex",
      title: "sync failed",
      trigger: "system-event",
    });
  });

  it("does nothing without the systemEvent marker", () => {
    reportPluginSystemEvent("pier.codex", "error", "sync failed");
    reportPluginSystemEvent("pier.codex", "error", "sync failed", {
      systemEvent: false,
    });
    expect(reportMock).not.toHaveBeenCalled();
  });

  it("survives missing preload (best-effort)", () => {
    (window as { pier?: unknown }).pier = undefined;
    expect(() => {
      reportPluginSystemEvent("pier.codex", "info", "x", {
        systemEvent: true,
      });
    }).not.toThrow();
  });
});
