import {
  buildShellEnvFailureReport,
  createShellEnvFailureNotify,
  formatShellEnvFailureCopy,
  shellEnvFailureDedupeKey,
} from "@main/services/process-environment/notify-failure.ts";
import { describe, expect, it } from "vitest";

describe("shell env failure notify", () => {
  it("builds optional soft report shape for tests / future opt-in", () => {
    const report = buildShellEnvFailureReport(
      {
        body: "detail",
        title: "degraded",
      },
      "boot-1"
    );
    expect(report).toMatchObject({
      actionParams: { section: "terminal" },
      body: "detail",
      kind: "channel.health",
      severity: "info",
      suppressToast: true,
      title: "degraded",
      trigger: "system-event",
    });
    expect(report.dedupeKey).toBe(shellEnvFailureDedupeKey("boot-1"));
    expect(report.actions?.[0]?.id).toBe("open-settings");
  });

  it("formats en and zh-CN copy as soft degrade (not failure alarm)", () => {
    expect(formatShellEnvFailureCopy("en").title).toMatch(
      /environment|terminal/i
    );
    expect(formatShellEnvFailureCopy("en").title).not.toMatch(
      /couldn't load|failed/i
    );
    expect(formatShellEnvFailureCopy("zh-CN").title).toContain("终端");
    expect(formatShellEnvFailureCopy("zh-CN").title).not.toContain("无法加载");
    expect(formatShellEnvFailureCopy("zh-CN").body).toContain("基础环境");
    expect(formatShellEnvFailureCopy("en").body).toMatch(/basic environment/i);
  });

  it("appends concrete error detail to body", () => {
    const zh = formatShellEnvFailureCopy("zh-CN", "timed out after 10000ms");
    expect(zh.body).toContain("详情：");
    expect(zh.body).toContain("timed out after 10000ms");
    const en = formatShellEnvFailureCopy("en", "exited with 1");
    expect(en.body).toContain("Details:");
    expect(en.body).toContain("exited with 1");
  });

  it("truncates very long failure detail", () => {
    const long = "x".repeat(2000);
    const copy = formatShellEnvFailureCopy("en", long);
    expect(copy.body).toContain("…");
    expect(copy.body.length).toBeLessThan(2000);
  });

  it("product default never ingests to NCS; logs once per process", () => {
    const controller = createShellEnvFailureNotify({
      bootId: "boot-test",
    });

    controller.onShellEnvFailed({
      cacheHit: false,
      error: "boom",
      pathChanged: false,
      shellEnvStatus: "failed",
      source: "plugin",
    });
    expect(controller.isPending()).toBe(false);
    expect(controller.wasDelivered()).toBe(true);

    controller.tryDeliver();
    controller.onShellEnvFailed({
      cacheHit: false,
      error: "again",
      pathChanged: false,
      shellEnvStatus: "failed",
      source: "plugin",
    });
    // Still only "delivered" once (log gate); no NCS side effects to assert.
    expect(controller.wasDelivered()).toBe(true);
  });
});
