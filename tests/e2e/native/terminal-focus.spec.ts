import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { openWelcomeTab } from "../support/app-harness.ts";

const OUT_MAIN = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "out",
  "main",
  "index.js"
);
const PROJECT_ROOT = join(import.meta.dirname, "..", "..", "..");
const PIER_CLI = join(PROJECT_ROOT, "bin", "pier.mjs");

test.skip(process.platform !== "darwin", "native terminal is macOS-only");

const execFileAsync = promisify(execFile);

interface CliResult<T> {
  data?: T;
  error?: {
    message?: string;
  };
  ok: boolean;
}

interface CliPanelList {
  errors: unknown[];
  panels: CliPanelSession[];
}

interface CliPanelSession {
  active?: boolean;
  id: string;
  windowFocused?: boolean;
  windowId: string;
}

interface TabVisibility {
  containerLeft: number;
  containerRight: number;
  panelId: string;
  scrollLeft: number;
  tabLeft: number;
  tabRight: number;
  visible: boolean;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function appleScriptString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

async function focusElectronApp(app: ElectronApplication, win: Page) {
  const windowId = await win.evaluate(async () => {
    const snapshot = await window.pier.terminal.debugSnapshot();
    return (
      snapshot.native.surfaces[0]?.browserWindowId ??
      snapshot.events.at(-1)?.browserWindowId
    );
  });
  await app.evaluate(({ app: electronApp, BaseWindow }, id) => {
    const host = BaseWindow.getAllWindows().find(
      (candidate) => candidate.id === id
    );
    if (!host) throw new Error("terminal test window not found");
    electronApp.focus({ steal: true });
    host.focus();
  }, windowId);
}

async function pasteTextIntoFocusedApp(text: string) {
  await execFileAsync("osascript", [
    "-e",
    "set previousClipboard to missing value",
    "-e",
    "try",
    "-e",
    "set previousClipboard to the clipboard",
    "-e",
    "end try",
    "-e",
    "try",
    "-e",
    `set the clipboard to ${appleScriptString(text)}`,
    "-e",
    'tell application "System Events" to keystroke "u" using control down',
    "-e",
    "delay 0.05",
    "-e",
    'tell application "System Events" to keystroke "v" using command down',
    "-e",
    "delay 0.1",
    "-e",
    'tell application "System Events" to key code 36',
    "-e",
    "delay 0.1",
    "-e",
    "on error errorMessage number errorNumber",
    "-e",
    "if previousClipboard is not missing value then set the clipboard to previousClipboard",
    "-e",
    "error errorMessage number errorNumber",
    "-e",
    "end try",
    "-e",
    "if previousClipboard is not missing value then set the clipboard to previousClipboard",
  ]);
}

async function waitForTerminalCount(win: Page, count: number) {
  await expect(win.locator(".terminal-anchor")).toHaveCount(count, {
    timeout: 10_000,
  });
  await win.waitForTimeout(800);
}

async function runPierCliJson<T>(
  userDataDir: string,
  args: string[]
): Promise<T> {
  const { stdout } = await execFileAsync(
    "node",
    [PIER_CLI, ...args, "--json"],
    {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        PIER_USER_DATA_DIR: userDataDir,
      },
    }
  );
  const parsed = JSON.parse(stdout) as CliResult<T>;
  if (!parsed.ok) {
    throw new Error(parsed.error?.message ?? stdout);
  }
  if (parsed.data === undefined) {
    throw new Error(`pier CLI returned no data for ${args.join(" ")}`);
  }
  return parsed.data;
}

async function waitForPierCli(userDataDir: string) {
  await expect
    .poll(
      async () => {
        try {
          await runPierCliJson(userDataDir, ["status"]);
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 10_000 }
    )
    .toBe(true);
}

function terminalPanels(snapshot: CliPanelList): CliPanelSession[] {
  return snapshot.panels.filter((panel) => panel.id.startsWith("terminal-"));
}

function panelList(userDataDir: string): Promise<CliPanelList> {
  return runPierCliJson<CliPanelList>(userDataDir, ["panels", "list"]);
}

async function waitForTerminalPanelCount(
  userDataDir: string,
  count: number
): Promise<CliPanelList> {
  let snapshot: CliPanelList = {
    errors: [],
    panels: [],
  };
  await expect
    .poll(
      async () => {
        snapshot = await panelList(userDataDir);
        return terminalPanels(snapshot).length;
      },
      { timeout: 15_000 }
    )
    .toBe(count);
  return snapshot;
}

async function clickActiveTerminalSurfaceForAppChord(win: Page) {
  // 不要固定点 index=0：split 后会把焦点抢回左侧 group。
  // 优先点当前已存在的最后一个 terminal-anchor（通常是最近 active / 右侧）。
  const anchors = win.locator(".terminal-anchor");
  const count = await anchors.count();
  if (count <= 0) {
    return;
  }
  const box = await anchors.nth(count - 1).boundingBox();
  if (!box) {
    return;
  }
  await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await win.waitForTimeout(150);
}

async function createTerminalTabs(
  userDataDir: string,
  win: Page,
  count: number
): Promise<CliPanelList> {
  let snapshot = await panelList(userDataDir);
  await expect(win.locator('[data-panel-tab-id^="terminal-"]')).toHaveCount(
    terminalPanels(snapshot).length
  );
  for (
    let nextCount = terminalPanels(snapshot).length + 1;
    nextCount <= count;
    nextCount++
  ) {
    await clickActiveTerminalSurfaceForAppChord(win);
    await win.keyboard.press("Meta+KeyT");
    snapshot = await waitForTerminalPanelCount(userDataDir, nextCount);
    await expect(win.locator('[data-panel-tab-id^="terminal-"]')).toHaveCount(
      nextCount
    );
  }
  return snapshot;
}

/** 一直新建终端直到至少有一个 tab 在 strip 中不完全可见。 */
async function createTerminalTabsUntilOverflow(
  userDataDir: string,
  win: Page,
  options: { maxCount?: number } = {}
): Promise<{ hiddenPanelId: string; snapshot: CliPanelList }> {
  const maxCount = options.maxCount ?? 40;
  let snapshot = await panelList(userDataDir);
  await expect(win.locator('[data-panel-tab-id^="terminal-"]')).toHaveCount(
    Math.max(terminalPanels(snapshot).length, 1)
  );

  for (let guard = 0; guard < maxCount; guard += 1) {
    const tabs = await tabVisibilities(win);
    const hidden = tabs.find((tab) => !tab.visible);
    if (hidden) {
      return { hiddenPanelId: hidden.panelId, snapshot };
    }
    const nextCount = terminalPanels(snapshot).length + 1;
    await clickActiveTerminalSurfaceForAppChord(win);
    await win.keyboard.press("Meta+KeyT");
    snapshot = await waitForTerminalPanelCount(userDataDir, nextCount);
    await expect(win.locator('[data-panel-tab-id^="terminal-"]')).toHaveCount(
      nextCount
    );
  }

  throw new Error(
    `expected a hidden terminal tab after ${maxCount} creates, got ${JSON.stringify(await tabVisibilities(win))}`
  );
}

function tabVisibilities(win: Page): Promise<TabVisibility[]> {
  return win.evaluate(() => {
    const result: TabVisibility[] = [];
    for (const contentElement of document.querySelectorAll<HTMLElement>(
      "[data-panel-tab-id]"
    )) {
      const panelId = contentElement.dataset.panelTabId;
      const tabElement = contentElement.closest<HTMLElement>(".dv-tab");
      const tabsContainer =
        tabElement?.closest<HTMLElement>(".dv-tabs-container") ?? null;
      if (!(panelId && tabElement && tabsContainer)) {
        continue;
      }
      const tabRect = tabElement.getBoundingClientRect();
      const containerRect = tabsContainer.getBoundingClientRect();
      result.push({
        containerLeft: containerRect.left,
        containerRight: containerRect.right,
        panelId,
        scrollLeft: tabsContainer.scrollLeft,
        tabLeft: tabRect.left,
        tabRight: tabRect.right,
        visible:
          tabRect.left >= containerRect.left - 1 &&
          tabRect.right <= containerRect.right + 1,
      });
    }
    return result;
  });
}

async function tabVisibility(
  win: Page,
  panelId: string
): Promise<TabVisibility | null> {
  const tabs = await tabVisibilities(win);
  return tabs.find((tab) => tab.panelId === panelId) ?? null;
}

function setTabStripScrollLeftForPanel(
  win: Page,
  panelId: string,
  scrollLeft: number
): Promise<number> {
  return win.evaluate(
    ({ panelId: targetPanelId, scrollLeft: nextScrollLeft }) => {
      const contentElement = [
        ...document.querySelectorAll<HTMLElement>("[data-panel-tab-id]"),
      ].find((element) => element.dataset.panelTabId === targetPanelId);
      const tabsContainer =
        contentElement
          ?.closest<HTMLElement>(".dv-tab")
          ?.closest<HTMLElement>(".dv-tabs-container") ?? null;
      if (!tabsContainer) {
        throw new Error(`tab strip not found for ${targetPanelId}`);
      }
      tabsContainer.scrollLeft = nextScrollLeft;
      return tabsContainer.scrollLeft;
    },
    { panelId, scrollLeft }
  );
}

async function clickTerminalByHorizontalOrder(
  win: Page,
  order: "left" | "right",
  options: { button?: "left" | "middle" | "right"; waitAfterMs?: number } = {}
) {
  const anchors = await win
    .locator(".terminal-anchor")
    .evaluateAll((elements) =>
      elements
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            height: rect.height,
            width: rect.width,
            x: rect.x,
            y: rect.y,
          };
        })
        .filter((anchor) => anchor.width > 100 && anchor.height > 100)
        .sort((a, b) => a.x - b.x || a.y - b.y)
    );
  const target = order === "left" ? anchors[0] : anchors.at(-1);
  if (!target) {
    throw new Error(`terminal anchor not found: ${order}`);
  }
  await win.mouse.click(
    target.x + target.width / 2,
    target.y + target.height / 2,
    { button: options.button ?? "left" }
  );
  const waitAfterMs = options.waitAfterMs ?? 300;
  if (waitAfterMs > 0) {
    await win.waitForTimeout(waitAfterMs);
  }
}

async function readNativeKeyboardOwnedByTerminal(win: Page): Promise<boolean> {
  return win.evaluate(async () => {
    const pierValue = Reflect.get(window, "pier");
    if (!pierValue || typeof pierValue !== "object") {
      return false;
    }
    const terminal = Reflect.get(pierValue, "terminal");
    if (!terminal || typeof terminal !== "object") {
      return false;
    }
    const debugSnapshot = Reflect.get(terminal, "debugSnapshot");
    if (typeof debugSnapshot !== "function") {
      return false;
    }
    const snap = await debugSnapshot.call(terminal);
    if (!snap || typeof snap !== "object") {
      return false;
    }

    let kind: string | null = null;
    const coordinator = Reflect.get(snap, "coordinator");
    if (coordinator && typeof coordinator === "object") {
      const effective = Reflect.get(coordinator, "effective");
      if (effective && typeof effective === "object") {
        const keyboardTarget = Reflect.get(effective, "keyboardTarget");
        if (keyboardTarget && typeof keyboardTarget === "object") {
          const value = Reflect.get(keyboardTarget, "kind");
          if (typeof value === "string") {
            kind = value;
          }
        }
      }
    }
    if (kind === null) {
      const native = Reflect.get(snap, "native");
      if (native && typeof native === "object") {
        const winState = Reflect.get(native, "window");
        if (winState && typeof winState === "object") {
          const keyboardTarget = Reflect.get(winState, "keyboardFocusTarget");
          if (keyboardTarget && typeof keyboardTarget === "object") {
            const value = Reflect.get(keyboardTarget, "kind");
            if (typeof value === "string") {
              kind = value;
            }
          }
        }
      }
    }

    let first = false;
    let hostKb = false;
    const native = Reflect.get(snap, "native");
    if (native && typeof native === "object") {
      const surfaces = Reflect.get(native, "surfaces");
      if (Array.isArray(surfaces)) {
        // 可能同时存在多个 surface；键盘目标不一定是 [0]
        for (const surface of surfaces) {
          if (!surface || typeof surface !== "object") {
            continue;
          }
          if (
            Reflect.get(surface, "isFirstResponder") === true &&
            Reflect.get(surface, "hostKeyboardActive") === true
          ) {
            first = true;
            hostKb = true;
            break;
          }
        }
      }
    }

    return kind === "terminal" && first && hostKb;
  });
}

async function selectTerminalSurface(win: Page, index: number) {
  const anchor = win.locator(".terminal-anchor").nth(index);
  await expect(anchor).toBeAttached({ timeout: 10_000 });
  const box = await anchor.boundingBox();
  if (!box) {
    throw new Error(`terminal anchor ${index} has no bounding box`);
  }
  await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await win.waitForTimeout(300);
}

/**
 * 恢复 OS 键入所需的 native first-responder。
 * 不要在 Meta+T/W 等 app 快捷键前调用：Playwright 合成快捷键在
 * keyboardTarget=terminal 时进不了 app chord。
 */
async function ensureNativeKeyboardOwnership(win: Page, index = 0) {
  const activeTab = win
    .locator(".dv-tab.dv-active-tab, .dv-tab[aria-selected='true']")
    .first();
  if ((await activeTab.count()) > 0) {
    await activeTab.click({ force: true });
  } else {
    const tab = win.locator(".dv-default-tab, .dv-tab").nth(index);
    if ((await tab.count()) > 0) {
      await tab.click({ force: true });
    }
  }
  await expect
    .poll(() => readNativeKeyboardOwnedByTerminal(win), { timeout: 10_000 })
    .toBe(true);
  await win.waitForTimeout(200);
}

async function focusTerminalAt(win: Page, index: number) {
  await selectTerminalSurface(win, index);
}

async function writeMarkerFromTerminal(
  app: ElectronApplication,
  win: Page,
  filePath: string,
  marker: string,
  options: {
    focusDelayMs?: number;
    /** 跳过 active-tab 抢权：用于刚点过的目标 terminal 表面，避免多 group 误粘到左侧 */
    skipOwnershipEnsure?: boolean;
    tabIndex?: number;
    timeoutMs?: number;
  } = {}
) {
  const command = `printf ${shellQuote(marker)} > ${shellQuote(filePath)}`;
  await focusElectronApp(app, win);
  if (!options.skipOwnershipEnsure) {
    await ensureNativeKeyboardOwnership(win, options.tabIndex ?? 0);
  }
  const focusDelayMs = options.focusDelayMs ?? 300;
  if (focusDelayMs > 0) {
    await win.waitForTimeout(focusDelayMs);
  }
  await pasteTextIntoFocusedApp(command);
  await expect
    .poll(() => (existsSync(filePath) ? readFileSync(filePath, "utf8") : ""), {
      timeout: options.timeoutMs ?? 10_000,
    })
    .toBe(marker);
}

const KEYSTROKE_SKIP_REASON =
  "System Events keystrokes undeliverable (unattended session or missing Accessibility permission)";

let keystrokesDeliverable: boolean | undefined;

async function ensureKeystrokesDeliverable(
  app: ElectronApplication,
  win: Page,
  markerDir: string
): Promise<void> {
  if (keystrokesDeliverable === false) {
    if (process.env.CI) {
      throw new Error(KEYSTROKE_SKIP_REASON);
    }
    test.skip(true, KEYSTROKE_SKIP_REASON);
  }
  if (keystrokesDeliverable === true) {
    return;
  }
  try {
    await writeMarkerFromTerminal(
      app,
      win,
      join(markerDir, "probe.txt"),
      "probe-ok",
      { timeoutMs: 6000 }
    );
    keystrokesDeliverable = true;
  } catch {
    keystrokesDeliverable = false;
    if (process.env.CI) {
      throw new Error(KEYSTROKE_SKIP_REASON);
    }
    test.skip(true, KEYSTROKE_SKIP_REASON);
  }
}

async function buildFourTerminalGrid(win: Page) {
  await waitForTerminalCount(win, 1);
  await focusTerminalAt(win, 0);
  await win.keyboard.press("Meta+KeyD");
  await waitForTerminalCount(win, 2);

  await win.keyboard.press("Control+Shift+ArrowLeft");
  await win.waitForTimeout(300);
  await win.keyboard.press("Meta+Shift+KeyD");
  await waitForTerminalCount(win, 3);

  await win.keyboard.press("Control+Shift+ArrowRight");
  await win.waitForTimeout(300);
  await win.keyboard.press("Meta+Shift+KeyD");
  await waitForTerminalCount(win, 4);
}

async function dragTopLeftTabIntoBottomLeftRightSplit(win: Page) {
  const tabs = await win.locator(".dv-tab").evaluateAll((elements) =>
    elements
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        return {
          height: rect.height,
          index,
          text: element.textContent ?? "",
          width: rect.width,
          x: rect.x,
          y: rect.y,
        };
      })
      .filter((tab) => tab.width > 0 && tab.height > 0)
      .sort((a, b) => a.y - b.y || a.x - b.x)
  );
  const anchors = await win
    .locator(".terminal-anchor")
    .evaluateAll((elements) =>
      elements
        .map((element, index) => {
          const rect = element.getBoundingClientRect();
          return {
            height: rect.height,
            index,
            width: rect.width,
            x: rect.x,
            y: rect.y,
          };
        })
        .sort((a, b) => a.y - b.y || a.x - b.x)
    );

  if (tabs.length < 4 || anchors.length < 4) {
    throw new Error(
      `expected four terminal tabs and anchors, got ${tabs.length} tabs and ${anchors.length} anchors`
    );
  }

  const source = tabs[0];
  const bottomLeft = anchors[2];
  if (!(source && bottomLeft)) {
    throw new Error(
      "failed to locate source tab or bottom-left terminal anchor"
    );
  }
  await win.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2
  );
  await win.mouse.down();
  await win.mouse.move(
    bottomLeft.x + bottomLeft.width * 0.75,
    bottomLeft.y + bottomLeft.height * 0.5,
    { steps: 24 }
  );
  await win.waitForTimeout(300);
  await win.mouse.up();
  await win.waitForTimeout(1200);
}

test.describe("Native terminal focus e2e", () => {
  test.describe.configure({ timeout: 90_000 });
  test("initial terminal accepts shell input", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-terminal-e2e-"));
    const markerDir = mkdtempSync(join(tmpdir(), "pier-terminal-marker-"));
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await waitForTerminalCount(win, 1);
      await focusTerminalAt(win, 0);
      await ensureKeystrokesDeliverable(app, win, markerDir);

      await writeMarkerFromTerminal(
        app,
        win,
        join(markerDir, "initial.txt"),
        "initial-ok"
      );
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(markerDir, { recursive: true, force: true });
    }
  });

  test("selected terminal tab restores native input without a content click", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-terminal-e2e-"));
    const markerDir = mkdtempSync(join(tmpdir(), "pier-terminal-marker-"));
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await waitForTerminalCount(win, 1);
      await focusTerminalAt(win, 0);
      await ensureKeystrokesDeliverable(app, win, markerDir);

      await win.locator('[data-panel-tab-id^="terminal-"]').first().click();
      await writeMarkerFromTerminal(
        app,
        win,
        join(markerDir, "selected-tab.txt"),
        "selected-tab-ok"
      );
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(markerDir, { recursive: true, force: true });
    }
  });

  test("terminal accepts shell input after tab drag into split group", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-terminal-e2e-"));
    const markerDir = mkdtempSync(join(tmpdir(), "pier-terminal-marker-"));
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await app.evaluate(({ BaseWindow }) => {
        BaseWindow.getAllWindows()[0]?.setSize(1200, 820);
      });

      await waitForTerminalCount(win, 1);
      await focusTerminalAt(win, 0);
      await ensureKeystrokesDeliverable(app, win, markerDir);

      await buildFourTerminalGrid(win);
      await dragTopLeftTabIntoBottomLeftRightSplit(win);

      await writeMarkerFromTerminal(
        app,
        win,
        join(markerDir, "dragged.txt"),
        "dragged-ok"
      );
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(markerDir, { recursive: true, force: true });
    }
  });

  test("terminal accepts shell input after command palette overlay closes", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-terminal-e2e-"));
    const markerDir = mkdtempSync(join(tmpdir(), "pier-terminal-marker-"));
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await waitForTerminalCount(win, 1);
      await focusTerminalAt(win, 0);
      await ensureKeystrokesDeliverable(app, win, markerDir);

      await win.keyboard.press("Meta+Shift+KeyP");
      await expect(win.locator('[role="dialog"]')).toBeAttached({
        timeout: 5000,
      });
      await win.keyboard.press("Escape");
      await expect(win.locator('[role="dialog"]')).not.toBeAttached({
        timeout: 5000,
      });

      await writeMarkerFromTerminal(
        app,
        win,
        join(markerDir, "overlay.txt"),
        "overlay-ok"
      );
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(markerDir, { recursive: true, force: true });
    }
  });

  test("new terminal accepts shell input without a content click", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-terminal-e2e-"));
    const markerDir = mkdtempSync(join(tmpdir(), "pier-terminal-marker-"));
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await waitForTerminalCount(win, 1);
      await focusTerminalAt(win, 0);
      await ensureKeystrokesDeliverable(app, win, markerDir);
      // app 快捷键走 web chord：先点内容区，避免 native 吞键
      await selectTerminalSurface(win, 0);
      await win.keyboard.press("Meta+KeyT");
      // 仅 active terminal 有 native anchor；新建后用 tab 计数
      await expect(win.locator('[data-panel-tab-id^="terminal-"]')).toHaveCount(
        2,
        { timeout: 15_000 }
      );
      await writeMarkerFromTerminal(
        app,
        win,
        join(markerDir, "new-terminal.txt"),
        "new-terminal-ok"
      );
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(markerDir, { recursive: true, force: true });
    }
  });

  test("terminal successor accepts shell input after the active tab closes", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-terminal-e2e-"));
    const markerDir = mkdtempSync(join(tmpdir(), "pier-terminal-marker-"));
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await waitForTerminalCount(win, 1);
      await focusTerminalAt(win, 0);
      await ensureKeystrokesDeliverable(app, win, markerDir);

      await selectTerminalSurface(win, 0);
      await win.keyboard.press("Meta+KeyT");
      await expect(win.locator('[data-panel-tab-id^="terminal-"]')).toHaveCount(
        2,
        { timeout: 15_000 }
      );
      await selectTerminalSurface(win, 0);
      await win.keyboard.press("Meta+KeyW");
      await expect(win.locator('[data-panel-tab-id^="terminal-"]')).toHaveCount(
        1,
        { timeout: 15_000 }
      );
      await writeMarkerFromTerminal(
        app,
        win,
        join(markerDir, "terminal-successor.txt"),
        "terminal-successor-ok"
      );
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(markerDir, { recursive: true, force: true });
    }
  });

  test("Web successor receives shortcuts after the active terminal closes", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-terminal-e2e-"));
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await waitForTerminalCount(win, 1);
      await openWelcomeTab(win);

      const terminalTab = win
        .locator('[data-panel-tab-id^="terminal-"]')
        .first();
      await terminalTab.click();
      await expect
        .poll(
          async () => terminalPanels(await panelList(userDataDir))[0]?.active
        )
        .toBe(true);
      await win.keyboard.press("Meta+KeyW");
      await waitForTerminalPanelCount(userDataDir, 0);

      await win.keyboard.press("Meta+Shift+KeyP");
      await expect(win.locator("[cmdk-input]")).toBeVisible({ timeout: 5000 });
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test("restored active terminal accepts shell input without a content click", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-terminal-e2e-"));
    const markerDir = mkdtempSync(join(tmpdir(), "pier-terminal-marker-"));
    let app: ElectronApplication | null = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const initialWindow = await app.firstWindow();
      await initialWindow.waitForLoadState("domcontentloaded");
      await waitForTerminalCount(initialWindow, 1);
      await focusTerminalAt(initialWindow, 0);
      await ensureKeystrokesDeliverable(app, initialWindow, markerDir);
      await app.close();
      app = null;

      app = await electron.launch({
        args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
      });
      const restoredWindow = await app.firstWindow();
      await restoredWindow.waitForLoadState("domcontentloaded");
      await waitForTerminalCount(restoredWindow, 1);
      await writeMarkerFromTerminal(
        app,
        restoredWindow,
        join(markerDir, "restored-terminal.txt"),
        "restored-terminal-ok"
      );
    } finally {
      await app?.close();
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(markerDir, { recursive: true, force: true });
    }
  });

  test("CLI focus reveals a hidden terminal tab and restores native input", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-terminal-e2e-"));
    const markerDir = mkdtempSync(join(tmpdir(), "pier-terminal-marker-"));
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await app.evaluate(({ BaseWindow }) => {
        const hostWindow = BaseWindow.getAllWindows()[0];
        hostWindow?.unmaximize();
        hostWindow?.setMinimumSize(320, 320);
        hostWindow?.setSize(360, 400);
        hostWindow?.setContentSize(360, 360);
      });
      await win.waitForTimeout(500);
      await waitForPierCli(userDataDir);
      await waitForTerminalCount(win, 1);
      await focusTerminalAt(win, 0);
      await ensureKeystrokesDeliverable(app, win, markerDir);

      const { hiddenPanelId, snapshot } = await createTerminalTabsUntilOverflow(
        userDataDir,
        win
      );
      const targetSession = terminalPanels(snapshot).find(
        (session) => session.id === hiddenPanelId
      );
      if (!targetSession) {
        throw new Error(`terminal snapshot missing ${hiddenPanelId}`);
      }

      await runPierCliJson(userDataDir, [
        "panels",
        "focus",
        targetSession.id,
        "--window",
        targetSession.windowId,
      ]);

      await expect
        .poll(async () => (await tabVisibility(win, targetSession.id))?.visible)
        .toBe(true);
      await expect
        .poll(async () => {
          const focused = terminalPanels(await panelList(userDataDir)).find(
            (session) => session.id === targetSession.id
          );
          return focused?.active === true && focused.windowFocused === true;
        })
        .toBe(true);

      await writeMarkerFromTerminal(
        app,
        win,
        join(markerDir, "cli-focus.txt"),
        "cli-focus-ok"
      );
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(markerDir, { recursive: true, force: true });
    }
  });

  test("native terminal content focus does not reveal its hidden tab", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-terminal-e2e-"));
    const markerDir = mkdtempSync(join(tmpdir(), "pier-terminal-marker-"));
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await app.evaluate(({ BaseWindow }) => {
        BaseWindow.getAllWindows()[0]?.setSize(820, 520);
      });
      await waitForPierCli(userDataDir);
      await waitForTerminalPanelCount(userDataDir, 1);
      await focusTerminalAt(win, 0);
      await ensureKeystrokesDeliverable(app, win, markerDir);

      await selectTerminalSurface(win, 0);
      await win.keyboard.press("Meta+KeyD");
      await waitForTerminalPanelCount(userDataDir, 2);
      await clickTerminalByHorizontalOrder(win, "right");
      const snapshot = await createTerminalTabs(userDataDir, win, 10);
      const targetSession = terminalPanels(snapshot).find(
        (session) => session.active
      );
      if (!targetSession) {
        throw new Error("active terminal session not found");
      }

      await setTabStripScrollLeftForPanel(win, targetSession.id, 0);
      await expect
        .poll(async () => (await tabVisibility(win, targetSession.id))?.visible)
        .toBe(false);

      await clickTerminalByHorizontalOrder(win, "left");
      await expect
        .poll(async () => {
          const active = terminalPanels(await panelList(userDataDir)).find(
            (session) => session.active
          );
          return active?.id !== targetSession.id;
        })
        .toBe(true);

      const before = await tabVisibility(win, targetSession.id);
      await clickTerminalByHorizontalOrder(win, "right", { waitAfterMs: 0 });
      const after = await tabVisibility(win, targetSession.id);

      expect(before?.visible).toBe(false);
      expect(after?.scrollLeft).toBe(before?.scrollLeft);
      expect(after?.visible).toBe(false);
      await writeMarkerFromTerminal(
        app,
        win,
        join(markerDir, "native-no-reveal.txt"),
        "native-no-reveal-ok",
        { focusDelayMs: 0, skipOwnershipEnsure: true }
      );
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(markerDir, { recursive: true, force: true });
    }
  });

  test("auxiliary terminal content click restores native input without revealing its hidden tab", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-terminal-e2e-"));
    const markerDir = mkdtempSync(join(tmpdir(), "pier-terminal-marker-"));
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await app.evaluate(({ BaseWindow }) => {
        BaseWindow.getAllWindows()[0]?.setSize(820, 520);
      });
      await waitForPierCli(userDataDir);
      await waitForTerminalPanelCount(userDataDir, 1);
      await focusTerminalAt(win, 0);
      await ensureKeystrokesDeliverable(app, win, markerDir);

      await selectTerminalSurface(win, 0);
      await win.keyboard.press("Meta+KeyD");
      await waitForTerminalPanelCount(userDataDir, 2);
      await clickTerminalByHorizontalOrder(win, "right");
      const snapshot = await createTerminalTabs(userDataDir, win, 10);
      const targetSession = terminalPanels(snapshot).find(
        (session) => session.active
      );
      if (!targetSession) {
        throw new Error("active terminal session not found");
      }

      await setTabStripScrollLeftForPanel(win, targetSession.id, 0);
      await expect
        .poll(async () => (await tabVisibility(win, targetSession.id))?.visible)
        .toBe(false);

      await clickTerminalByHorizontalOrder(win, "left");
      await expect
        .poll(async () => {
          const active = terminalPanels(await panelList(userDataDir)).find(
            (session) => session.active
          );
          return active?.id !== targetSession.id;
        })
        .toBe(true);

      const before = await tabVisibility(win, targetSession.id);
      await clickTerminalByHorizontalOrder(win, "right", {
        button: "middle",
        waitAfterMs: 0,
      });
      const after = await tabVisibility(win, targetSession.id);

      expect(before?.visible).toBe(false);
      expect(after?.scrollLeft).toBe(before?.scrollLeft);
      expect(after?.visible).toBe(false);
      await writeMarkerFromTerminal(
        app,
        win,
        join(markerDir, "native-auxiliary-no-reveal.txt"),
        "native-auxiliary-no-reveal-ok",
        { focusDelayMs: 0, skipOwnershipEnsure: true }
      );
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(markerDir, { recursive: true, force: true });
    }
  });

  /**
   * Open terminals via CLI so these cases do not depend on System Events /
   * Accessibility (Meta+T / paste probe). Prefer UI maximize button over ⌘⇧M.
   */
  async function openTerminalViaCli(
    userDataDir: string,
    options: { split?: "right"; windowId?: string } = {}
  ): Promise<{ panelId: string; windowId: string }> {
    const args = ["terminal", "open"];
    if (options.split === "right") {
      args.push("--split", "right");
    }
    if (options.windowId) {
      args.push("--window", options.windowId);
    }
    const data = await runPierCliJson<{
      panelId?: string;
      panelIds?: string[];
      windowId?: string;
    }>(userDataDir, args);
    const panelId = data.panelId ?? data.panelIds?.[0];
    const windowId = data.windowId;
    if (!(panelId && windowId)) {
      throw new Error(`terminal open missing ids: ${JSON.stringify(data)}`);
    }
    return { panelId, windowId };
  }

  async function openTerminalTabsViaCli(
    userDataDir: string,
    windowId: string,
    totalCount: number
  ): Promise<CliPanelList> {
    let snapshot = await panelList(userDataDir);
    while (terminalPanels(snapshot).length < totalCount) {
      await openTerminalViaCli(userDataDir, { windowId });
      snapshot = await waitForTerminalPanelCount(
        userDataDir,
        terminalPanels(snapshot).length + 1
      );
    }
    return snapshot;
  }

  async function dockviewMaximized(win: Page): Promise<boolean> {
    return win.evaluate(() => {
      const host = document.querySelector("[data-dockview-maximized]");
      return host?.getAttribute("data-dockview-maximized") === "true";
    });
  }

  async function clickPanelMaximizeToggle(
    win: Page,
    order: "left" | "right",
    options: { expectMaximized?: boolean } = {}
  ) {
    const before = await dockviewMaximized(win);
    const buttons = win.getByRole("button", {
      name: /^(Maximize|Restore|最大化|还原)$/u,
    });
    const count = await buttons.count();
    if (count <= 0) {
      throw new Error("maximize/restore button not found");
    }
    // With 2 groups both may show Maximize; left is first in DOM reading order.
    const index = order === "left" ? 0 : Math.max(0, count - 1);
    await buttons.nth(index).click();
    const expectMaximized = options.expectMaximized ?? !before;
    await expect
      .poll(() => dockviewMaximized(win), { timeout: 10_000 })
      .toBe(expectMaximized);
  }

  /** Activate a group without changing its active panel (avoid hitting a tab). */
  async function clickGroupHeaderVoid(win: Page, order: "left" | "right") {
    const point = await win.evaluate((side) => {
      const groups = [
        ...document.querySelectorAll<HTMLElement>(".dv-groupview"),
      ]
        .map((group) => {
          const rect = group.getBoundingClientRect();
          return { group, x: rect.x };
        })
        .sort((a, b) => a.x - b.x);
      const target = side === "left" ? groups[0]?.group : groups.at(-1)?.group;
      if (!target) {
        throw new Error(`group not found: ${side}`);
      }
      const voidEl = target.querySelector<HTMLElement>(".dv-void-container");
      if (voidEl) {
        const rect = voidEl.getBoundingClientRect();
        if (rect.width > 4 && rect.height > 4) {
          return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
        }
      }
      const header = target.querySelector<HTMLElement>(
        ".dv-tabs-and-actions-container"
      );
      if (!header) {
        throw new Error("tab header missing");
      }
      const rect = header.getBoundingClientRect();
      // Just left of right-side header actions (maximize / overflow).
      return {
        x: Math.max(rect.left + 8, rect.right - 72),
        y: rect.top + rect.height / 2,
      };
    }, order);
    await win.mouse.click(point.x, point.y);
  }

  /**
   * G3 — tab strip scroll ownership gold standard.
   * Maximize another group must not reset this group's remembered scrollLeft.
   */
  test("maximize restore keeps the other group's tab strip scrollLeft", async () => {
    test.setTimeout(120_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-terminal-e2e-"));
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await app.evaluate(({ BaseWindow }) => {
        BaseWindow.getAllWindows()[0]?.setSize(820, 520);
      });
      await waitForPierCli(userDataDir);
      const initial = await waitForTerminalPanelCount(userDataDir, 1);
      const first = terminalPanels(initial)[0];
      if (!first) {
        throw new Error("initial terminal missing");
      }

      await openTerminalViaCli(userDataDir, {
        split: "right",
        windowId: first.windowId,
      });
      await waitForTerminalPanelCount(userDataDir, 2);

      // Focus right group then fill tabs via CLI (active-tab placement).
      await clickTerminalByHorizontalOrder(win, "right");
      const rightSeed = terminalPanels(await panelList(userDataDir)).find(
        (session) => session.active
      );
      if (!rightSeed) {
        throw new Error("right seed terminal not active");
      }
      await runPierCliJson(userDataDir, [
        "panels",
        "focus",
        rightSeed.id,
        "--window",
        rightSeed.windowId,
      ]);
      const snapshot = await openTerminalTabsViaCli(
        userDataDir,
        rightSeed.windowId,
        10
      );
      const rightActive = terminalPanels(snapshot).find(
        (session) => session.active
      );
      if (!rightActive) {
        throw new Error("right active terminal not found");
      }

      await setTabStripScrollLeftForPanel(win, rightActive.id, 0);
      await expect
        .poll(async () => (await tabVisibility(win, rightActive.id))?.visible)
        .toBe(false);

      const scrolled = await win.evaluate((panelId) => {
        const contentElement = [
          ...document.querySelectorAll<HTMLElement>("[data-panel-tab-id]"),
        ].find((element) => element.dataset.panelTabId === panelId);
        const tabsContainer =
          contentElement
            ?.closest<HTMLElement>(".dv-tab")
            ?.closest<HTMLElement>(".dv-tabs-container") ?? null;
        if (!tabsContainer) {
          throw new Error(`tab strip not found for ${panelId}`);
        }
        const max = Math.max(
          0,
          tabsContainer.scrollWidth - tabsContainer.clientWidth
        );
        const next = Math.max(80, Math.floor(max * 0.5));
        tabsContainer.scrollLeft = next;
        tabsContainer.dispatchEvent(new Event("scroll"));
        return tabsContainer.scrollLeft;
      }, rightActive.id);
      expect(scrolled).toBeGreaterThan(0);

      await clickTerminalByHorizontalOrder(win, "left");
      await clickPanelMaximizeToggle(win, "left", { expectMaximized: true });
      await clickPanelMaximizeToggle(win, "left", { expectMaximized: false });

      await expect
        .poll(
          async () => {
            const after = await tabVisibility(win, rightActive.id);
            return after?.scrollLeft ?? -1;
          },
          { timeout: 10_000 }
        )
        .toBe(scrolled);
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  /**
   * G4 — focusing another group (not terminal surface click) reveals that
   * group's active tab. Uses pier.panel.focusRight (Ctrl+Shift+ArrowRight),
   * which runs activateWorkspacePanel({ reveal: "always" }).
   */
  test("group focus navigation reveals the active tab", async () => {
    test.setTimeout(120_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-terminal-e2e-"));
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await app.evaluate(({ BaseWindow }) => {
        BaseWindow.getAllWindows()[0]?.setSize(820, 520);
      });
      await waitForPierCli(userDataDir);
      const initial = await waitForTerminalPanelCount(userDataDir, 1);
      const first = terminalPanels(initial)[0];
      if (!first) {
        throw new Error("initial terminal missing");
      }

      await openTerminalViaCli(userDataDir, {
        split: "right",
        windowId: first.windowId,
      });
      await waitForTerminalPanelCount(userDataDir, 2);
      await clickTerminalByHorizontalOrder(win, "right");
      const rightSeed = terminalPanels(await panelList(userDataDir)).find(
        (session) => session.active
      );
      if (!rightSeed) {
        throw new Error("right seed terminal not active");
      }
      await runPierCliJson(userDataDir, [
        "panels",
        "focus",
        rightSeed.id,
        "--window",
        rightSeed.windowId,
      ]);
      const snapshot = await openTerminalTabsViaCli(
        userDataDir,
        rightSeed.windowId,
        10
      );
      const rightActive = terminalPanels(snapshot).find(
        (session) => session.active
      );
      if (!rightActive) {
        throw new Error("right active terminal not found");
      }

      await setTabStripScrollLeftForPanel(win, rightActive.id, 0);
      await expect
        .poll(async () => (await tabVisibility(win, rightActive.id))?.visible)
        .toBe(false);

      // Leave right group; terminal surface path must not reveal.
      await clickTerminalByHorizontalOrder(win, "left");
      await expect
        .poll(async () => (await tabVisibility(win, rightActive.id))?.visible)
        .toBe(false);

      // Chord needs web routing: click left header void, then focus right group.
      await clickGroupHeaderVoid(win, "left");
      await win.keyboard.press("Control+Shift+ArrowRight");

      await expect
        .poll(async () => (await tabVisibility(win, rightActive.id))?.visible, {
          timeout: 10_000,
        })
        .toBe(true);
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
