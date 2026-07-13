import { type ChildProcess, execFile } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
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
const PROJECT_ROOT = join(import.meta.dirname, "..", "..");
const PIER_CLI = join(PROJECT_ROOT, "bin", "pier.mjs");
const SCREENSHOT_PATH = "/tmp/pier-native-terminal-render.png";
const execFileAsync = promisify(execFile);
const APP_CLOSE_TIMEOUT_MS = 5000;
const COMMAND_COMPLETION_TIMEOUT_MS = 30_000;
const DIRECTORY_REMOVE_RETRIES = 10;
const DIRECTORY_REMOVE_RETRY_DELAY_MS = 100;

interface CliResult<T> {
  data?: T;
  ok: boolean;
}

interface TerminalOpenData {
  panelId: string;
}

interface RenderSurfaceSnapshot {
  drawPending?: boolean;
  drawSequence?: number;
  ghosttyRenderReadySequence?: number;
  lastDrawnGhosttyRenderReadySequence?: number;
  panelId: string;
  refreshPending?: boolean;
  surfaceVisible?: boolean;
}

interface RenderDebugSnapshot {
  native: {
    surfaces: RenderSurfaceSnapshot[];
    window: {
      appTickCount?: number;
    };
  };
}

async function runPierCliJson<T>(
  userDataDir: string,
  args: string[]
): Promise<CliResult<T>> {
  const { stdout } = await execFileAsync(
    process.execPath,
    [PIER_CLI, ...args, "--json"],
    {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PIER_USER_DATA_DIR: userDataDir },
    }
  );
  return JSON.parse(stdout) as CliResult<T>;
}

async function renderSnapshot(win: Page): Promise<RenderDebugSnapshot> {
  return await win.evaluate(
    async () =>
      (await window.pier.terminal.debugSnapshot({})) as RenderDebugSnapshot
  );
}

async function killAndWait(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  child.kill("SIGKILL");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      exited,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, APP_CLOSE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function removeDirectory(path: string): void {
  rmSync(path, {
    force: true,
    maxRetries: DIRECTORY_REMOVE_RETRIES,
    recursive: true,
    retryDelay: DIRECTORY_REMOVE_RETRY_DELAY_MS,
  });
}

function surfaceByPanelId(
  snapshot: RenderDebugSnapshot,
  panelId: string
): RenderSurfaceSnapshot | undefined {
  return snapshot.native.surfaces.find(
    (surface) => surface.panelId === panelId
  );
}

test.skip(
  process.platform !== "darwin",
  "native terminal rendering is macOS-only"
);

test.describe("Native terminal target rendering", () => {
  test("real PTY output keeps drawing without focus, clicks, or keyboard input", async () => {
    test.setTimeout(120_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-render-e2e-"));
    const commandDir = mkdtempSync(join(tmpdir(), "pier-stream-"));
    const commandPath = join(commandDir, "stream.sh");
    const markerPath = join(commandDir, "complete");
    writeFileSync(
      commandPath,
      [
        "#!/bin/sh",
        "i=1",
        "while [ $i -le 40 ]; do",
        '  printf "\\033[2K\\rpier-stream-%02d" "$i"',
        "  sleep 0.05",
        '  printf "\\n"',
        "  i=$((i + 1))",
        "  sleep 0.15",
        "done",
        `: > '${markerPath}'`,
      ].join("\n")
    );
    chmodSync(commandPath, 0o755);

    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      const consoleIssues: string[] = [];
      win.on("console", (message) => {
        if (["error", "warning"].includes(message.type())) {
          consoleIssues.push(`${message.type()}: ${message.text()}`);
        }
      });
      await win.waitForLoadState("domcontentloaded");
      expect((await win.title()).length).toBeGreaterThan(0);
      await expect(win.locator("body")).toBeVisible();
      await expect(win.locator(".terminal-anchor")).toHaveCount(1, {
        timeout: 10_000,
      });
      await expect(win.locator("vite-error-overlay")).toHaveCount(0);
      await win.evaluate(async () => {
        await window.pier.terminal.setConfig({
          cursorBlink: false,
          cursorStyle: "block",
          pasteProtection: true,
          scrollbackLimitBytes: 64_000_000,
        });
      });

      let opened: CliResult<TerminalOpenData> | undefined;
      await expect
        .poll(
          async () => {
            opened = await runPierCliJson<TerminalOpenData>(userDataDir, [
              "terminal",
              "open",
              "--split",
              "below",
              "--no-focus",
              "--command",
              commandPath,
            ]).catch(() => undefined);
            return opened?.ok ?? false;
          },
          { timeout: 15_000 }
        )
        .toBe(true);
      const panelId = opened?.data?.panelId;
      expect(panelId).toEqual(expect.any(String));
      if (!panelId) {
        throw new Error("terminal.open did not return panelId");
      }

      await expect
        .poll(
          async () =>
            surfaceByPanelId(await renderSnapshot(win), panelId)?.surfaceVisible
        )
        .toBe(true);
      const initialSnapshot = await renderSnapshot(win);
      const initialSurface = surfaceByPanelId(initialSnapshot, panelId);
      const initialAppTick = initialSnapshot.native.window.appTickCount ?? 0;
      const observedDraws = new Set<number>();

      await expect
        .poll(
          async () => {
            const surface = surfaceByPanelId(
              await renderSnapshot(win),
              panelId
            );
            if (typeof surface?.drawSequence === "number") {
              observedDraws.add(surface.drawSequence);
            }
            return observedDraws.size;
          },
          { timeout: 15_000 }
        )
        .toBeGreaterThanOrEqual(3);
      await expect
        .poll(() => existsSync(markerPath), {
          timeout: COMMAND_COMPLETION_TIMEOUT_MS,
        })
        .toBe(true);

      await expect
        .poll(async () => {
          const surface = surfaceByPanelId(await renderSnapshot(win), panelId);
          return Boolean(
            surface &&
              surface.drawPending === false &&
              surface.refreshPending === false &&
              surface.lastDrawnGhosttyRenderReadySequence ===
                surface.ghosttyRenderReadySequence
          );
        })
        .toBe(true);

      const finalSnapshot = await renderSnapshot(win);
      const finalSurface = surfaceByPanelId(finalSnapshot, panelId);
      expect(finalSurface?.drawSequence).toBeGreaterThan(
        initialSurface?.drawSequence ?? 0
      );
      expect(finalSnapshot.native.window.appTickCount).toBeGreaterThan(
        initialAppTick
      );
      expect(finalSurface?.drawPending).toBe(false);
      expect(finalSurface?.refreshPending).toBe(false);
      expect(finalSurface?.lastDrawnGhosttyRenderReadySequence).toBe(
        finalSurface?.ghosttyRenderReadySequence
      );
      await win.screenshot({ path: SCREENSHOT_PATH });
      expect(existsSync(SCREENSHOT_PATH)).toBe(true);
      expect(consoleIssues).toEqual([]);
    } finally {
      await killAndWait(app.process());
      removeDirectory(userDataDir);
      removeDirectory(commandDir);
    }
  });
});
