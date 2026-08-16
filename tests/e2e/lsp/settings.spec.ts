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

const PROJECT_ROOT = join(import.meta.dirname, "..", "..", "..");
const OUT_MAIN = join(PROJECT_ROOT, "out", "main", "index.js");
const SETTINGS_ACCELERATOR =
  process.platform === "darwin" ? "Meta+Comma" : "Control+Comma";

async function launch(userDataDir: string): Promise<ElectronApplication> {
  return await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: PROJECT_ROOT,
  });
}

async function openFilesSettings(window: Page): Promise<void> {
  await window.waitForLoadState("domcontentloaded");
  await window.waitForTimeout(1500);
  await window.keyboard.press(SETTINGS_ACCELERATOR);
  await expect(window.locator('[role="dialog"]')).toBeVisible({
    timeout: 5000,
  });
  await expect(
    window.locator('[data-testid="settings-nav-plugin-pier.files"]')
  ).toBeVisible({ timeout: 10_000 });
  await window
    .locator('[data-testid="settings-nav-plugin-pier.files"]')
    .click();
}

test("language service settings render and persist resource policy", async () => {
  test.setTimeout(60_000);
  const userDataDir = mkdtempSync(join(tmpdir(), "pier-lsp-e2e-"));
  let application: ElectronApplication | null = null;
  try {
    application = await launch(userDataDir);
    let window = await application.firstWindow();
    await openFilesSettings(window);

    const enabled = window.locator("#settings-lsp-enabled");
    const worktrees = window.locator("#settings-lsp-worktrees-enabled");
    const idleRelease = window.locator("#settings-lsp-idle-release-minutes");
    await expect(enabled).toHaveAttribute("aria-checked", "true");
    await expect(worktrees).toHaveAttribute("aria-checked", "true");
    await expect(idleRelease).toHaveValue("30");
    await expect(
      window.locator('[data-testid="lsp-tools-status-list"]')
    ).toBeVisible({ timeout: 15_000 });
    await expect(window.getByText("TypeScript / JavaScript")).toBeVisible();
    await worktrees.click();
    await expect(worktrees).toHaveAttribute("aria-checked", "false");
    await idleRelease.fill("45");
    await idleRelease.blur();
    await expect
      .poll(() =>
        window.evaluate(async () => {
          const preferences = await (
            globalThis as unknown as Window
          ).pier.preferences.read();
          return {
            idleReleaseMs: preferences.lsp.idleReleaseMs,
            worktreesEnabled: preferences.lsp.worktreesEnabled,
          };
        })
      )
      .toEqual({ idleReleaseMs: 2_700_000, worktreesEnabled: false });

    await application.close();
    application = await launch(userDataDir);
    window = await application.firstWindow();
    await openFilesSettings(window);
    await expect(
      window.locator("#settings-lsp-worktrees-enabled")
    ).toHaveAttribute("aria-checked", "false");
    await expect(
      window.locator('[data-testid="lsp-tools-status-list"]')
    ).toBeVisible();
    await expect(window.getByText("TypeScript / JavaScript")).toBeVisible();
    await expect(
      window.locator("#settings-lsp-idle-release-minutes")
    ).toHaveValue("45");
  } finally {
    await application?.close().catch(() => undefined);
    rmSync(userDataDir, { force: true, recursive: true });
  }
});
