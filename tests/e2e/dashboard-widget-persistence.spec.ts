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

async function launchPierApp(
  userDataDir: string
): Promise<ElectronApplication> {
  return await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
  });
}

/**
 * 等 workspace 完成异步布局恢复并挂出终端面板（对齐 command-palette.spec.ts
 * 的 waitForAppShellReady：domcontentloaded 太早，此时全局 keydown 监听
 * 尚未注册，CDP 按键会被丢掉）。
 *
 * 仅适用于"终端是活跃面板"的首启默认布局；恢复阶段活跃 tab 是大盘时，
 * 后台终端面板不挂 .terminal-anchor，不能用本函数（见下方恢复阶段的等待）。
 */
async function waitForAppShellReady(win: Page): Promise<void> {
  await win.waitForLoadState("domcontentloaded");
  await expect(win.locator(".terminal-anchor")).toHaveCount(1, {
    timeout: 15_000,
  });
}

/** 经命令面板执行"新建大盘"（renderer action 无 preload 直调通道，命令面板是标准入口）。 */
async function openDashboardViaPalette(win: Page): Promise<void> {
  await win.keyboard.press("Meta+Shift+KeyP");
  await expect(win.locator("[cmdk-input]")).toBeVisible({ timeout: 10_000 });
  const item = win.locator("[cmdk-item]").filter({ hasText: "新建大盘" });
  await expect(item).toBeVisible({ timeout: 10_000 });
  await item.click();
}

test.describe("Dashboard widget persistence e2e", () => {
  test("新建大盘 → 添加 core activity widget → 重启 → 组装恢复", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-dashboard-e2e-"));
    try {
      // 第一次启动：新建大盘 + 添加 widget
      const firstApp = await launchPierApp(userDataDir);
      const firstWindow = await firstApp.firstWindow();
      await waitForAppShellReady(firstWindow);

      await openDashboardViaPalette(firstWindow);

      // 空态大盘出现（Phase 1 dashboard-panel.tsx 的空态 testid）
      await firstWindow.waitForSelector('[data-testid="dashboard-empty"]', {
        timeout: 5000,
      });

      // 点击"添加组件"，选择 core.activity-overview
      await firstWindow.locator('[data-testid="dashboard-add-widget"]').click();
      await firstWindow
        .locator(
          '[data-testid="dashboard-widget-picker-item-core.activity-overview"]'
        )
        .click();

      // 验证 widget 卡片出现
      await firstWindow.waitForSelector(
        '[data-testid="dashboard-widget-core.activity-overview"]',
        { timeout: 5000 }
      );

      // 关闭第一个 app 实例。布局保存有 500ms debounce，但 workspace-host
      // 的 beforeunload flush 会在关闭前立即补发 save（见 workspace-host.tsx）。
      await firstApp.close();

      // 第二次启动：验证恢复
      const restoredApp = await launchPierApp(userDataDir);
      try {
        const restoredWindow = await restoredApp.firstWindow();
        // 恢复的布局里大盘是活跃 tab，终端在后台 tab（dockview 不挂后台
        // 面板内容，.terminal-anchor 恒为 0）——直接等恢复目标本身。
        await restoredWindow.waitForLoadState("domcontentloaded");
        const widgetCard = restoredWindow.locator(
          '[data-testid="dashboard-widget-core.activity-overview"]'
        );
        await expect(widgetCard).toBeVisible({ timeout: 15_000 });
      } finally {
        await restoredApp.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
