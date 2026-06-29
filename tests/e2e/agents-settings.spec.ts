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
  const userDataDir = mkdtempSync(join(tmpdir(), "pier-agents-e2e-"));
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

test.describe("Agents Settings e2e", () => {
  test("智能体设置区域可见并渲染 Auto 选项和 claude agent 行", async () => {
    // Electron 冷启动 + React 挂载需要比默认 30s 更多余量
    test.setTimeout(60_000);
    const appContext = await launchPierApp();
    try {
      const win = await appContext.app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      // 命令面板打开设置（等待 React 完全挂载后再发键）
      await win.waitForTimeout(1500);
      await win.keyboard.press("Meta+Shift+KeyP");
      await win.waitForTimeout(1000);
      await win.locator("[cmdk-item]").filter({ hasText: "打开设置" }).click();
      await win.waitForTimeout(600);

      // 设置 dialog 应该出现
      const dialog = win.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // 点击侧边栏 "智能体" nav 项（取第一个以规避严格模式）
      await win.locator("button").filter({ hasText: "智能体" }).first().click();
      await win.waitForTimeout(600);

      // 断言 1：catalog 中 claude 行始终渲染（不依赖机器是否安装 claude）
      await expect(win.locator('[data-testid="agent-row-claude"]')).toBeVisible(
        { timeout: 8000 }
      );

      // 断言 2：区域标题 "智能体" 可见（nav 按钮和 h1 都有此文本，first() 取到其中一个即可）
      await expect(
        win.getByText("智能体", { exact: true }).first()
      ).toBeVisible({ timeout: 3000 });

      // 断言 3：Auto 芯片（始终渲染，不依赖检测结果）
      await expect(win.getByText("自动", { exact: true }).first()).toBeVisible({
        timeout: 3000,
      });
    } finally {
      await closePierApp(appContext);
    }
  });

  test("展开 claude agent 行显示启动命令", async () => {
    test.setTimeout(60_000);
    const appContext = await launchPierApp();
    try {
      const win = await appContext.app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      // 打开设置，进入智能体区域
      await win.waitForTimeout(1500);
      await win.keyboard.press("Meta+Shift+KeyP");
      await win.waitForTimeout(1000);
      await win.locator("[cmdk-item]").filter({ hasText: "打开设置" }).click();
      await win.waitForTimeout(600);

      const dialog = win.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      await win.locator("button").filter({ hasText: "智能体" }).first().click();
      await win.waitForTimeout(600);

      // claude agent 行始终渲染
      const claudeRow = win.locator('[data-testid="agent-row-claude"]');
      await expect(claudeRow).toBeVisible({ timeout: 8000 });

      // 展开详情
      await claudeRow.getByRole("button", { name: "详情" }).click();
      await win.waitForTimeout(400);

      // 展开后可见启动命令 "claude"（固定来自 AGENT_CATALOG，不依赖机器环境）
      await expect(
        claudeRow.locator(".font-mono").filter({ hasText: "claude" }).first()
      ).toBeVisible({ timeout: 3000 });
    } finally {
      await closePierApp(appContext);
    }
  });
});
