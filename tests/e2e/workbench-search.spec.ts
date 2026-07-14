import { expect, test } from "@playwright/test";
import { closeApp, launchApp } from "./workbench-e2e-harness.ts";

test.describe("Workbench search", () => {
  test("新建面板支持用工作台拼音搜索", async () => {
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
      await win
        .getByRole("button", {
          name: /在此面板组中新建|Create in this panel group/,
        })
        .click();

      const input = win.locator("[cmdk-input]");
      const workbench = win
        .locator("[cmdk-item]")
        .filter({ hasText: /新建工作台|New Workbench/ });
      await input.fill("gongzuo");
      await expect(workbench).toBeVisible();
      await input.fill("gongzuotai");
      await expect(workbench).toBeVisible();
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
