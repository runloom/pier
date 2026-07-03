import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const OUT_MAIN = join(
  import.meta.dirname,
  "..",
  "..",
  "out",
  "main",
  "index.js"
);

test.describe("Startup stability e2e", () => {
  test("restores the last focused open window in the foreground", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-startup-e2e-"));
    let secondRecordId = "";
    try {
      const firstApp = await electron.launch({
        args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
      });
      const firstWindow = await firstApp.firstWindow();
      await firstWindow.waitForLoadState("domcontentloaded");

      const secondWindowPromise = firstApp.waitForEvent("window");
      await firstWindow.evaluate(() => window.pier.createWindow());
      const secondWindow = await secondWindowPromise;
      await secondWindow.waitForLoadState("domcontentloaded");
      const secondContext = await secondWindow.evaluate(() =>
        window.pier.window.getContext()
      );
      secondRecordId = secondContext.recordId;

      await firstWindow.evaluate(
        (windowId) => window.pier.focusWindow(windowId),
        secondContext.windowId
      );
      await expect
        .poll(async () => {
          const windows = await firstWindow.evaluate(() =>
            window.pier.listWindows()
          );
          return windows.find((win) => win.recordId === secondRecordId)
            ?.focused;
        })
        .toBe(true);

      await firstApp.close();

      const restoredApp = await electron.launch({
        args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
      });
      try {
        const restoredWindow = await restoredApp.firstWindow();
        await restoredWindow.waitForLoadState("domcontentloaded");

        await expect
          .poll(async () => {
            const windows = await restoredWindow.evaluate(() =>
              window.pier.listWindows()
            );
            return {
              focusedRecordId: windows.find((win) => win.focused)?.recordId,
              total: windows.length,
            };
          })
          .toEqual({ focusedRecordId: secondRecordId, total: 2 });

        for (let attempt = 0; attempt < 5; attempt += 1) {
          const windows = await restoredWindow.evaluate(() =>
            window.pier.listWindows()
          );
          expect(windows.find((win) => win.focused)?.recordId).toBe(
            secondRecordId
          );
          await restoredWindow.waitForTimeout(200);
        }
      } finally {
        await restoredApp.close();
      }
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
