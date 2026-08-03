import {
  buildShellEnvFailureReport,
  createShellEnvFailureNotify,
  formatShellEnvFailureCopy,
  shellEnvFailureDedupeKey,
} from "@main/services/process-environment/notify-failure.ts";
import { describe, expect, it, vi } from "vitest";

describe("shell env failure notify", () => {
  it("builds channel.health report with open-settings action and boot dedupe key", () => {
    const report = buildShellEnvFailureReport(
      {
        body: "detail",
        title: "failed",
      },
      "boot-1"
    );
    expect(report).toMatchObject({
      actionParams: { section: "terminal" },
      body: "detail",
      kind: "channel.health",
      severity: "warning",
      title: "failed",
      trigger: "system-event",
    });
    expect(report.dedupeKey).toBe(shellEnvFailureDedupeKey("boot-1"));
    expect(report.actions?.[0]?.id).toBe("open-settings");
  });

  it("formats en and zh-CN copy for toast/body", () => {
    expect(formatShellEnvFailureCopy("en").title).toMatch(/shell environment/i);
    expect(formatShellEnvFailureCopy("zh-CN").title).toContain("shell");
    expect(formatShellEnvFailureCopy("zh-CN").body.length).toBeGreaterThan(10);
  });

  it("stays pending until focused window exists, then ingests once", async () => {
    let focused: unknown | null = null;
    const ingest = vi.fn();
    const controller = createShellEnvFailureNotify({
      bootId: "boot-test",
      getFocusedWindow: () => focused,
      ingest,
      resolveCopy: () => ({ body: "b", title: "t" }),
    });

    controller.onShellEnvFailed({
      cacheHit: false,
      error: "boom",
      pathChanged: false,
      shellEnvStatus: "failed",
      source: "plugin",
    });
    expect(controller.isPending()).toBe(true);
    expect(ingest).not.toHaveBeenCalled();

    controller.tryDeliver();
    await Promise.resolve();
    expect(ingest).not.toHaveBeenCalled();

    focused = { id: "w1" };
    controller.tryDeliver();
    await vi.waitFor(() => {
      expect(ingest).toHaveBeenCalledTimes(1);
    });
    expect(controller.wasDelivered()).toBe(true);
    expect(ingest.mock.calls[0]?.[0]?.dedupeKey).toBe(
      shellEnvFailureDedupeKey("boot-test")
    );

    controller.tryDeliver();
    controller.onShellEnvFailed({
      cacheHit: false,
      error: "again",
      pathChanged: false,
      shellEnvStatus: "failed",
      source: "plugin",
    });
    await Promise.resolve();
    expect(ingest).toHaveBeenCalledTimes(1);
  });
});
