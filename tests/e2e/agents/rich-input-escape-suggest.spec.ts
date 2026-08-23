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
 * Rich Input suggest-list Esc layering e2e:
 * `/` opens the command/skill suggest popup; Esc must dismiss ONLY the popup
 * and keep Rich Input mounted; a second Esc closes Rich Input.
 * Regression guard for the Lexical-native-Escape vs React-onKeyDown ordering
 * contract (skill/mention/attachment menuOpenRef must settle on commit).
 */

async function waitForTerminalCount(win: Page, count: number): Promise<void> {
  await expect(win.locator(".terminal-anchor")).toHaveCount(count, {
    timeout: 10_000,
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

async function currentForegroundActivityTs(win: Page): Promise<number> {
  return win.evaluate(() =>
    (
      window as unknown as {
        pier: {
          foregroundActivity: { snapshot: () => Promise<{ ts: number }> };
        };
      }
    ).pier.foregroundActivity
      .snapshot()
      .then((s) => s.ts)
  );
}

async function broadcastActivity(
  app: ElectronApplication,
  payload: { kind: "agent" | "idle"; panelId: string; seq: number }
): Promise<void> {
  const baseActivity = {
    panelId: payload.panelId,
    windowId: "e2e-fixed-window",
    spawnedAt: payload.seq,
    updatedAt: payload.seq,
  };
  const activity =
    payload.kind === "agent"
      ? {
          kind: "agent" as const,
          ...baseActivity,
          agentId: "claude" as const,
          source: "launch" as const,
          subagentCount: 0,
        }
      : { kind: "idle" as const, ...baseActivity };
  await app.evaluate(
    ({ webContents }, args: { activity: unknown; ts: number }) => {
      for (const contents of webContents.getAllWebContents()) {
        if (contents.getType() === "window" && !contents.isDestroyed()) {
          contents.send("pier://foreground-activity:changed", {
            activities: [args.activity],
            ts: args.ts,
          });
        }
      }
    },
    { activity, ts: payload.seq }
  );
}

async function openComposer(win: Page, panelId: string): Promise<void> {
  await win.evaluate((id) => {
    window.dispatchEvent(
      new CustomEvent("pier:terminal:open-composer", {
        detail: { panelId: id },
      })
    );
  }, panelId);
}

test.describe("Rich Input suggest Esc layering", () => {
  test("Esc dismisses the skill/command list before closing Rich Input", async () => {
    test.setTimeout(120_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-rich-input-esc-e2e-"));
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await waitForTerminalCount(win, 1);
      const panelId = await readTerminalPanelId(win);

      const composer = win.locator('[data-testid="terminal-composer"]');
      const input = win.locator('[data-testid="terminal-composer-input"]');
      const suggestList = win.locator("#terminal-composer-skill-listbox");

      // Agent eligibility + on-demand open.
      let seq = (await currentForegroundActivityTs(win)) + 1;
      await broadcastActivity(app, { kind: "agent", panelId, seq: seq++ });
      await openComposer(win, panelId);
      await expect(composer).toBeAttached({ timeout: 5000 });

      // Type "/" via real keystrokes → suggest popup mounts.
      await input.focus();
      await input.pressSequentially("/");
      await expect(suggestList).toBeAttached({ timeout: 5000 });

      // First Esc: dismiss ONLY the list; Rich Input stays mounted with draft.
      await input.press("Escape");
      await expect(suggestList).not.toBeAttached({ timeout: 5000 });
      await expect(composer).toBeAttached();

      // Second Esc (list gone) closes Rich Input itself.
      await input.press("Escape");
      await expect(composer).not.toBeAttached({ timeout: 5000 });
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
