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
  "..",
  "out",
  "main",
  "index.js"
);

test.skip(process.platform !== "darwin", "native terminal is macOS-only");

/**
 * 通知中心 popover 与终端键盘/鼠标路由的共存验证：
 * 1. popover 打开期间注册全屏 overlay + 键盘钉在 web（debugSnapshot 可观测）。
 * 2. popover 打开时全局快捷键（⌘⇧P 命令面板 / ⌘, 设置）仍然生效。
 * 3. 模拟「点终端」意图后 popover 可被关闭（outside pointerdown 路由到 web）。
 */

interface DebugSnapshot {
  coordinator?: {
    desired?: {
      webOverlayRects?: { frame: unknown; id: string }[];
      webRequestCount?: number;
    };
  };
}

function readSnapshot(win: Page): Promise<DebugSnapshot> {
  return win.evaluate(() =>
    (
      window as unknown as {
        pier: { terminal: { debugSnapshot: () => Promise<DebugSnapshot> } };
      }
    ).pier.terminal.debugSnapshot()
  );
}

function webRequestCount(snapshot: DebugSnapshot): number {
  return snapshot.coordinator?.desired?.webRequestCount ?? 0;
}

function hasNotificationOverlay(snapshot: DebugSnapshot): boolean {
  return (snapshot.coordinator?.desired?.webOverlayRects ?? []).some((rect) =>
    rect.id.includes("overlay:notification-center")
  );
}

async function waitForAppShellReady(win: Page): Promise<void> {
  await win.waitForLoadState("domcontentloaded");
  await expect(win.locator(".terminal-anchor")).toHaveCount(1, {
    timeout: 15_000,
  });
}

async function readTerminalPanelId(win: Page): Promise<string> {
  const tab = win.locator('[data-panel-tab-id^="terminal-"]').first();
  await expect(tab).toBeAttached({ timeout: 10_000 });
  const panelId = await tab.getAttribute("data-panel-tab-id");
  if (!panelId) {
    throw new Error("terminal panel id not found in DOM");
  }
  return panelId;
}

/** 模拟「点终端内容区」焦点意图（native 同一条 IPC）。 */
async function simulateTerminalFocusIntent(
  app: ElectronApplication,
  panelId: string
): Promise<void> {
  await app.evaluate(({ webContents }, targetPanelId) => {
    for (const contents of webContents.getAllWebContents()) {
      if (contents.getType() === "window" && !contents.isDestroyed()) {
        contents.send("pier:terminal:focus-request", {
          panelId: targetPanelId,
          reason: "mouse-down",
        });
      }
    }
  }, panelId);
}

test.describe("Notification center popover coexistence e2e", () => {
  test("popover keeps global shortcuts alive and registers terminal routing", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-nc-e2e-"));
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await waitForAppShellReady(win);
      const panelId = await readTerminalPanelId(win);

      // 0. 先让键盘目标翻回终端（用户真实起点：终端持有键盘）
      await simulateTerminalFocusIntent(app, panelId);
      await expect
        .poll(async () => webRequestCount(await readSnapshot(win)), {
          timeout: 5000,
        })
        .toBe(0);

      // 1. 打开 popover：注册全屏 overlay + 键盘钉在 web
      await win.locator('[data-testid="notification-center-bell"]').click();
      const popover = win.locator('[data-slot="popover-content"]');
      await expect(popover).toBeVisible({ timeout: 5000 });
      await expect
        .poll(async () => webRequestCount(await readSnapshot(win)), {
          timeout: 5000,
        })
        .toBeGreaterThanOrEqual(1);
      await expect
        .poll(async () => hasNotificationOverlay(await readSnapshot(win)), {
          timeout: 5000,
        })
        .toBe(true);

      // 2. popover 打开时 ⌘⇧P 命令面板仍然生效
      await win.keyboard.press("Meta+Shift+KeyP");
      await expect(win.locator("[cmdk-input]")).toBeVisible({
        timeout: 10_000,
      });
      await win.keyboard.press("Escape");

      // 3. 重新打开 popover，⌘, 设置仍然生效
      await win.locator('[data-testid="notification-center-bell"]').click();
      await expect(popover).toBeVisible({ timeout: 5000 });
      await win.keyboard.press("Meta+Comma");
      await expect(
        win.locator('[data-slot="dialog-content"]').first()
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
