import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";
import {
  type CliResult,
  killAndWait,
  OUT_MAIN,
  removeDirectory,
  runPierCliJson,
} from "../terminal/e2e-harness.ts";

const SCREENSHOT_PATH = "/tmp/pier-native-terminal-render.png";
const COMMAND_COMPLETION_TIMEOUT_MS = 30_000;

interface TerminalOpenData {
  panelId: string;
}

interface RenderSurfaceSnapshot {
  drawPending?: boolean;
  drawSequence?: number;
  framePresentationRequestSequence?: number;
  ghosttyRenderReadySequence?: number;
  lastDrawnGhosttyRenderReadySequence?: number;
  panelId: string;
  presentationCovered?: boolean;
  refreshPending?: boolean;
  surfaceGeneration?: number;
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

async function renderSnapshot(win: Page): Promise<RenderDebugSnapshot> {
  return await win.evaluate(
    async () =>
      (await window.pier.terminal.debugSnapshot({})) as RenderDebugSnapshot
  );
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
          const text = message.text();
          // Preference mirrors from plugins routinely exceed the default 10 listeners.
          if (text.includes("MaxListenersExceededWarning")) {
            return;
          }
          consoleIssues.push(`${message.type()}: ${text}`);
        }
      });
      await win.waitForLoadState("domcontentloaded");
      expect((await win.title()).length).toBeGreaterThan(0);
      await expect(win.locator("body")).toBeVisible();
      await expect(win.locator(".terminal-anchor")).toHaveCount(1, {
        timeout: 10_000,
      });
      await expect(win.locator("vite-error-overlay")).toHaveCount(0);
      await expect
        .poll(async () => {
          const surfaces = (await renderSnapshot(win)).native.surfaces;
          return (
            surfaces.length === 1 &&
            surfaces.every((surface) => surface.presentationCovered === false)
          );
        })
        .toBe(true);
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
        .poll(async () => {
          const surface = surfaceByPanelId(await renderSnapshot(win), panelId);
          return (
            surface?.surfaceVisible === true &&
            surface.presentationCovered === false
          );
        })
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

  test("tab restoration commits a new presentation before reveal", async () => {
    test.setTimeout(120_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-tab-render-e2e-"));
    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await expect(win.locator(".terminal-anchor")).toHaveCount(1, {
        timeout: 10_000,
      });
      await expect
        .poll(async () => {
          const surfaces = (await renderSnapshot(win)).native.surfaces;
          return (
            surfaces.length === 1 &&
            surfaces[0]?.surfaceVisible === true &&
            surfaces[0]?.presentationCovered === false
          );
        })
        .toBe(true);

      const initialSnapshot = await renderSnapshot(win);
      const first = initialSnapshot.native.surfaces[0];
      expect(first).toBeDefined();
      if (!first) {
        throw new Error("initial terminal surface was not created");
      }

      let opened: CliResult<TerminalOpenData> | undefined;
      await expect
        .poll(
          async () => {
            opened = await runPierCliJson<TerminalOpenData>(userDataDir, [
              "terminal",
              "open",
            ]).catch(() => undefined);
            return opened?.ok ?? false;
          },
          { timeout: 15_000 }
        )
        .toBe(true);
      expect(opened?.data?.panelId).toEqual(expect.any(String));
      await expect(win.locator('[data-panel-tab-id^="terminal-"]')).toHaveCount(
        2,
        {
          timeout: 10_000,
        }
      );
      await expect
        .poll(async () => {
          const surfaces = (await renderSnapshot(win)).native.surfaces;
          return (
            surfaces.length === 2 &&
            surfaces.filter((surface) => surface.surfaceVisible).length === 1 &&
            surfaces.every(
              (surface) =>
                !surface.surfaceVisible || surface.presentationCovered === false
            )
          );
        })
        .toBe(true);

      const twoTabsSnapshot = await renderSnapshot(win);
      const second = twoTabsSnapshot.native.surfaces.find(
        (surface) => surface.panelId !== first.panelId
      );
      expect(second).toBeDefined();
      if (!second) {
        throw new Error("second terminal surface was not created");
      }
      expect(first.framePresentationRequestSequence).toEqual(
        expect.any(Number)
      );
      expect(second.framePresentationRequestSequence).toEqual(
        expect.any(Number)
      );

      const switchAndWaitForPresentation = async (
        target: RenderSurfaceSnapshot,
        other: RenderSurfaceSnapshot
      ) => {
        const before = surfaceByPanelId(
          await renderSnapshot(win),
          target.panelId
        );
        const beforeRequestSequence =
          before?.framePresentationRequestSequence ?? -1;
        const surfaceGeneration = before?.surfaceGeneration;
        await win.locator(`[data-panel-tab-id="${target.panelId}"]`).click();
        await expect
          .poll(async () => {
            const snapshot = await renderSnapshot(win);
            const restored = surfaceByPanelId(snapshot, target.panelId);
            const hidden = surfaceByPanelId(snapshot, other.panelId);
            return Boolean(
              restored?.surfaceVisible === true &&
                restored.presentationCovered === false &&
                restored.surfaceGeneration === surfaceGeneration &&
                (restored.framePresentationRequestSequence ?? -1) >
                  beforeRequestSequence &&
                hidden?.surfaceVisible === false
            );
          })
          .toBe(true);
      };

      await switchAndWaitForPresentation(first, second);
      await switchAndWaitForPresentation(second, first);
      await switchAndWaitForPresentation(first, second);
    } finally {
      await killAndWait(app.process());
      removeDirectory(userDataDir);
    }
  });
});
