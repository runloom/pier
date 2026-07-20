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
 * 验证 agent 态 Composer 的端到端挂载 / 键盘接管 / 发送闭环 —— CI 无真实
 * agent 可跑，手段是从 main 进程补发 `pier://foreground-activity:changed`
 * 广播（与既有 terminal-overlay-coexistence spec 里补发 focus-request 的
 * 注入思路同款）模拟 aggregator 已判定该面板为 agent/idle 态。
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
 *
 * 实测确认的三点（前置阅读，见 task-m5-brief 步骤 1-4）：
 * - 通道名: `PIER_BROADCAST.FOREGROUND_ACTIVITY_CHANGED` =
 *   `"pier://foreground-activity:changed"`（src/shared/ipc-channels.ts）。
 * - 无 envelope 包装：preload `foregroundActivityApi.onChanged` 直接把
 *   `ipcRenderer.on` 的第二个参数原样转给回调（src/preload/foreground-activity-api.ts），
 *   payload 就是裸的 `ForegroundActivityBroadcast { activities, ts }`。
 * - windowId 不参与过滤：`useForegroundActivityStore.apply` 只按 `ts` 单调
 *   守卫拒收乱序广播，随后无差别把 `activities` 整体按 panelId 建索引
 *   （src/renderer/stores/foreground-activity.store.ts）；`TerminalPanel`
 *   也只用 `activities[panelId]`，不比对 windowId。因此这里的 windowId 用
 *   任意满足 schema（`min(1).max(32)`）的字符串即可，不必等于真实窗口 id。
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

test.describe("Agent composer e2e", () => {
  test("composer mounts on agent activity and takes keyboard ownership", async () => {
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

      // 1. 初始无 composer。
      await expect(composer).not.toBeAttached();

      // 2. 补发 agent 态广播 → composer 挂载。ts 起点取自真实当前值 + 1，
      //    避免被 store 的单调守卫拒收（见 currentForegroundActivityTs 注释）。
      let seq = (await currentForegroundActivityTs(win)) + 1;
      await broadcastActivity(app, { kind: "agent", panelId, seq: seq++ });
      await expect(composer).toBeAttached({ timeout: 5000 });

      // 3. 挂载即接管键盘：auto-focus 触发 activateOverlay，webRequestCount>=1。
      await expect
        .poll(async () => webRequestCount(await readSnapshot(win)), {
          timeout: 8000,
        })
        .toBeGreaterThanOrEqual(1);

      // 4. 模拟「点终端」焦点意图：composer 的 takeover 注册重定向回输入框，
      //    键盘不应回终端（webRequestCount 仍 >=1，composer 仍挂载）。
      await simulateTerminalFocusIntent(app, panelId);
      await win.waitForTimeout(500);
      await expect
        .poll(async () => webRequestCount(await readSnapshot(win)), {
          timeout: 8000,
        })
        .toBeGreaterThanOrEqual(1);
      await expect(composer).toBeAttached();

      // 5. 通过 composer 发送文本：成功后清空输入框。
      await input.fill("echo pier-agent-composer-e2e");
      await input.press("Enter");
      await expect.poll(() => input.inputValue()).toBe("");

      // 6. 补发 idle 态广播 → composer 卸载，键盘归还终端。
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
