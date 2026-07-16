import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";

const OUT_MAIN = join(
  import.meta.dirname,
  "..",
  "..",
  "out",
  "main",
  "index.js"
);
const PROJECT_ROOT = join(import.meta.dirname, "..", "..");
const GRID_MARGIN = 12;
const VERTICAL_GRID_STRIDE = 100;

export interface AppContext {
  app: ElectronApplication;
  userDataDir: string;
  win: Page;
}

export interface GridSize {
  h: number;
  w: number;
}

export interface WorkbenchTheme {
  id: "dark" | "light";
  label: RegExp;
}

export async function launchApp(): Promise<AppContext> {
  const userDataDir = mkdtempSync(join(tmpdir(), "pier-mc-canvas-e2e-"));
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
  // CI macOS 虚拟屏可能夹住高度（例如请求 800 只剩 ~684）。
  // 这里设 content size，再以 Electron 实际 content size 对齐 window.inner*，
  // 不把「请求值」当硬断言，避免 title bar / 屏高夹持导致全套 e2e 起不来。
  const applied = await app.evaluate(
    ({ BaseWindow, screen }, size) => {
      const targetWindow = BaseWindow.getAllWindows()[0];
      if (!targetWindow) {
        throw new Error("Expected Pier BaseWindow before resizing");
      }
      const display = screen.getDisplayMatching(targetWindow.getBounds());
      const work = display.workArea;
      // 先挪到 workArea 左上，减少被屏外裁切的概率。
      targetWindow.setPosition(work.x, work.y);
      const maxWidth = Math.max(320, work.width);
      const maxHeight = Math.max(240, work.height);
      const nextWidth = Math.min(size.width, maxWidth);
      const nextHeight = Math.min(size.height, maxHeight);
      targetWindow.setContentSize(nextWidth, nextHeight);
      const [contentWidth = nextWidth, contentHeight = nextHeight] =
        targetWindow.getContentSize();
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
      () =>
        win.evaluate(() => ({
          height: window.innerHeight,
          width: window.innerWidth,
        })),
      { timeout: 5000 }
    )
    .toEqual({ height: applied.height, width: applied.width });
  // 仍保证有可用工作区，避免夹到不可用的极小窗。
  expect(applied.width).toBeGreaterThanOrEqual(Math.min(width, 1024));
  expect(applied.height).toBeGreaterThanOrEqual(Math.min(height, 600));
}

async function openPaletteAction(win: Page, name: RegExp): Promise<void> {
  await win.keyboard.press("Meta+Shift+KeyP");
  await expect(win.locator("[cmdk-input]")).toBeVisible({ timeout: 10_000 });
  const item = win.locator("[cmdk-item]").filter({ hasText: name });
  await expect(item).toBeVisible({ timeout: 10_000 });
  await item.click();
}

export async function openWorkbench(win: Page): Promise<void> {
  await openPaletteAction(win, /新建工作台|New Workbench/);
  await expect(
    win.locator('[data-testid="workbench-grid-wrapper"]')
  ).toBeVisible({ timeout: 10_000 });
}

export async function selectTheme(
  win: Page,
  theme: WorkbenchTheme
): Promise<void> {
  await openPaletteAction(win, /选择主题|Select Theme/);
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
  await win.getByRole("tab", { name: /未安装|Available/ }).click();
  const row = win.locator('[data-testid="plugin-row-pier.codex"]');
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.getByRole("button", { name: /安装|Install/ }).click();
  await win.getByRole("tab", { name: /已安装|Installed/ }).click();
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

function gridItemForCard(win: Page, card: Locator): Locator {
  return win.locator(".react-grid-item").filter({ has: card });
}

export function canvasViewport(win: Page): Locator {
  return win.locator('[data-testid="workbench-grid-wrapper"]').locator("..");
}

export async function addWidget(win: Page, widgetId: string): Promise<Locator> {
  const cards = win.locator(`[data-widget-id="${widgetId}"]`);
  const previousCount = await cards.count();
  const add = win.locator('[data-testid="workbench-add-widget"]');
  await add.scrollIntoViewIfNeeded();
  await add.click();
  await expect(win.locator('[data-testid="workbench-library"]')).toBeVisible();
  await win
    .locator(`[data-testid="workbench-widget-picker-item-${widgetId}"]`)
    .click();
  await expect(cards).toHaveCount(previousCount + 1, { timeout: 10_000 });
  const card = cards.nth(previousCount);
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
  return card;
}

export async function viewportMetrics(viewport: Locator) {
  return await viewport.evaluate((element) => ({
    clientHeight: element.clientHeight,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
    scrollWidth: element.scrollWidth,
  }));
}

export async function resizeToBoundary(
  win: Page,
  card: Locator,
  expected: GridSize
): Promise<void> {
  const item = gridItemForCard(win, card);
  const handle = item.locator(".react-resizable-handle-se");
  const wrapper = win.locator('[data-testid="workbench-grid-wrapper"]');
  const grid = wrapper.locator(".react-grid-layout").first();
  const [gridBox, colsRaw] = await Promise.all([
    grid.boundingBox(),
    wrapper.getAttribute("data-responsive-cols"),
  ]);
  const cols = Number(colsRaw);
  if (!(gridBox && Number.isInteger(cols) && cols > 0)) {
    throw new Error("Workbench live grid geometry is unavailable");
  }
  const columnWidth = (gridBox.width - (cols - 1) * GRID_MARGIN) / cols;
  const target = {
    height: expected.h * VERTICAL_GRID_STRIDE - GRID_MARGIN,
    width: Math.round(
      expected.w * columnWidth + (expected.w - 1) * GRID_MARGIN
    ),
  };
  const readSize = async (): Promise<{
    height: number;
    width: number;
  } | null> => {
    const box = await item.boundingBox();
    return box
      ? { height: Math.round(box.height), width: Math.round(box.width) }
      : null;
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readSize();
    if (!current) {
      throw new Error("Workbench grid item has no bounding box");
    }
    if (current.height === target.height && current.width === target.width) {
      return;
    }
    await handle.scrollIntoViewIfNeeded();
    const box = await handle.boundingBox();
    if (!box) {
      throw new Error("Workbench resize handle has no bounding box");
    }
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await win.mouse.move(startX, startY);
    await win.mouse.down();
    await win.mouse.move(
      Math.max(1, startX + Math.sign(target.width - current.width) * 1600),
      Math.max(1, startY + Math.sign(target.height - current.height) * 1600),
      { steps: 32 }
    );
    await win.mouse.up();
    try {
      await expect.poll(readSize, { timeout: 3000 }).toEqual(target);
      return;
    } catch {}
  }
  await expect.poll(readSize, { timeout: 5000 }).toEqual(target);
}
