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

const OUT_MAIN = join(
  import.meta.dirname,
  "..",
  "..",
  "out",
  "main",
  "index.js"
);

test.skip(process.platform !== "darwin", "native terminal is macOS-only");

const execFileAsync = promisify(execFile);

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
  marker: string
) {
  const command = `printf ${shellQuote(marker)} > ${shellQuote(filePath)}`;
  await focusElectronApp(app);
  await win.waitForTimeout(300);
  await pasteTextIntoFocusedApp(command);
  await expect
    .poll(() => (existsSync(filePath) ? readFileSync(filePath, "utf8") : ""), {
      timeout: 10_000,
    })
    .toBe(marker);
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

      await win.keyboard.press("Meta+Shift+KeyP");
      await expect(win.locator('[role="dialog"]')).toBeAttached({
        timeout: 5000,
      });
      await win.keyboard.press("Escape");
      await expect(win.locator('[role="dialog"]')).not.toBeAttached({
        timeout: 5000,
      });
      await focusTerminalAt(win, 0);

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
});
