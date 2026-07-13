import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";
import { setWindowSize } from "./mission-control-e2e-harness.ts";

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
 * 仅适用于"终端是活跃面板"的首启默认布局；恢复阶段活跃 tab 是指挥中心时，
 * 后台终端面板不挂 .terminal-anchor，不能用本函数（见下方恢复阶段的等待）。
 */
async function waitForAppShellReady(win: Page): Promise<void> {
  await win.waitForLoadState("domcontentloaded");
  await expect(win.locator(".terminal-anchor")).toHaveCount(1, {
    timeout: 15_000,
  });
}

/** 经命令面板执行"新建指挥中心"（renderer action 无 preload 直调通道，命令面板是标准入口）。 */
async function openMissionControlViaPalette(win: Page): Promise<void> {
  await win.keyboard.press("Meta+Shift+KeyP");
  await expect(win.locator("[cmdk-input]")).toBeVisible({ timeout: 10_000 });
  const item = win.locator("[cmdk-item]").filter({ hasText: "新建指挥中心" });
  await expect(item).toBeVisible({ timeout: 10_000 });
  await item.click();
}

async function addWidget(win: Page, widgetId: string): Promise<Locator> {
  await win.locator('[data-testid="mission-control-add-widget"]').click();
  await win
    .locator(`[data-testid="mission-control-widget-picker-item-${widgetId}"]`)
    .click();
  const card = win.locator(`[data-widget-id="${widgetId}"]`).last();
  await expect(card).toBeVisible({ timeout: 10_000 });
  return card;
}

test.describe("MissionControl widget persistence e2e", () => {
  test("新建指挥中心 → 添加 core activity widget → 重启 → 组装恢复", async () => {
    const userDataDir = mkdtempSync(
      join(tmpdir(), "pier-mission-control-e2e-")
    );
    try {
      // 第一次启动：新建指挥中心 + 添加 widget
      const firstApp = await launchPierApp(userDataDir);
      const firstWindow = await firstApp.firstWindow();
      await waitForAppShellReady(firstWindow);

      await openMissionControlViaPalette(firstWindow);

      // 空态指挥中心出现（Phase 1 mission-control-panel.tsx 的空态 testid）
      await firstWindow.waitForSelector(
        '[data-testid="mission-control-empty"]',
        {
          timeout: 5000,
        }
      );

      // 点击"添加组件"，选择 core.activity-overview
      await firstWindow
        .locator('[data-testid="mission-control-add-widget"]')
        .click();
      await firstWindow
        .locator(
          '[data-testid="mission-control-widget-picker-item-core.activity-overview"]'
        )
        .click();

      // 验证 widget 卡片出现
      await firstWindow.waitForSelector(
        '[data-testid="mission-control-widget-core.activity-overview"]',
        { timeout: 5000 }
      );

      // 关闭第一个 app 实例。布局保存有 500ms debounce，但 workspace-host
      // 的 beforeunload flush 会在关闭前立即补发 save（见 workspace-host.tsx）。
      await firstApp.close();

      // 第二次启动：验证恢复
      const restoredApp = await launchPierApp(userDataDir);
      try {
        const restoredWindow = await restoredApp.firstWindow();
        // 恢复的布局里指挥中心是活跃 tab，终端在后台 tab（dockview 不挂后台
        // 面板内容，.terminal-anchor 恒为 0）——直接等恢复目标本身。
        await restoredWindow.waitForLoadState("domcontentloaded");
        const widgetCard = restoredWindow.locator(
          '[data-testid="mission-control-widget-core.activity-overview"]'
        );
        await expect(widgetCard).toBeVisible({ timeout: 15_000 });
      } finally {
        await restoredApp.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test("排序和尺寸偏好在重启后恢复，响应式坐标不持久化", async () => {
    test.setTimeout(120_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-mc-x-e2e-"));
    try {
      const firstApp = await launchPierApp(userDataDir);
      const firstWindow = await firstApp.firstWindow();
      await waitForAppShellReady(firstWindow);
      await setWindowSize(firstApp, firstWindow, 1600, 1000);
      await openMissionControlViaPalette(firstWindow);
      const activity = await addWidget(firstWindow, "core.activity-overview");
      await addWidget(firstWindow, "core.system-resources");
      const handle = activity.locator(".mission-control-widget-drag-handle");
      await handle.press("ArrowRight");
      await handle.press("Shift+ArrowRight");
      await firstApp.close();

      const restoredApp = await launchPierApp(userDataDir);
      try {
        const restoredWindow = await restoredApp.firstWindow();
        await restoredWindow.waitForLoadState("domcontentloaded");
        await setWindowSize(restoredApp, restoredWindow, 1600, 1000);
        const grid = restoredWindow.locator(
          '[data-testid="mission-control-grid-wrapper"]'
        );
        const restoredActivity = restoredWindow.locator(
          '[data-testid="mission-control-widget-core.activity-overview"]'
        );
        await expect(restoredActivity).toBeVisible({ timeout: 15_000 });
        const order = await grid.evaluate((element) =>
          [
            ...element.querySelectorAll("[data-mission-control-instance-id]"),
          ].map((item) => item.getAttribute("data-mission-control-instance-id"))
        );
        expect(order).toEqual([
          "core.system-resources",
          "core.activity-overview",
        ]);
        const size = await restoredActivity.boundingBox();
        expect(size?.width).toBeGreaterThan(450);
        const viewport = grid.locator("..");
        expect(
          await viewport.evaluate(
            (element) => element.scrollWidth <= element.clientWidth
          )
        ).toBe(true);
      } finally {
        await restoredApp.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
