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

  it("appends concrete error detail to body", () => {
    const zh = formatShellEnvFailureCopy("zh-CN", "timed out after 10000ms");
    expect(zh.body).toContain("原因：");
    expect(zh.body).toContain("timed out after 10000ms");
    const en = formatShellEnvFailureCopy("en", "exited with 1");
    expect(en.body).toContain("Cause:");
    expect(en.body).toContain("exited with 1");
  });

  it("truncates long failure detail", () => {
    const long = "x".repeat(500);
    const copy = formatShellEnvFailureCopy("en", long);
    expect(copy.body.length).toBeLessThan(500);
    expect(copy.body).toContain("…");
  });

  it("stays pending until focused window exists, then ingests once", async () => {
    let focused: unknown | null = null;
    const ingest = vi.fn();
    const controller = createShellEnvFailureNotify({
      bootId: "boot-test",
      getFocusedWindow: () => focused,
      ingest,
      resolveCopy: (diagnostics) => ({
        body: diagnostics.error ?? "b",
        title: "t",
      }),
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
