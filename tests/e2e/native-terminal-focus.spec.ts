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
import { openWorkbench } from "./workbench-e2e-harness.ts";

const OUT_MAIN = join(
  import.meta.dirname,
  "..",
  "..",
  "out",
  "main",
  "index.js"
);
const PROJECT_ROOT = join(import.meta.dirname, "..", "..");
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

async function focusElectronApp(app: ElectronApplication) {
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    electronApp.focus({ steal: true });
    BrowserWindow.getAllWindows()[0]?.focus();
  });
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
    await win.keyboard.press("Meta+KeyT");
    snapshot = await waitForTerminalPanelCount(userDataDir, nextCount);
    await expect(win.locator('[data-panel-tab-id^="terminal-"]')).toHaveCount(
      nextCount
    );
  }
  return snapshot;
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

async function focusTerminalAt(win: Page, index: number) {
  const anchor = win.locator(".terminal-anchor").nth(index);
  await expect(anchor).toBeAttached({ timeout: 10_000 });
  const box = await anchor.boundingBox();
  if (!box) {
    throw new Error(`terminal anchor ${index} has no bounding box`);
  }
  await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await win.waitForTimeout(300);
}

async function writeMarkerFromTerminal(
  app: ElectronApplication,
  win: Page,
  filePath: string,
  marker: string,
  options: { focusDelayMs?: number; timeoutMs?: number } = {}
) {
  const command = `printf ${shellQuote(marker)} > ${shellQuote(filePath)}`;
  await focusElectronApp(app);
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
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setSize(1200, 820);
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

      await win.keyboard.press("Meta+KeyT");
      await waitForTerminalCount(win, 2);
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

      await win.keyboard.press("Meta+KeyT");
      await waitForTerminalCount(win, 2);
      await win.keyboard.press("Meta+KeyW");
      await waitForTerminalCount(win, 1);
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
      await openWorkbench(win);

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
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setSize(640, 520);
      });
      await waitForPierCli(userDataDir);
      await waitForTerminalCount(win, 1);
      await focusTerminalAt(win, 0);
      await ensureKeystrokesDeliverable(app, win, markerDir);

      const snapshot = await createTerminalTabs(userDataDir, win, 12);
      const visibleTabs = await tabVisibilities(win);
      const hiddenTarget = visibleTabs.find((tab) => !tab.visible);
      if (!hiddenTarget) {
        throw new Error(
          `expected a hidden terminal tab, got ${JSON.stringify(visibleTabs)}`
        );
      }
      const targetSession = terminalPanels(snapshot).find(
        (session) => session.id === hiddenTarget.panelId
      );
      if (!targetSession) {
        throw new Error(`terminal snapshot missing ${hiddenTarget.panelId}`);
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
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setSize(820, 520);
      });
      await waitForPierCli(userDataDir);
      await waitForTerminalPanelCount(userDataDir, 1);
      await focusTerminalAt(win, 0);
      await ensureKeystrokesDeliverable(app, win, markerDir);

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
        { focusDelayMs: 0 }
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
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setSize(820, 520);
      });
      await waitForPierCli(userDataDir);
      await waitForTerminalPanelCount(userDataDir, 1);
      await focusTerminalAt(win, 0);
      await ensureKeystrokesDeliverable(app, win, markerDir);

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
        { focusDelayMs: 0 }
      );
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(markerDir, { recursive: true, force: true });
    }
  });
});
