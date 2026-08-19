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
const PROJECT_ROOT = join(import.meta.dirname, "..", "..", "..");
const SETTINGS_ACCELERATOR =
  process.platform === "darwin" ? "Meta+Comma" : "Control+Comma";

async function launchPierApp(
  userDataDir: string
): Promise<ElectronApplication> {
  return await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: PROJECT_ROOT,
  });
}

async function waitForWorkspaceReady(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page
    .locator('[data-testid="workspace-host-root"][data-workspace-ready="true"]')
    .waitFor({ state: "visible", timeout: 30_000 });
}

test.describe("Native splits plugin e2e", () => {
  test("enabled pier.tmux has no settings page; toggle lives on the plugin itself", async () => {
    test.setTimeout(90_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-tmux-e2e-"));
    let app: ElectronApplication | undefined;
    try {
      app = await launchPierApp(userDataDir);
      const win = await app.firstWindow();
      await waitForWorkspaceReady(win);
      await win.keyboard.press(SETTINGS_ACCELERATOR);
      await expect(win.locator('[role="dialog"]')).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        win.locator('[data-testid="settings-nav-plugin-pier.tmux"]')
      ).toHaveCount(0);

      await win.locator('[data-testid="settings-nav-plugins"]').click();
      const row = win.locator('[data-testid="plugin-row-pier.tmux"]');
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row.getByText(/Native splits|工作台分屏/)).toBeVisible();
      await expect(
        win.locator('[data-testid="plugin-settings-link-pier.tmux"]')
      ).toHaveCount(0);
    } finally {
      await app?.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
