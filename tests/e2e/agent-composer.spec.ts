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
  "out",
  "main",
  "index.js"
);

test.skip(process.platform !== "darwin", "native terminal is macOS-only");

/**
 * On-demand Rich Input e2e: agent activity alone never mounts; open via
 * `pier:terminal:open-composer`; Esc/send close; idle eligibility loss
 * unmounts. sendText IPC stays independent of UI mount.
 */

interface DebugCoordinator {
  desired?: {
    webRequestCount?: number;
  };
}

interface DebugSnapshot {
  coordinator?: DebugCoordinator;
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

/**
 * 真实 aggregator 在窗口存活期间会持续广播（shell/idle 检测等），
 * `broadcastSeq` 单调递增且从 1 起跳（main/services/foreground-activity/
 * aggregator.ts）。store 的 `ts` 单调守卫按「当前已应用的 ts」拒收，注入的
 * ts 必须严格大于当前真实值，否则会被静默吞掉。用 snapshot() 现读一次
 * 当前 ts 作为起点，而不是从 1 开始猜。
 */
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

/**
 * 模拟一次「点终端内容区」焦点意图 —— 补发 native 层会发的同一条 IPC。
 * 抄自 terminal-overlay-coexistence.spec.ts。
 */
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

/**
 * 补发 `pier://foreground-activity:changed` 广播，模拟 unified aggregator
 * 判定该面板进入 agent / idle 态。
 */
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
      : {
          kind: "idle" as const,
          ...baseActivity,
        };
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

/** Open on-demand Rich Input for a panel (mirrors action / shortcut). */
async function openComposer(win: Page, panelId: string): Promise<void> {
  await win.evaluate((id) => {
    window.dispatchEvent(
      new CustomEvent("pier:terminal:open-composer", {
        detail: { panelId: id },
      })
    );
  }, panelId);
}

test.describe("Agent composer e2e", () => {
  test("on-demand open mounts composer; agent alone does not", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-composer-e2e-"));
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

      // 1. Initial: no composer.
      await expect(composer).not.toBeAttached();

      // 2. Agent activity alone still does not mount (on-demand).
      let seq = (await currentForegroundActivityTs(win)) + 1;
      await broadcastActivity(app, { kind: "agent", panelId, seq: seq++ });
      await win.waitForTimeout(400);
      await expect(composer).not.toBeAttached();

      // 3. Dispatch open → mounts + keyboard ownership.
      await openComposer(win, panelId);
      await expect(composer).toBeAttached({ timeout: 5000 });
      await expect
        .poll(async () => webRequestCount(await readSnapshot(win)), {
          timeout: 8000,
        })
        .toBeGreaterThanOrEqual(1);

      // 4. Terminal click takeover refocuses the composer input (Rich Input
      //    stays open and keeps keyboard ownership). Only Esc / send close.
      await simulateTerminalFocusIntent(app, panelId);
      await expect(composer).toBeAttached({ timeout: 1000 });
      // Composer keeps keyboard ownership (webRequestCount stays >= 1).
      await expect
        .poll(async () => webRequestCount(await readSnapshot(win)), {
          timeout: 8000,
        })
        .toBeGreaterThanOrEqual(1);

      // 5. Esc closes (draft retained in memory; DOM unmounts).
      await input.focus();
      await input.press("Escape");
      await expect(composer).not.toBeAttached({ timeout: 5000 });
      await expect
        .poll(async () => webRequestCount(await readSnapshot(win)), {
          timeout: 8000,
        })
        .toBe(0);

      // 6. Reopen; send succeeds → closes.
      await openComposer(win, panelId);
      await expect(composer).toBeAttached({ timeout: 5000 });
      await input.fill("echo pier-agent-composer-e2e");
      await input.press("Enter");
      await expect(composer).not.toBeAttached({ timeout: 5000 });
      await expect
        .poll(async () => webRequestCount(await readSnapshot(win)), {
          timeout: 8000,
        })
        .toBe(0);

      // 7. Open again then idle broadcast → eligibility loss unmounts.
      await openComposer(win, panelId);
      await expect(composer).toBeAttached({ timeout: 5000 });
      await broadcastActivity(app, { kind: "idle", panelId, seq: seq++ });
      await expect(composer).not.toBeAttached({ timeout: 5000 });
      await expect
        .poll(async () => webRequestCount(await readSnapshot(win)), {
          timeout: 8000,
        })
        .toBe(0);
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test("sendText round-trips through main into the pty", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-composer-e2e-"));
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await waitForTerminalCount(win, 1);
      const panelId = await readTerminalPanelId(win);

      const okResult = await win.evaluate(
        (id) =>
          (
            window as unknown as {
              pier: {
                terminal: {
                  sendText: (args: {
                    panelId: string;
                    submit: boolean;
                    text: string;
                  }) => Promise<{ ok: boolean; error?: string }>;
                };
              };
            }
          ).pier.terminal.sendText({
            panelId: id,
            submit: true,
            text: "echo e2e-ok",
          }),
        panelId
      );
      expect(okResult).toEqual({ ok: true });

      const failResult = await win.evaluate(() =>
        (
          window as unknown as {
            pier: {
              terminal: {
                sendText: (args: {
                  panelId: string;
                  submit: boolean;
                  text: string;
                }) => Promise<{ ok: boolean; error?: string }>;
              };
            };
          }
        ).pier.terminal.sendText({
          panelId: "no-such-panel",
          submit: true,
          text: "echo e2e-fail",
        })
      );
      expect(failResult.ok).toBe(false);
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
