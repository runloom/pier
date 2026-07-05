import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { _electron as electron, expect, test } from "@playwright/test";

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

const execFileAsync = promisify(execFile);

test.skip(process.platform !== "darwin", "native terminal is macOS-only");

interface CliResult<T> {
  data?: T;
  error?: {
    message?: string;
  };
  ok: boolean;
}

interface RunSpawnData {
  runId: string;
}

interface RunStatusData {
  nodes: Record<
    string,
    {
      panelId?: string;
      status?: string;
      windowId?: string;
    }
  >;
  status: string;
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
      env: {
        ...process.env,
        PIER_USER_DATA_DIR: userDataDir,
      },
    }
  );
  return JSON.parse(stdout) as CliResult<T>;
}

function writeQuickTaskProject(projectRoot: string) {
  writeFileSync(
    join(projectRoot, "package.json"),
    JSON.stringify(
      {
        name: "pier-terminal-task-status-e2e",
        private: true,
        scripts: {
          quick: 'node -e "process.exit(0)"',
          // Long enough that reload / app-quit happens while the pty runs,
          // short enough that Test A can still await natural completion.
          slow: "sleep 8",
        },
      },
      null,
      2
    )
  );
}

const SLOW_TASK_ID = "package-script:slow";

/** Spawns the slow task and polls until it is running with a panel attached. */
async function spawnSlowTaskUntilRunning(
  userDataDir: string,
  projectRoot: string
): Promise<{ panelId: string; runId: string }> {
  const spawn = await runPierCliJson<RunSpawnData>(userDataDir, [
    "tasks",
    "run",
    SLOW_TASK_ID,
    "--path",
    projectRoot,
  ]);
  expect(spawn.ok).toBe(true);
  const runId = spawn.data?.runId ?? "";
  expect(runId).not.toBe("");

  let panelId = "";
  await expect
    .poll(
      async () => {
        const status = await runPierCliJson<RunStatusData>(userDataDir, [
          "tasks",
          "status",
          runId,
        ]);
        const node = status.data?.nodes[SLOW_TASK_ID];
        panelId = node?.panelId ?? panelId;
        return { hasPanelId: panelId !== "", nodeStatus: node?.status };
      },
      { intervals: [200, 200, 200, 200, 300], timeout: 15_000 }
    )
    .toEqual({ hasPanelId: true, nodeStatus: "running" });

  return { panelId, runId };
}

test.describe("Terminal task status e2e", () => {
  test("clears the running tab status after a quick task exits", async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-task-status-e2e-"));
    const projectRoot = mkdtempSync(join(tmpdir(), "pier-task-project-"));
    writeQuickTaskProject(projectRoot);

    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      const spawn = await runPierCliJson<RunSpawnData>(userDataDir, [
        "tasks",
        "run",
        "package-script:quick",
        "--path",
        projectRoot,
      ]);
      expect(spawn.ok).toBe(true);
      expect(spawn.data?.runId).toEqual(expect.any(String));

      let panelId = "";
      await expect
        .poll(
          async () => {
            const status = await runPierCliJson<RunStatusData>(userDataDir, [
              "tasks",
              "status",
              spawn.data?.runId ?? "",
            ]);
            const node = status.data?.nodes["package-script:quick"];
            panelId = node?.panelId ?? panelId;
            return {
              nodeStatus: node?.status,
              ok: status.ok,
              runStatus: status.data?.status,
            };
          },
          { timeout: 20_000 }
        )
        .toEqual({ ok: true, runStatus: "succeeded", nodeStatus: "succeeded" });

      expect(panelId).not.toBe("");
      const tab = win.locator(`[data-panel-tab-id="${panelId}"]`);
      await expect(tab).toHaveAttribute("data-tab-status", "succeeded");
      await expect(tab).toHaveAttribute("data-tab-state-label", "Succeeded");
      // 回归守卫：终态常驻。曾经 activity 在 5s linger / pty 退出后被清,
      // renderer 回退到 mount 时的陈旧 "Running" 基线（tab 永久谎报运行中）。
      await win.waitForTimeout(6000);
      await expect(tab).toHaveAttribute("data-tab-status", "succeeded");
      await expect(tab).toHaveAttribute("data-tab-state-label", "Succeeded");
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("reload reattaches the live terminal for a running task", async () => {
    test.setTimeout(120_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-task-reload-e2e-"));
    const projectRoot = mkdtempSync(join(tmpdir(), "pier-task-reload-proj-"));
    writeQuickTaskProject(projectRoot);

    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      const { panelId, runId } = await spawnSlowTaskUntilRunning(
        userDataDir,
        projectRoot
      );

      const tab = win.locator(`[data-panel-tab-id="${panelId}"]`);
      await expect(tab).toHaveAttribute("data-tab-status", "running");

      // Layout saves are debounced (SAVE_DEBOUNCE_MS = 500 in workspace-host);
      // reloading inside that window restores a stale layout without the task
      // panel. Wait past the debounce so the persisted layout includes it.
      await win.waitForTimeout(1000);

      // Renderer-only reload: main process (and the running pty) survive.
      await win.reload();
      await win.waitForLoadState("domcontentloaded");

      await expect(tab).toHaveAttribute("data-tab-status", "running");
      // Activate the task tab so its panel content is the visible one.
      await tab.click();

      // Reattach path renders the real terminal, never the static result card.
      const panelRoot = win.locator(
        '[data-testid="terminal-panel-root"]:visible'
      );
      await expect(panelRoot).toBeVisible();
      await expect(panelRoot.locator(".terminal-anchor")).toHaveCount(1);
      const resultCard = win.locator('[data-testid="terminal-task-result"]');
      await expect(resultCard).toHaveCount(0);

      // The surviving pty's exit still lands after the reload.
      await expect
        .poll(
          async () => {
            const status = await runPierCliJson<RunStatusData>(userDataDir, [
              "tasks",
              "status",
              runId,
            ]);
            return {
              nodeStatus: status.data?.nodes[SLOW_TASK_ID]?.status,
              runStatus: status.data?.status,
            };
          },
          { timeout: 30_000 }
        )
        .toEqual({ nodeStatus: "succeeded", runStatus: "succeeded" });

      await expect(tab).toHaveAttribute("data-tab-status", "succeeded");
      await expect(tab).toHaveAttribute("data-tab-state-label", "Succeeded");
      // Whole-run settle window elapsed: the card never appeared post-reload.
      await expect(resultCard).toHaveCount(0);
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("restart sweeps an orphaned running task to a cancelled card", async () => {
    test.setTimeout(120_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-task-restart-e2e-"));
    const projectRoot = mkdtempSync(join(tmpdir(), "pier-task-restart-proj-"));
    writeQuickTaskProject(projectRoot);

    let app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      const { panelId } = await spawnSlowTaskUntilRunning(
        userDataDir,
        projectRoot
      );

      // Quit while the pty still runs (quit kills it without an exit marker);
      // the boot sweep must flip the persisted running task to cancelled.
      await app.close();

      app = await electron.launch({
        args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
      });
      const restartedWin = await app.firstWindow();
      await restartedWin.waitForLoadState("domcontentloaded");

      // Layout restore keeps panel ids stable across restarts.
      const tab = restartedWin.locator(`[data-panel-tab-id="${panelId}"]`);
      await expect(tab).toBeVisible({ timeout: 15_000 });
      await expect(tab).toHaveAttribute("data-tab-status", "cancelled");
      await expect(tab).toHaveAttribute("data-tab-state-label", "Cancelled");

      // Activate the restored task tab: it must show the static result card
      // (not a live terminal) reporting the swept cancelled status.
      await tab.click();
      const resultCard = restartedWin.locator(
        '[data-testid="terminal-task-result"]'
      );
      await expect(resultCard).toBeVisible();
      await expect(resultCard).toContainText("cancelled");
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
