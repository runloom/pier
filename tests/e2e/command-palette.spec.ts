import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
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

/**
 * 等 workspace 完成异步布局恢复并挂出终端面板。此时 app shell 的 mount
 * effects(含全局 keydown 快捷键监听)必然已注册 — domcontentloaded 太早,
 * CDP 按键会在监听器挂上前被丢掉。
 */
async function waitForAppShellReady(win: Page): Promise<void> {
  await win.waitForLoadState("domcontentloaded");
  await expect(win.locator(".terminal-anchor")).toHaveCount(1, {
    timeout: 15_000,
  });
}

test.describe("Command Palette e2e", () => {
  test("Cmd+Shift+P opens command palette with settings actions", async () => {
    const appContext = await launchPierApp();
    try {
      const win = await appContext.app.firstWindow();
      await waitForAppShellReady(win);

      // 初始无 dialog
      const dialog = win.locator('[role="dialog"]');
      await expect(dialog).not.toBeAttached({ timeout: 3000 });

      // Cmd+Shift+P 打开命令面板
      await win.keyboard.press("Meta+Shift+KeyP");
      await expect(win.locator("[cmdk-input]")).toBeVisible({
        timeout: 10_000,
      });

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
      await waitForAppShellReady(win);

      await win.keyboard.press("Meta+Shift+KeyP");
      await expect(win.locator("[cmdk-input]")).toBeVisible({
        timeout: 10_000,
      });
      const terminalListItem = win
        .locator("[cmdk-item]")
        .filter({ hasText: "终端列表..." });
      await expect(terminalListItem).toBeVisible({ timeout: 10_000 });
      await terminalListItem.click();

      await expect(win.locator("[cmdk-input]")).toHaveAttribute(
        "placeholder",
        "搜索终端、窗口或目录…"
      );
      await expect(
        win.locator("[cmdk-item]").filter({ hasText: "当前终端" })
      ).toHaveCount(0);
      await expect(
        win.locator("[cmdk-group-heading]").filter({
          hasText: "第 1 组",
        })
      ).toBeVisible();
      await expect(
        win.locator("[cmdk-group-heading]").filter({ hasText: "窗口 1" })
      ).toHaveCount(0);
      await expect(
        win.locator("[cmdk-group-heading]").filter({ hasText: "当前窗口" })
      ).toHaveCount(0);
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
      await waitForAppShellReady(win);

      // 1. 打开命令面板, 执行 "打开设置" (handler 不开 quick-pick)
      await win.keyboard.press("Meta+Shift+KeyP");
      await expect(win.locator("[cmdk-input]")).toBeVisible({
        timeout: 10_000,
      });
      const openSettingsItem = win
        .locator("[cmdk-item]")
        .filter({ hasText: "打开设置" });
      await expect(openSettingsItem).toBeVisible({ timeout: 10_000 });
      await openSettingsItem.click();
      // 设置弹窗打开 (命令面板随之关闭), Esc 关掉设置
      const settingsNav = win.locator(
        '[data-testid="settings-nav-appearance"]'
      );
      await expect(settingsNav).toBeVisible({ timeout: 10_000 });
      await expect(win.locator("[cmdk-input]")).not.toBeAttached({
        timeout: 10_000,
      });
      await win.keyboard.press("Escape");
      await expect(settingsNav).not.toBeAttached({ timeout: 10_000 });

      // 2. 重开命令面板
      await win.keyboard.press("Meta+Shift+KeyP");
      await expect(win.locator("[cmdk-input]")).toBeVisible({
        timeout: 10_000,
      });

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
      await waitForAppShellReady(win);

      // 1. 执行 "打开设置" 让它进 MRU
      await win.keyboard.press("Meta+Shift+KeyP");
      await expect(win.locator("[cmdk-input]")).toBeVisible({
        timeout: 10_000,
      });
      const openSettingsItem = win
        .locator("[cmdk-item]")
        .filter({ hasText: "打开设置" });
      await expect(openSettingsItem).toBeVisible({ timeout: 10_000 });
      await openSettingsItem.click();
      // 设置弹窗打开 (命令面板随之关闭), Esc 关掉设置
      const settingsNav = win.locator(
        '[data-testid="settings-nav-appearance"]'
      );
      await expect(settingsNav).toBeVisible({ timeout: 10_000 });
      await expect(win.locator("[cmdk-input]")).not.toBeAttached({
        timeout: 10_000,
      });
      await win.keyboard.press("Escape");
      await expect(settingsNav).not.toBeAttached({ timeout: 10_000 });

      // 2. 验证它确实顶置 (sanity check)
      await win.keyboard.press("Meta+Shift+KeyP");
      await expect(win.locator("[cmdk-input]")).toBeVisible({
        timeout: 10_000,
      });
      await expect(win.locator("[cmdk-item]").first()).toContainText(
        "打开设置"
      );

      // 3. 触发清空
      const clearItem = win
        .locator("[cmdk-item]")
        .filter({ hasText: "清空命令面板使用记录" });
      await expect(clearItem).toBeVisible({ timeout: 10_000 });
      await clearItem.click();
      // 执行后命令面板关闭
      await expect(win.locator("[cmdk-input]")).not.toBeAttached({
        timeout: 10_000,
      });

      // 4. 重开命令面板, "打开设置" 不应在第一位 (Settings.order=4 在最后, View/Workspace/Panel/Window 都比它靠前)
      await win.keyboard.press("Meta+Shift+KeyP");
      await expect(win.locator("[cmdk-input]")).toBeVisible({
        timeout: 10_000,
      });
      await expect(win.locator("[cmdk-item]").first()).not.toContainText(
        "打开设置"
      );
    } finally {
      await closePierApp(appContext);
    }
  });
});
