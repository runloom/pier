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
 * 这些用例验证「浮层几何注册 + 与终端键盘焦点共存」的端到端链路 —— 全程不依赖
 * 真实 OS 键盘焦点（CI/sandbox 无法把 Electron 窗口变成 key window）。手段：
 *  1. 通过 debugSnapshot 读可观测状态（IPC 往返，无需 OS 焦点）。
 *  2. 从 main 进程补发 `pier:terminal:focus-request` 模拟「点终端」意图。
 *  3. Cmd+F 走 DOM keybinding 打开搜索栏（窗口非 OS 焦点时键盘目标即 web）。
 */

interface DebugWebOverlayRect {
  frame: { height: number; width: number; x: number; y: number };
  id: string;
  radius?: number;
  shadows?: {
    blur: number;
    color?: { a: number; b: number; g: number; r: number };
    spread: number;
    x: number;
    y: number;
  }[];
}

interface DebugCoordinator {
  desired?: {
    webOverlayRects?: DebugWebOverlayRect[];
    webRequestCount?: number;
  };
  effective?: { windowFocused?: boolean };
}

interface DebugNativeWindow {
  keyboardFocusTarget?: { kind: string; panelId?: string };
}

interface DebugSnapshot {
  coordinator?: DebugCoordinator;
  native?: { window?: DebugNativeWindow };
  renderer?: {
    panels: {
      panelId: string;
      terminalLifecycle?: { nativeTerminalReady?: boolean };
    }[];
  };
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

function overlayRectIds(snapshot: DebugSnapshot): string[] {
  return (snapshot.coordinator?.desired?.webOverlayRects ?? []).map(
    (rect) => rect.id
  );
}

function hasOverlayIdContaining(
  snapshot: DebugSnapshot,
  needle: string
): boolean {
  return overlayRectIds(snapshot).some((id) => id.includes(needle));
}

function findOverlayRect(
  snapshot: DebugSnapshot,
  needle: string
): DebugWebOverlayRect | undefined {
  return (snapshot.coordinator?.desired?.webOverlayRects ?? []).find((rect) =>
    rect.id.includes(needle)
  );
}

/**
 * 外观采样的端到端断言：radius 已送到 native（洞按圆角切角）且有至少一层
 * 外扩阴影（native TerminalShadow 有据可画）。radius 必须落在 border box
 * 短边一半以内，和浏览器 used radius 一致。
 */
async function expectOverlayAppearance(
  win: Page,
  needle: string
): Promise<DebugWebOverlayRect> {
  await expect
    .poll(
      async () => {
        const rect = findOverlayRect(await readSnapshot(win), needle);
        return (rect?.radius ?? 0) > 0 && (rect?.shadows?.length ?? 0) > 0;
      },
      { timeout: 8000 }
    )
    .toBe(true);
  const rect = findOverlayRect(await readSnapshot(win), needle);
  if (!rect) {
    throw new Error(`overlay ${needle} missing from host snapshot`);
  }
  expect(rect.radius ?? 0).toBeGreaterThan(0);
  expect(rect.radius ?? 0).toBeLessThanOrEqual(
    Math.min(rect.frame.width, rect.frame.height) / 2 + 0.5
  );
  expect(rect.shadows ?? []).not.toHaveLength(0);
  return rect;
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

async function waitForTerminalReady(win: Page, panelId: string): Promise<void> {
  // The anchor and native view exist before Ghostty presents its first frame.
  await expect
    .poll(
      async () =>
        (await readSnapshot(win)).renderer?.panels.find(
          (panel) => panel.panelId === panelId
        )?.terminalLifecycle,
      { timeout: 15_000 }
    )
    .toMatchObject({ nativeTerminalReady: true });
}

/**
 * Composer 只在面板进入 agent 活动态（或已有草稿）时挂载；裸 shell 终端没有
 * 真实前台活动。与 agent-composer.spec.ts 同构：补发一条高于当前 ts 的
 * `pier://foreground-activity:changed`，让挂载判定拿到 kind: "agent"。
 */
async function broadcastAgentActivity(
  app: ElectronApplication,
  win: Page,
  panelId: string
): Promise<void> {
  const ts = await win.evaluate(() =>
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
      .then((snapshot) => snapshot.ts)
  );
  const seq = ts + 1;
  const activity = {
    agentId: "claude",
    kind: "agent",
    panelId,
    source: "launch",
    spawnedAt: seq,
    subagentCount: 0,
    updatedAt: seq,
    windowId: "e2e-fixed-window",
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
    { activity, ts: seq }
  );
}

/**
 * 模拟一次「点终端内容区」焦点意图 —— 补发 native 层会发的同一条 IPC，
 * 驱动 renderer 发布 terminal intent host snapshot。
 */
async function simulateTerminalFocusIntent(
  app: ElectronApplication,
  panelId: string
): Promise<void> {
  // Pier 用 BaseWindow + WebContentsView，BrowserWindow.getAllWindows() 为空，
  // 必须经 webContents.getAllWebContents() 投递到渲染端 webContents。
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
 * 打开搜索栏。主路径 Cmd+F（DOM keybinding）；若该环境下不可靠，回退到 main 端
 * 应用菜单的 search-open 广播。返回实际生效的方式以便记录。
 */
async function openSearchBar(
  app: ElectronApplication,
  win: Page
): Promise<"cmd+f" | "ipc"> {
  const searchBar = win.locator('[data-testid="terminal-search-bar"]');
  await win.keyboard.press("Meta+KeyF");
  try {
    await expect(searchBar).toBeAttached({ timeout: 2000 });
    return "cmd+f";
  } catch {
    await app.evaluate(({ webContents }) => {
      for (const contents of webContents.getAllWebContents()) {
        if (contents.getType() === "window" && !contents.isDestroyed()) {
          contents.send("pier://terminal:search-open-request");
        }
      }
    });
    await expect(searchBar).toBeAttached({ timeout: 5000 });
    return "ipc";
  }
}

/**
 * 可靠地 hover 终端标签触发 Radix tooltip。启动后第一次 hover 常被吞（没有
 * 从其它位置进入的 pointer 过渡，Radix 的 onPointerMove 不开栏），所以这里
 * 反复「移到中性位置 → 带步进移到标签中心」，每轮轮询 tooltip 是否出现。
 */
async function hoverTabUntilTooltip(win: Page): Promise<void> {
  const tab = win.locator('[data-panel-tab-id^="terminal-"]').first();
  const tooltip = win.locator('[data-slot="tooltip-content"]');
  const box = await tab.boundingBox();
  if (!box) {
    throw new Error("terminal tab has no bounding box");
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    await win.mouse.move(3, 3);
    await win.waitForTimeout(150);
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
      steps: 4,
    });
    for (let poll = 0; poll < 6; poll++) {
      if ((await tooltip.count()) > 0) {
        return;
      }
      await win.waitForTimeout(300);
    }
  }
  throw new Error("tab tooltip never opened after repeated hovers");
}

test.describe("Terminal overlay coexistence e2e", () => {
  test("search overlay registers geometry and coexists with terminal focus", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-overlay-e2e-"));
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await waitForTerminalCount(win, 1);
      const panelId = await readTerminalPanelId(win);

      // 2. 打开搜索栏
      const opener = await openSearchBar(app, win);
      const searchBar = win.locator('[data-testid="terminal-search-bar"]');
      await expect(searchBar).toBeVisible();

      // 3. 几何端到端注册：webRequestCount>=1 且 webOverlayRects 含 terminal-search
      await expect
        .poll(async () => webRequestCount(await readSnapshot(win)), {
          timeout: 8000,
        })
        .toBeGreaterThanOrEqual(1);
      await expect
        .poll(
          async () =>
            hasOverlayIdContaining(await readSnapshot(win), "terminal-search"),
          { timeout: 8000 }
        )
        .toBe(true);

      // 3b. 圆角与阴影真的送到了 native：
      //   静态工具槽外壳是透明直角盒，外观必须采自绘制子元素（搜索条）。
      //   radius 为 0 → 洞按直角回填，胶囊四角露不透明 backing；
      //   shadows 为空 → 终端洞把 CSS 阴影裁掉，只留一圈生硬边。
      await expectOverlayAppearance(win, "terminal-search");

      // 4. 模拟终端焦点意图（native 只有在窗口 key 时才把键盘交给终端；
      //    macOS 不保证新窗口自动获得焦点，显式激活并等 main 真的看到 focus）。
      await app.evaluate(({ app: electronApp }) => {
        electronApp.focus({ steal: true });
      });
      await expect
        .poll(
          async () =>
            (await readSnapshot(win)).coordinator?.effective?.windowFocused ??
            false,
          { timeout: 8000 }
        )
        .toBe(true);
      await simulateTerminalFocusIntent(app, panelId);

      // 5. 键盘交回终端：webRequestCount 归零 + native target=terminal，
      //    但搜索栏仍挂载（共存，不关闭）
      await expect
        .poll(async () => webRequestCount(await readSnapshot(win)), {
          timeout: 8000,
        })
        .toBe(0);
      await expect
        .poll(
          async () => {
            const target = (await readSnapshot(win)).native?.window
              ?.keyboardFocusTarget;
            return target?.kind === "terminal" && target.panelId === panelId;
          },
          { timeout: 8000 }
        )
        .toBe(true);
      await expect(searchBar).toBeAttached();

      // 6. 点回搜索输入框重新激活：webRequestCount 回到 1
      const searchInput = win.locator('[data-testid="terminal-search-input"]');
      await searchInput.focus();
      await expect
        .poll(async () => webRequestCount(await readSnapshot(win)), {
          timeout: 8000,
        })
        .toBe(1);

      // 7. Escape 关闭：搜索栏卸载，几何与键盘请求一并清除
      await searchInput.press("Escape");
      await expect(searchBar).not.toBeAttached({ timeout: 5000 });
      await expect
        .poll(async () => webRequestCount(await readSnapshot(win)), {
          timeout: 8000,
        })
        .toBe(0);
      await expect
        .poll(
          async () =>
            hasOverlayIdContaining(await readSnapshot(win), "terminal-search"),
          { timeout: 8000 }
        )
        .toBe(false);

      expect(["cmd+f", "ipc"]).toContain(opener);
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test("global dialog keeps Web ownership after terminal focus intent", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-overlay-e2e-"));
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await waitForTerminalCount(win, 1);
      const panelId = await readTerminalPanelId(win);

      await win.keyboard.press("Meta+Shift+KeyP");
      const dialog = win.locator('[role="dialog"]');
      await expect(dialog).toBeAttached({ timeout: 5000 });
      await expect
        .poll(async () => webRequestCount(await readSnapshot(win)), {
          timeout: 8000,
        })
        .toBeGreaterThanOrEqual(1);

      await simulateTerminalFocusIntent(app, panelId);

      await expect
        .poll(async () => webRequestCount(await readSnapshot(win)), {
          timeout: 8000,
        })
        .toBeGreaterThanOrEqual(1);
      await expect
        .poll(
          async () =>
            (await readSnapshot(win)).native?.window?.keyboardFocusTarget?.kind,
          { timeout: 8000 }
        )
        .toBe("web");
      await expect(dialog).toBeAttached();
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test("tab tooltip registers overlay geometry over the terminal", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-overlay-e2e-"));
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await waitForTerminalCount(win, 1);

      // 1. baseline 几何条目数
      const baselineCount = overlayRectIds(await readSnapshot(win)).length;

      // 2. hover 标签触发 tooltip（1s 延迟 + 首个 hover 易被吞，故用重试 helper）
      await hoverTabUntilTooltip(win);
      const tooltip = win.locator('[data-slot="tooltip-content"]');
      await expect(tooltip).toBeAttached({ timeout: 8000 });

      // 3. 浮层几何端到端注册：条目数增加且含 terminal-overlay
      await expect
        .poll(
          async () =>
            hasOverlayIdContaining(await readSnapshot(win), "terminal-overlay"),
          { timeout: 8000 }
        )
        .toBe(true);
      expect(overlayRectIds(await readSnapshot(win)).length).toBeGreaterThan(
        baselineCount
      );

      // 4. 移开鼠标关闭 tooltip：terminal-overlay 几何随卸载清除
      await win.mouse.move(5, 5);
      await expect(tooltip).not.toBeAttached({ timeout: 8000 });
      await expect
        .poll(
          async () =>
            hasOverlayIdContaining(await readSnapshot(win), "terminal-overlay"),
          { timeout: 8000 }
        )
        .toBe(false);
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test("add-panel popover keeps its shadow after the enter animation", async () => {
    // Radix 弹层用 tw-animate `enter` 淡入，挂载时 computed opacity 为 0。
    // 若只按 keyframe 名含 fade 来跟 opacity，阴影取样会停在 alpha 0，
    // 菜单压在终端上时就是直角 + 无影。动画结束后必须回到满强度。
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-overlay-e2e-"));
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await waitForTerminalCount(win, 1);

      await win.keyboard.press("Meta+KeyN");
      const popover = win.locator('[data-slot="popover-content"]');
      await expect(popover).toBeVisible({ timeout: 8000 });
      const box = await popover.boundingBox();
      if (!box) {
        throw new Error("add-panel popover has no bounding box");
      }

      const matchingRect = async (): Promise<
        DebugWebOverlayRect | undefined
      > => {
        const rects =
          (await readSnapshot(win)).coordinator?.desired?.webOverlayRects ?? [];
        return rects.find(
          (rect) =>
            rect.id.includes("terminal-overlay") &&
            Math.abs(rect.frame.width - box.width) < 2
        );
      };

      // computed shadow-lg 的颜色是黑色 10%；>0.08 只可能在动画接近终态
      // 时采到，能区分「满强度阴影」和「冻在淡入起点」。
      await expect
        .poll(
          async () =>
            Math.max(
              ...((await matchingRect())?.shadows ?? []).map(
                (shadow) => shadow.color?.a ?? 0
              )
            ),
          { timeout: 8000 }
        )
        .toBeGreaterThan(0.08);

      const rect = await matchingRect();
      expect(rect?.radius ?? 0).toBeGreaterThan(0);
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test("composer overlay samples appearance from the chrome card", async () => {
    // composer 注册的是 absolute 定位外壳，圆角 / 阴影画在内部 chrome 卡片上。
    // 同一个外观采样契约必须从这里读出 radius + shadows，否则 composer 压在
    // 终端上时同样是直角回填 + 无阴影。
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-overlay-e2e-"));
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await waitForTerminalCount(win, 1);
      const panelId = await readTerminalPanelId(win);
      await waitForTerminalReady(win, panelId);
      await broadcastAgentActivity(app, win, panelId);

      await win.evaluate((id) => {
        window.dispatchEvent(
          new CustomEvent("pier:terminal:open-composer", {
            detail: { panelId: id },
          })
        );
      }, panelId);

      const composer = win.locator('[data-testid="terminal-composer"]');
      await expect(composer).toBeAttached({ timeout: 8000 });
      await expectOverlayAppearance(win, "terminal-composer-hit");
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
