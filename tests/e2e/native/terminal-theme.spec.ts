import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { closeApp, launchApp, selectTheme } from "../support/app-harness.ts";
import { execFileAsync, removeDirectory } from "../terminal/e2e-harness.ts";

interface ThemeProbe {
  background: string | null;
  foreground: string | null;
  reports: string[];
  scheme: string | null;
}

function readProbe(path: string): ThemeProbe | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ThemeProbe;
  } catch {
    return null;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function readMacDarkMode(): Promise<boolean> {
  const { stdout } = await execFileAsync(
    "osascript",
    [
      "-e",
      'tell application "System Events" to tell appearance preferences to get dark mode',
    ],
    { timeout: 10_000 }
  );
  const value = stdout.trim();
  expect(["true", "false"]).toContain(value);
  return value === "true";
}

async function setMacDarkMode(dark: boolean): Promise<void> {
  await execFileAsync(
    "osascript",
    [
      "-e",
      `tell application "System Events" to tell appearance preferences to set dark mode to ${dark}`,
    ],
    { timeout: 10_000 }
  );
}

test.skip(
  process.platform !== "darwin",
  "Ghostty terminal themes require macOS"
);

// This verifies the host protocol. A TUI must still refresh its own cached
// colors and repaint explicit RGB styles in response to these notifications.
for (const source of ["manual", "system"] as const) {
  test(`running terminals receive ${source} theme changes`, async () => {
    test.setTimeout(180_000);
    const originalDark = source === "system" && (await readMacDarkMode());
    const directory = mkdtempSync(join(tmpdir(), "pier-theme-probe-"));
    const probes: string[] = [];
    const context = await launchApp();
    let stderr = "";
    context.app.process().stderr?.on("data", (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-48_000);
    });
    try {
      await context.app.evaluate(({ app, BaseWindow }) => {
        const win = BaseWindow.getAllWindows()[0];
        win?.show();
        app.focus({ steal: true });
        win?.focus();
      });
      expect(
        await context.win.evaluate(() => window.pier.preferences.read())
      ).toMatchObject({ theme: "system", stylePresetId: "pierre" });
      if (source === "manual") {
        await selectTheme(context.win, { id: "light", label: /Light|浅色/u });
      }

      async function openProbe(index: number): Promise<void> {
        const output = join(directory, `${index}.json`);
        const command = join(directory, `${index}.sh`);
        const probe = join(import.meta.dirname, "terminal-theme-probe.mjs");
        writeFileSync(
          command,
          `#!/bin/sh\nexec ${[process.execPath, probe, output].map(shellQuote).join(" ")} 2>${shellQuote(`${output}.stderr`)}\n`
        );
        chmodSync(command, 0o755);
        const opened = await context.win.evaluate(
          (commandPath) =>
            window.pier.terminals.open({
              focus: false,
              launch: { command: commandPath },
              placement: "split-below",
            }),
          command
        );
        expect(opened.panelId).toBeTruthy();
        probes.push(output);
      }
      await openProbe(0);
      await openProbe(1);

      for (const [index, dark] of [
        originalDark,
        !originalDark,
        originalDark,
      ].entries()) {
        const mode = dark ? "dark" : "light";
        const expected = {
          background: dark ? "#0a0a0a" : "#ffffff",
          foreground: dark ? "#fafafa" : "#0a0a0a",
          scheme: mode,
        };
        const counts = probes.map(
          (output) => readProbe(output)?.reports.length ?? 0
        );
        if (index > 0) {
          if (source === "system") {
            // Change macOS itself; Pier's preference stays system throughout.
            await setMacDarkMode(dark);
          } else {
            await selectTheme(context.win, {
              id: mode,
              label: dark ? /Dark|深色/u : /Light|浅色/u,
            });
          }
        }
        // Observe the PTYs before querying Electron, so the test cannot wake
        // a stalled host event loop through CDP and hide a notification delay.
        for (const [probeIndex, output] of probes.entries()) {
          await expect
            .poll(() => readProbe(output), { timeout: 15_000 })
            .toMatchObject(expected);
          if (index > 0) {
            expect(readProbe(output)?.reports.length).toBeGreaterThan(
              counts[probeIndex] ?? 0
            );
          }
        }
        await expect
          .poll(() =>
            context.app.evaluate(({ nativeTheme }) => ({
              dark: nativeTheme.shouldUseDarkColors,
              source: nativeTheme.themeSource,
            }))
          )
          .toEqual({
            dark,
            source: source === "system" ? "system" : mode,
          });
        await expect(context.win.locator("html")).toHaveClass(
          dark ? /dark/ : /light/
        );
        if (index === 1) {
          // Terminals created after a switch must inherit the same appearance.
          await openProbe(2);
          await expect
            .poll(() => readProbe(probes[2] ?? ""), { timeout: 15_000 })
            .toMatchObject(expected);
        }
      }
      expect(
        await context.win.evaluate(() => window.pier.preferences.read())
      ).toMatchObject({ theme: source === "system" ? "system" : "light" });
    } finally {
      try {
        await test.info().attach("terminal-launch-stderr", {
          body: stderr,
          contentType: "text/plain",
        });
        await test.info().attach("terminal-theme-reports", {
          body: JSON.stringify(probes.map(readProbe), null, 2),
          contentType: "application/json",
        });
        await test.info().attach("terminal-host-state", {
          body: JSON.stringify(
            await context.win.evaluate(() =>
              window.pier.terminal.debugSnapshot({})
            ),
            null,
            2
          ),
          contentType: "application/json",
        });
        for (const [index, output] of probes.entries()) {
          if (!existsSync(`${output}.stderr`)) {
            continue;
          }
          await test.info().attach(`terminal-probe-${index}-stderr`, {
            path: `${output}.stderr`,
            contentType: "text/plain",
          });
        }
      } finally {
        try {
          if (source === "system") {
            await setMacDarkMode(originalDark);
          }
        } finally {
          await closeApp(context);
          removeDirectory(directory);
        }
      }
    }
  });
}
