import { expect, type Page, test } from "@playwright/test";
import {
  closeApp,
  installCodexPlugin,
  launchApp,
  setWindowSize,
} from "./workbench-e2e-harness.ts";

interface AppearanceGeometry {
  cardWidth: number;
  dialogWidth: number;
  fieldDisplay: string;
}

async function openAppearanceSettings(win: Page): Promise<AppearanceGeometry> {
  await win.keyboard.press("Meta+Comma");
  const dialog = win.locator('[data-slot="dialog-content"]');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await win.locator('[data-testid="settings-nav-appearance"]').click();

  const main = dialog.locator("main");
  const card = main.locator('[data-slot="card"]').first();
  const field = card.locator('[data-slot="field"]').first();
  await expect(card).toBeVisible();
  await expect(field).toBeVisible();

  const dialogBox = await dialog.boundingBox();
  const cardBox = await card.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  return {
    cardWidth: cardBox?.width ?? 0,
    dialogWidth: dialogBox?.width ?? 0,
    fieldDisplay: await field.evaluate(
      (element) => getComputedStyle(element).display
    ),
  };
}

async function closeSettings(win: Page): Promise<void> {
  const dialog = win.locator('[data-slot="dialog-content"]');
  await dialog.getByRole("button", { name: /关闭|Close/ }).click();
  await expect(dialog).toHaveCount(0);
}

test("Codex 插件样式只作用于插件界面，不改变宿主设置页", async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(180_000);
  const context = await launchApp();
  try {
    await setWindowSize(context.app, context.win, 1600, 1000);
    const before = await openAppearanceSettings(context.win);
    await closeSettings(context.win);

    await installCodexPlugin(context);
    await setWindowSize(context.app, context.win, 1600, 1000);
    const after = await openAppearanceSettings(context.win);

    expect(after.dialogWidth).toBeCloseTo(before.dialogWidth, 0);
    expect(after.cardWidth).toBeCloseTo(before.cardWidth, 0);
    expect(after.fieldDisplay).toBe(before.fieldDisplay);

    const appearanceScreenshotPath = testInfo.outputPath(
      "appearance-after-codex-load.png"
    );
    await context.win.screenshot({ path: appearanceScreenshotPath });
    await testInfo.attach("appearance-after-codex-load", {
      contentType: "image/png",
      path: appearanceScreenshotPath,
    });

    await context.win
      .locator('[data-testid="settings-nav-plugin-pier.codex"]')
      .click();
    const pluginScope = context.win.locator("[data-pier-codex-scope]").first();
    await expect(pluginScope).toHaveCount(1);
    await expect(
      context.win.getByRole("heading", { name: /Codex 账号|Codex Accounts/ })
    ).toBeVisible();

    const screenshotPath = testInfo.outputPath("codex-style-isolation.png");
    await context.win.screenshot({ path: screenshotPath });
    await testInfo.attach("codex-style-isolation", {
      contentType: "image/png",
      path: screenshotPath,
    });
  } finally {
    await closeApp(context);
  }
});
