import { expect, test } from "@playwright/test";
import { closeApp, launchApp } from "../workbench/e2e-harness.ts";

test.describe("Workbench search", () => {
  test("新建面板支持用工作台拼音搜索", async () => {
    test.setTimeout(60_000);
    const context = await launchApp();
    try {
      const { win } = context;
      const consoleErrors: string[] = [];
      win.on("console", (message) => {
        if (message.type() === "error") {
          consoleErrors.push(message.text());
        }
      });

      await expect(win.locator("body")).toBeVisible();
      await expect(win).toHaveTitle(/Pier/);
      await expect(win.locator(".terminal-anchor")).toHaveCount(1, {
        timeout: 20_000,
      });
      // Tab chrome "+" uses short aria-label (新建 / New); dialog title is longer.
      const createButton = win
        .getByRole("button", { name: /^(新建|New)$/u })
        .first();
      await expect(createButton).toBeVisible({ timeout: 15_000 });
      await createButton.click();

      const input = win.locator("[cmdk-input]");
      await expect(input).toBeVisible({ timeout: 10_000 });
      const workbench = win
        .locator("[cmdk-item]")
        .filter({ hasText: /新建工作台|New Workbench/ });
      await input.fill("gongzuo");
      await expect(workbench).toBeVisible({ timeout: 15_000 });
      await input.fill("gongzuotai");
      await expect(workbench).toBeVisible({ timeout: 15_000 });
      await expect(win.locator("vite-error-overlay")).toHaveCount(0);
      expect(consoleErrors).toEqual([]);

      const screenshotPath = process.env.PIER_E2E_SCREENSHOT_PATH;
      if (screenshotPath) {
        await win.screenshot({ path: screenshotPath });
      }
    } finally {
      await closeApp(context);
    }
  });
});
