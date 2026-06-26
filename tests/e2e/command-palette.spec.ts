import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  test,
} from "@playwright/test";

const OUT_MAIN = join(
  import.meta.dirname,
  "..",
  "..",
  "out",
  "main",
  "index.js"
);

async function launchPierApp(): Promise<{
  app: ElectronApplication;
  userDataDir: string;
}> {
  const userDataDir = mkdtempSync(join(tmpdir(), "pier-command-e2e-"));
  const app = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
  });
  return { app, userDataDir };
}

async function closePierApp({
  app,
  userDataDir,
}: {
  app: ElectronApplication;
  userDataDir: string;
}): Promise<void> {
  await app.close();
  rmSync(userDataDir, { recursive: true, force: true });
}

test.describe("Command Palette e2e", () => {
  test("Cmd+Shift+P opens command palette with settings actions", async () => {
    const appContext = await launchPierApp();
    try {
      const win = await appContext.app.firstWindow();
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
      await expect(
        win.locator("[cmdk-group-heading]").filter({ hasText: "运行" })
      ).toBeVisible();

      // 验证主题/风格/语言 action 都在面板中
      const items = win.locator("[cmdk-item]");
      await expect(items.filter({ hasText: "运行任务..." })).toBeVisible();
      await expect(items.filter({ hasText: "新建终端" })).toBeVisible();
      await expect(items.filter({ hasText: "终端列表..." })).toBeVisible();
      await expect(items.filter({ hasText: "选择主题" })).toBeVisible();
      await expect(items.filter({ hasText: "选择风格" })).toBeVisible();
      await expect(items.filter({ hasText: "选择显示语言" })).toBeVisible();
    } finally {
      await closePierApp(appContext);
    }
  });

  test("Terminal List opens a grouped terminal quick-pick list", async () => {
    const appContext = await launchPierApp();
    try {
      const win = await appContext.app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      await win.keyboard.press("Meta+Shift+KeyP");
      await win.waitForTimeout(800);
      await win
        .locator("[cmdk-item]")
        .filter({ hasText: "终端列表..." })
        .click();

      await expect(win.locator("[cmdk-input]")).toHaveAttribute(
        "placeholder",
        "搜索终端、窗口或目录…"
      );
      await expect(
        win.locator("[cmdk-item]").filter({ hasText: "当前终端" })
      ).toHaveCount(0);
      await expect(
        win.locator("[cmdk-group-heading]").filter({
          hasText: "窗口 1 · 当前窗口 · 第 1 组",
        })
      ).toBeVisible();
      await expect(win.getByText("当前", { exact: true })).toHaveCount(0);
      await expect(
        win.locator('[cmdk-item][data-checked="true"]').filter({
          hasText: "标签 1/1",
        })
      ).toBeVisible();

      await expect(win.getByText("切换", { exact: true })).toHaveCount(0);
    } finally {
      await closePierApp(appContext);
    }
  });

  test("MRU 顶置最近执行的 action", async () => {
    const appContext = await launchPierApp();
    try {
      const win = await appContext.app.firstWindow();
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
      await closePierApp(appContext);
    }
  });

  test("清空命令面板使用记录后恢复默认顺序", async () => {
    const appContext = await launchPierApp();
    try {
      const win = await appContext.app.firstWindow();
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

      // 4. 重开命令面板, "打开设置" 不应在第一位 (Settings.order=4 在最后, View/Workspace/Panel/Window 都比它靠前)
      await win.keyboard.press("Meta+Shift+KeyP");
      await win.waitForTimeout(800);
      await expect(win.locator("[cmdk-item]").first()).not.toContainText(
        "打开设置"
      );
    } finally {
      await closePierApp(appContext);
    }
  });
});
