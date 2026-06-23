import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const OUT_MAIN = join(
  import.meta.dirname,
  "..",
  "..",
  "out",
  "main",
  "index.js"
);

test.describe("Command Palette e2e", () => {
  test("Cmd+Shift+P opens command palette with settings actions", async () => {
    const app = await electron.launch({ args: [OUT_MAIN] });
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");

    // 初始无 dialog
    const dialog = win.locator('[role="dialog"]');
    await expect(dialog).not.toBeAttached({ timeout: 3000 });

    // Cmd+Shift+P 打开命令面板
    await win.keyboard.press("Meta+Shift+KeyP");
    await win.waitForTimeout(1000);

    await expect(dialog).toBeAttached({ timeout: 5000 });
    await expect(win.locator("[cmdk-input]")).toBeVisible();
    await expect(
      win.locator("[cmdk-group-heading]").filter({ hasText: "设置" })
    ).toBeVisible();

    // 验证主题/风格/语言 action 都在面板中
    const items = win.locator("[cmdk-item]");
    await expect(items.filter({ hasText: "选择主题" })).toBeVisible();
    await expect(items.filter({ hasText: "选择风格" })).toBeVisible();
    await expect(items.filter({ hasText: "选择显示语言" })).toBeVisible();

    await app.close();
  });

  test("MRU 顶置最近执行的 action", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-mru-e2e-"));
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      // 1. 打开命令面板, 执行 "打开设置" (handler 不开 quick-pick)
      await win.keyboard.press("Meta+Shift+KeyP");
      await win.waitForTimeout(800);
      await win.locator("[cmdk-item]").filter({ hasText: "打开设置" }).click();
      // 设置弹窗会打开, Esc 关掉
      await win.keyboard.press("Escape");
      await win.waitForTimeout(300);

      // 2. 重开命令面板
      await win.keyboard.press("Meta+Shift+KeyP");
      await win.waitForTimeout(800);

      // 3. 第一个 cmdk-item 应是 "打开设置"
      const firstItem = win.locator("[cmdk-item]").first();
      await expect(firstItem).toContainText("打开设置");
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test("清空命令面板使用记录后恢复默认顺序", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-mru-e2e-"));
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      // 1. 执行 "打开设置" 让它进 MRU
      await win.keyboard.press("Meta+Shift+KeyP");
      await win.waitForTimeout(800);
      await win.locator("[cmdk-item]").filter({ hasText: "打开设置" }).click();
      await win.keyboard.press("Escape");
      await win.waitForTimeout(300);

      // 2. 验证它确实顶置 (sanity check)
      await win.keyboard.press("Meta+Shift+KeyP");
      await win.waitForTimeout(800);
      await expect(win.locator("[cmdk-item]").first()).toContainText(
        "打开设置"
      );

      // 3. 触发清空
      await win
        .locator("[cmdk-item]")
        .filter({ hasText: "清空命令面板使用记录" })
        .click();
      await win.waitForTimeout(500);

      // 4. 重开命令面板, "打开设置" 不应在第一位 (CATEGORY_META.View=0 排前)
      await win.keyboard.press("Meta+Shift+KeyP");
      await win.waitForTimeout(800);
      await expect(win.locator("[cmdk-item]").first()).not.toContainText(
        "打开设置"
      );
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
