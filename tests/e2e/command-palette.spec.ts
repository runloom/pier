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
});
