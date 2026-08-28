import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
} from "@playwright/test";

const OUT_MAIN = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "out",
  "main",
  "index.js"
);
const PROJECT_ROOT = join(import.meta.dirname, "..", "..", "..");

export interface AppContext {
  app: ElectronApplication;
  userDataDir: string;
  win: Page;
}

export interface AppTheme {
  id: "dark" | "light";
  label: RegExp;
}

export async function launchApp(): Promise<AppContext> {
  const userDataDir = mkdtempSync(join(tmpdir(), "pier-e2e-"));
  const app = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: PROJECT_ROOT,
    env: { ...process.env, CODEX_HOME: join(userDataDir, "codex-home") },
  });
  const win = await app.firstWindow();
  await waitForAppShellReady(win);
  return { app, userDataDir, win };
}

export async function closeApp(context: AppContext): Promise<void> {
  await context.app.close();
  rmSync(context.userDataDir, { recursive: true, force: true });
}

async function waitForAppShellReady(win: Page): Promise<void> {
  await win.waitForLoadState("domcontentloaded");
  await expect(win.locator(".terminal-anchor")).toHaveCount(1, {
    timeout: 15_000,
  });
}

export async function setWindowSize(
  app: ElectronApplication,
  win: Page,
  width: number,
  height: number
): Promise<void> {
  // CI macOS 虚拟屏常夹高度（请求 800 → 实际 ~684），且 content size 与
  // page.inner* 可能短暂不一致。只保证可用下限，不硬等请求尺寸。
  const minWidth = Math.min(width, 1024);
  const minHeight = Math.min(height, 600);
  const applied = await app.evaluate(
    ({ BaseWindow, screen }, size) => {
      const targetWindow = BaseWindow.getAllWindows()[0];
      if (!targetWindow) {
        throw new Error("Expected Pier BaseWindow before resizing");
      }
      const display = screen.getDisplayMatching(targetWindow.getBounds());
      const work = display.workArea;
      targetWindow.setPosition(work.x, work.y);
      const nextWidth = Math.min(size.width, Math.max(320, work.width));
      const nextHeight = Math.min(size.height, Math.max(240, work.height));
      targetWindow.setContentSize(nextWidth, nextHeight);
      let [contentWidth = nextWidth, contentHeight = nextHeight] =
        targetWindow.getContentSize();
      if (contentWidth < nextWidth || contentHeight < nextHeight) {
        targetWindow.setSize(nextWidth, nextHeight);
        [contentWidth = nextWidth, contentHeight = nextHeight] =
          targetWindow.getContentSize();
      }
      return {
        height: contentHeight,
        id: targetWindow.id,
        width: contentWidth,
      };
    },
    { height, width }
  );
  expect(applied.id).toBeGreaterThan(0);
  await expect
    .poll(
      async () => {
        const metrics = await win.evaluate(() => ({
          height: window.innerHeight,
          width: window.innerWidth,
        }));
        if (metrics.width < minWidth || metrics.height < minHeight) {
          await app.evaluate(
            ({ BaseWindow }, size) => {
              const targetWindow = BaseWindow.getAllWindows()[0];
              targetWindow?.setContentSize(size.width, size.height);
            },
            {
              height: Math.max(applied.height, minHeight),
              width: Math.max(applied.width, minWidth),
            }
          );
        }
        return metrics.width >= minWidth && metrics.height >= minHeight;
      },
      { timeout: 8000 }
    )
    .toBe(true);
}

async function openPaletteAction(win: Page, name: RegExp): Promise<void> {
  await win.keyboard.press("Meta+Shift+KeyP");
  const input = win.locator("[cmdk-input]");
  await expect(input).toBeVisible({ timeout: 10_000 });
  const queries = name.source
    .split("|")
    .map((part) => part.replaceAll("\\", ""))
    .filter((part) => part.length > 0);
  const item = win.locator("[cmdk-item]").filter({ hasText: name });
  // CI runners are usually English; the first alternative is often Chinese.
  // Try each locale string so filtering does not empty the list.
  for (const query of queries) {
    await input.fill(query);
    try {
      await expect(item).toBeVisible({ timeout: 2500 });
      await item.click();
      return;
    } catch {
      // Try the next locale label.
    }
  }
  await input.fill("");
  await expect(item).toBeVisible({ timeout: 10_000 });
  await item.click();
}

export async function openWelcomeTab(win: Page): Promise<void> {
  await openPaletteAction(win, /新建标签|New Tab|新規タブ|새 탭/);
  await expect(win.locator('[data-panel-tab-id^="welcome-"]')).toBeVisible({
    timeout: 10_000,
  });
}

export async function selectTheme(win: Page, theme: AppTheme): Promise<void> {
  await openPaletteAction(win, /选择主题|Select Theme|テーマを選択|테마 선택/);
  const option = win.locator("[cmdk-item]").filter({ hasText: theme.label });
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();
  const root = win.locator("html");
  if (theme.id === "light") {
    await expect(root).toHaveClass(/light/);
  } else {
    await expect(root).toHaveClass(/dark/);
  }
  await expect
    .poll(() => win.evaluate(() => window.pier.preferences.read()), {
      timeout: 10_000,
    })
    .toMatchObject({ theme: theme.id });
}

export async function installCodexPlugin(context: AppContext): Promise<void> {
  const { win } = context;
  await win.keyboard.press("Meta+Comma");
  await expect(win.locator('[role="dialog"][data-state="open"]')).toBeVisible({
    timeout: 10_000,
  });
  await win.locator('[data-testid="settings-nav-plugins"]').click();
  const row = win.locator('[data-testid="plugin-row-pier.codex"]');
  const installedTab = win.getByRole("tab", { name: /已安装|Installed/ });
  await installedTab.click();
  if (!(await row.isVisible())) {
    await win.getByRole("tab", { name: /未安装|Available/ }).click();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByRole("button", { name: /安装|Install/ }).click();
    await installedTab.click();
  }
  await expect(
    win.locator('[data-testid="plugin-row-pier.codex"]')
  ).toBeVisible({ timeout: 30_000 });
  await win
    .locator('[role="dialog"][data-state="open"]')
    .getByRole("button", { name: /关闭|Close/ })
    .click();
  await expect(
    win.locator('[role="dialog"], [data-slot="dialog-overlay"]')
  ).toHaveCount(0);

  // External main modules are snapshotted at startup; relaunch before exercising RPC-backed UI.
  await context.app.close();
  context.app = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${context.userDataDir}`],
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      CODEX_HOME: join(context.userDataDir, "codex-home"),
    },
  });
  context.win = await context.app.firstWindow();
  await waitForAppShellReady(context.win);
}
