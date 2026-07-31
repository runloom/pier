import type { ElectronApplication } from "@playwright/test";
import { expect, type Page, test } from "@playwright/test";
import {
  addWidget,
  closeApp,
  launchApp,
  openWorkbench,
} from "../workbench/e2e-harness.ts";

async function currentForegroundActivityTs(win: Page): Promise<number> {
  return win.evaluate(() =>
    (
      window as unknown as {
        pier: {
          foregroundActivity: {
            snapshot: () => Promise<{ ts: number }>;
          };
        };
      }
    ).pier.foregroundActivity
      .snapshot()
      .then((s) => s.ts)
  );
}

async function injectActivities(
  app: ElectronApplication,
  ts: number,
  activities: unknown[]
): Promise<void> {
  await app.evaluate(
    ({ webContents }, args: { activities: unknown[]; ts: number }) => {
      for (const contents of webContents.getAllWebContents()) {
        if (contents.getType() === "window" && !contents.isDestroyed()) {
          contents.send("pier://foreground-activity:changed", {
            activities: args.activities,
            ts: args.ts,
          });
        }
      }
    },
    { activities, ts }
  );
}

test.describe("Workbench activity overview", () => {
  test("lists injected activities with needs-you first and reveals on click", async () => {
    const context = await launchApp();
    try {
      await openWorkbench(context.win);
      const card = await addWidget(context.win, "core.activity-overview");
      await expect(
        card.locator('[data-testid="activity-stat-grid"]')
      ).toBeVisible();

      const seq = (await currentForegroundActivityTs(context.win)) + 1;
      await injectActivities(context.app, seq, [
        {
          agentId: "claude",
          kind: "agent",
          panelId: "terminal-1",
          source: "hook",
          spawnedAt: 1,
          status: "processing",
          subagentCount: 0,
          updatedAt: 200,
          windowId: "e2e",
        },
        {
          agentId: "codex",
          kind: "agent",
          panelId: "terminal-missing",
          sessionTitle: "Needs confirm",
          sessionTitleSource: "user",
          source: "hook",
          spawnedAt: 1,
          stateStartedAt: 50,
          status: "waiting",
          subagentCount: 0,
          updatedAt: 50,
          windowId: "e2e",
        },
      ]);

      await expect(
        card.locator('[data-testid="activity-row-terminal-missing"]')
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        card.locator('[data-testid="activity-row-terminal-1"]')
      ).toBeVisible();

      const waitBox = await card
        .locator('[data-testid="activity-row-terminal-missing"]')
        .boundingBox();
      const runBox = await card
        .locator('[data-testid="activity-row-terminal-1"]')
        .boundingBox();
      expect(waitBox && runBox).toBeTruthy();
      if (waitBox && runBox) {
        expect(waitBox.y).toBeLessThan(runBox.y);
      }

      await expect(card.getByText("Needs confirm")).toBeVisible();

      // 点击已不存在的面板：应有失败 toast，不崩溃
      await card
        .locator('[data-testid="activity-row-terminal-missing"]')
        .click();
      await expect(
        context.win.getByText(/面板已关闭|no longer open/i)
      ).toBeVisible({ timeout: 5000 });
    } finally {
      await closeApp(context);
    }
  });
});
