import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const OUT_MAIN = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "out",
  "main",
  "index.js"
);

test.skip(process.platform !== "darwin", "macOS only");

test("inbox item renders without leading status icon", async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), "pier-nc-verify-"));
  const app = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
  });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await expect(win.locator(".terminal-anchor")).toHaveCount(1, {
      timeout: 15_000,
    });

    // 注入一条「已完成」任务记录（severity: success）
    await win.evaluate(() =>
      (
        window as unknown as {
          pier: {
            notificationCenter: {
              report: (r: unknown) => Promise<unknown>;
            };
          };
        }
      ).pier.notificationCenter.report({
        kind: "task-run.finished",
        severity: "success",
        source: "host",
        title: "已完成：dev",
        titleKey: "terminal.runtimeControl.finishedSuccess",
        titleParams: { label: "dev" },
        trigger: "system-event",
        dedupeKey: "task-run:verify-1",
      })
    );
    await win.waitForTimeout(500);

    // 打开铃铛
    await win.locator('[data-testid="notification-center-bell"]').click();
    await expect(win.locator('[data-slot="popover-content"]')).toBeVisible({
      timeout: 5000,
    });
    await expect(win.locator('[data-slot="popover-content"]')).toContainText(
      "已完成"
    );

    // 断言：inbox 条目无前置状态图标（status-icon 不存在）
    const iconCount = await win.evaluate(
      () =>
        document.querySelectorAll(
          '[data-slot="popover-content"] [data-slot="status-icon"]'
        ).length
    );
    expect(iconCount).toBe(0);
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
