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
          "background-output":
            "node -e \"console.log('pier background output'); setTimeout(() => console.error('pier background done'), 15000)\"",
          "background-success":
            'node -e "setTimeout(() => process.exit(0), 1000)"',
          "background-failure":
            "node -e \"console.error('pier expected failure'); process.exit(2)\"",
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
  test("keeps a failed background run visible until the user dismisses it", async () => {
    test.setTimeout(120_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-task-failure-e2e-"));
    const projectRoot = mkdtempSync(join(tmpdir(), "pier-task-failure-proj-"));
    writeQuickTaskProject(projectRoot);

    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      const started = await win.evaluate(
        async ({ path }) =>
          await window.pier.tasks.spawn({
            mode: "background",
            projectRootPath: path,
            taskId: "package-script:background-failure",
            terminalPanelId: "terminal-1",
          }),
        { path: projectRoot }
      );
      expect(started.status).toBe("started");

      await win.locator('[data-panel-tab-id="terminal-1"]').click();
      const control = win.getByTestId("terminal-runtime-control");
      await expect(control).toHaveAttribute("data-run-status", "failed");
      const floatingItem = win.locator(
        '[data-floating-item="runtime-controls"]'
      );
      await expect
        .poll(async () => (await floatingItem.boundingBox())?.width ?? 0)
        .toBeLessThanOrEqual(400);
      await win.waitForTimeout(3000);
      await expect(control).toHaveAttribute("data-run-status", "failed");

      await win.getByTestId("terminal-runtime-control-dismiss").click();
      await expect(control).toHaveCount(0);
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("keeps a successful background result while the runtime control is hovered", async () => {
    test.setTimeout(120_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-task-success-e2e-"));
    const projectRoot = mkdtempSync(join(tmpdir(), "pier-task-success-proj-"));
    writeQuickTaskProject(projectRoot);

    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      const started = await win.evaluate(
        async ({ path }) =>
          await window.pier.tasks.spawn({
            mode: "background",
            projectRootPath: path,
            taskId: "package-script:background-success",
            terminalPanelId: "terminal-1",
          }),
        { path: projectRoot }
      );
      expect(started.status).toBe("started");

      await win.locator('[data-panel-tab-id="terminal-1"]').click();
      const control = win.getByTestId("terminal-runtime-control");
      const floatingItem = win.locator(
        '[data-floating-item="runtime-controls"]'
      );
      await expect(control).toHaveAttribute("data-run-status", "running");
      await floatingItem.hover();
      await expect(control).toHaveAttribute("data-run-status", "succeeded");
      await expect(
        win.getByTestId("terminal-runtime-control-dismiss")
      ).toBeVisible();
      await floatingItem.hover();
      await win.waitForTimeout(5500);
      await expect(control).toBeVisible();

      await win
        .getByTestId("terminal-panel-root")
        .hover({ position: { x: 4, y: 200 } });
      await expect(control).toHaveCount(0, { timeout: 7000 });
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("opens one live output panel for a background run without rerunning it", async () => {
    test.setTimeout(120_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-task-output-e2e-"));
    const projectRoot = mkdtempSync(join(tmpdir(), "pier-task-output-proj-"));
    writeQuickTaskProject(projectRoot);

    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      const failedRun = await win.evaluate(
        async ({ path }) =>
          await window.pier.tasks.spawn({
            mode: "background",
            projectRootPath: path,
            taskId: "package-script:background-failure",
            terminalPanelId: "terminal-1",
          }),
        { path: projectRoot }
      );
      expect(failedRun.status).toBe("started");
      await expect
        .poll(async () => {
          const snapshot = await win.evaluate(async () =>
            window.pier.tasks.runsSnapshot()
          );
          return Object.values(snapshot.runs).some(
            (candidate) => candidate.status === "failed"
          );
        })
        .toBe(true);

      const started = await win.evaluate(
        async ({ path }) =>
          await window.pier.tasks.spawn({
            mode: "background",
            projectRootPath: path,
            taskId: "package-script:background-output",
            terminalPanelId: "terminal-1",
          }),
        { path: projectRoot }
      );
      expect(started.status).toBe("started");
      const runIdsBefore = await win.evaluate(async () =>
        Object.keys((await window.pier.tasks.runsSnapshot()).runs)
      );

      const terminalTab = win.locator('[data-panel-tab-id="terminal-1"]');
      await terminalTab.click();
      const openOutput = win.getByTestId(
        "terminal-runtime-control-open-output"
      );
      await expect(openOutput).toBeVisible();
      const runSelector = win.getByTestId(
        "terminal-runtime-control-run-selector"
      );
      await expect(runSelector).toBeVisible();
      const stopButton = win.getByTestId("terminal-runtime-control-stop");
      await expect(stopButton).toBeVisible();
      await expect(stopButton).toHaveAttribute("data-size", "icon-sm");
      await expect(stopButton).toHaveAttribute("data-tone", "default");
      await expect(stopButton).toHaveAttribute("data-variant", "ghost");
      const runningFloatingItem = win.locator(
        '[data-floating-item="runtime-controls"]'
      );
      await expect
        .poll(async () => (await runningFloatingItem.boundingBox())?.width ?? 0)
        .toBeLessThanOrEqual(400);
      const selectorBox = await runSelector.boundingBox();
      const actionSeparatorBox = await win
        .locator(
          '[data-testid="terminal-runtime-control"] [data-slot="separator"]'
        )
        .boundingBox();
      expect(selectorBox).not.toBeNull();
      expect(actionSeparatorBox).not.toBeNull();
      expect(selectorBox?.x ?? 0).toBeLessThan(actionSeparatorBox?.x ?? 0);
      const restartButton = win.getByTestId("terminal-runtime-control-restart");
      await expect(restartButton).toBeVisible();
      await expect(
        win.getByTestId("terminal-runtime-control-more")
      ).toHaveCount(0);
      await runSelector.click();
      const runOptions = win.locator('[data-slot="dropdown-menu-radio-item"]');
      await expect(runOptions).toHaveCount(2);
      await expect(
        win.locator(
          '[data-slot="dropdown-menu-radio-item"][data-state="checked"]'
        )
      ).toHaveCount(1);
      await win.keyboard.press("Escape");
      await openOutput.click();

      const outputTabs = win.locator('[data-panel-tab-id^="task-output-"]');
      await expect(outputTabs).toHaveCount(1);
      const outputPanelId = await outputTabs
        .first()
        .getAttribute("data-panel-tab-id");
      expect(outputPanelId).toEqual(expect.any(String));
      await expect(
        win.locator('[data-testid="terminal-runtime-control"]:visible')
      ).toHaveCount(0);
      await expect(win.getByTestId("task-output-log")).toHaveCount(0);
      await expect
        .poll(
          async () =>
            await win.evaluate(async (panelId) => {
              if (!panelId) {
                return "";
              }
              const selected = await window.pier.terminal.performOperation(
                panelId,
                "selectAll"
              );
              if (!selected.ok) {
                return "";
              }
              const result =
                await window.pier.terminal.readSelectionText(panelId);
              return result.kind === "ok" ? result.text : "";
            }, outputPanelId),
          { intervals: [200, 300, 500], timeout: 15_000 }
        )
        .toContain("pier background output");

      await terminalTab.click();
      await win.getByTestId("terminal-runtime-control-open-output").click();
      await expect(outputTabs).toHaveCount(1);
      const runIdsAfter = await win.evaluate(async () =>
        Object.keys((await window.pier.tasks.runsSnapshot()).runs)
      );
      expect(runIdsAfter).toEqual(runIdsBefore);
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("reruns a background task in the same logical output panel", async () => {
    test.setTimeout(120_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-output-rerun-e2e-"));
    const projectRoot = mkdtempSync(join(tmpdir(), "pier-output-rerun-proj-"));
    writeQuickTaskProject(projectRoot);

    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      const first = await win.evaluate(
        async ({ path }) =>
          await window.pier.tasks.spawn({
            mode: "background",
            projectRootPath: path,
            taskId: "package-script:background-output",
            terminalPanelId: "terminal-1",
          }),
        { path: projectRoot }
      );
      expect(first.status).toBe("started");
      const firstRunId = first.status === "started" ? (first.runId ?? "") : "";
      expect(firstRunId).not.toBe("");

      await win.locator('[data-panel-tab-id="terminal-1"]').click();
      await win.getByTestId("terminal-runtime-control-open-output").click();
      const outputTabs = win.locator('[data-panel-tab-id^="task-output-"]');
      await expect(outputTabs).toHaveCount(1);
      const outputPanelId =
        (await outputTabs.first().getAttribute("data-panel-tab-id")) ?? "";
      expect(outputPanelId).not.toBe("");

      // 从发起终端的 runtime-control 直接重新运行，而不是从输出 Panel
      // 调快捷键；已有输出 Panel 必须自动重绑到新 runId。
      await win.locator('[data-panel-tab-id="terminal-1"]').click();
      await win.getByTestId("terminal-runtime-control-restart").click();

      let rerunId = "";
      await expect
        .poll(
          async () => {
            const snapshot = await win.evaluate(async () =>
              window.pier.tasks.runsSnapshot()
            );
            const rerun = Object.values(snapshot.runs).find(
              (candidate) =>
                candidate.runId !== firstRunId &&
                candidate.rootTaskId === "package-script:background-output"
            );
            rerunId = rerun?.runId ?? rerunId;
            return { runId: rerunId, status: rerun?.status };
          },
          { intervals: [100, 200, 300], timeout: 15_000 }
        )
        .toEqual({ runId: expect.any(String), status: "running" });

      await expect(outputTabs).toHaveCount(1);
      await expect(outputTabs.first()).toHaveAttribute(
        "data-panel-tab-id",
        outputPanelId
      );
      await expect(outputTabs.first()).toHaveAttribute(
        "data-tab-status",
        "running"
      );
      await expect(win.getByTestId("terminal-runtime-control")).toHaveAttribute(
        "data-run-id",
        rerunId
      );
      await outputTabs.first().click();
      await expect(
        win.locator('[data-testid="terminal-runtime-control"]:visible')
      ).toHaveCount(0);
      await expect
        .poll(
          async () =>
            await win.evaluate(async (panelId) => {
              const selected = await window.pier.terminal.performOperation(
                panelId,
                "selectAll"
              );
              if (!selected.ok) {
                return "";
              }
              const result =
                await window.pier.terminal.readSelectionText(panelId);
              return result.kind === "ok" ? result.text : "";
            }, outputPanelId),
          { intervals: [200, 300, 500], timeout: 15_000 }
        )
        .toContain("pier background output");

      // selectedRunId 随 dockview params 持久化；renderer reload 后 main 中的
      // TaskRun 与 native output session 都应重新附着到同一个逻辑 Panel。
      await win.reload();
      await win.waitForLoadState("domcontentloaded");
      const restoredOutputTab = win.locator(
        `[data-panel-tab-id="${outputPanelId}"]`
      );
      await expect(restoredOutputTab).toHaveCount(1);
      await expect(restoredOutputTab).toHaveAttribute(
        "data-tab-status",
        "running"
      );
      await restoredOutputTab.click();
      await expect
        .poll(
          async () =>
            await win.evaluate(async (panelId) => {
              const selected = await window.pier.terminal.performOperation(
                panelId,
                "selectAll"
              );
              if (!selected.ok) {
                return "";
              }
              const result =
                await window.pier.terminal.readSelectionText(panelId);
              return result.kind === "ok" ? result.text : "";
            }, outputPanelId),
          { intervals: [200, 300, 500], timeout: 15_000 }
        )
        .toContain("pier background output");

      await win.evaluate(async (runId) => {
        await window.pier.tasks.stop({ force: true, runId });
      }, rerunId);
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

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

  test("rerun reuses the panel and lands the second exit status", async () => {
    test.setTimeout(120_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-task-rerun-e2e-"));
    const projectRoot = mkdtempSync(join(tmpdir(), "pier-task-rerun-proj-"));
    writeQuickTaskProject(projectRoot);

    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      const spawnArgs = [
        "tasks",
        "run",
        "package-script:quick",
        "--path",
        projectRoot,
      ];
      const first = await runPierCliJson<RunSpawnData>(userDataDir, spawnArgs);
      expect(first.ok).toBe(true);
      const firstRunId = first.data?.runId ?? "";
      expect(firstRunId).not.toBe("");

      let panelId = "";
      await expect
        .poll(
          async () => {
            const status = await runPierCliJson<RunStatusData>(userDataDir, [
              "tasks",
              "status",
              firstRunId,
            ]);
            const node = status.data?.nodes["package-script:quick"];
            panelId = node?.panelId ?? panelId;
            return node?.status;
          },
          { timeout: 20_000 }
        )
        .toBe("succeeded");
      expect(panelId).not.toBe("");

      const tab = win.locator(`[data-panel-tab-id="${panelId}"]`);
      await expect(tab).toHaveAttribute("data-tab-status", "succeeded");
      await tab.click();

      // 从成功态 task panel 触发与右键菜单相同的 renderer action。
      await win.keyboard.press("Meta+Alt+r");

      let secondRunId = "";
      let rerunPanelId = "";
      await expect
        .poll(
          async () => {
            const snapshot = await win.evaluate(async () =>
              window.pier.tasks.runsSnapshot()
            );
            const rerun = Object.values(snapshot.runs).find(
              (run) => run.runId !== firstRunId
            );
            secondRunId = rerun?.runId ?? secondRunId;
            const node = rerun?.nodes["package-script:quick"];
            rerunPanelId = node?.panelId ?? rerunPanelId;
            return { runId: secondRunId, status: node?.status };
          },
          { timeout: 20_000 }
        )
        .toEqual({ runId: expect.any(String), status: "succeeded" });
      expect(secondRunId).not.toBe(firstRunId);
      // panel 复用是本回归的前提——不复用则测试退化为两次独立 spawn。
      expect(rerunPanelId).toBe(panelId);

      // 回归守卫：relaunch close 曾清掉 rerun 已登记的 running task 层，
      // 第二次退出的 taskFinished 落空 → tab 永远停在 "Running" 基线。
      await expect(tab).toHaveAttribute("data-tab-status", "succeeded");
      await expect(tab).toHaveAttribute("data-tab-state-label", "Succeeded");
      // 终态常驻：冷却窗口(5s)过后不得被迟到清理翻回。
      await win.waitForTimeout(6000);
      await expect(tab).toHaveAttribute("data-tab-status", "succeeded");
      await expect(tab).toHaveAttribute("data-tab-state-label", "Succeeded");
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("renderer rerun and stop actions keep the task tab and runtime control on one run", async () => {
    test.setTimeout(120_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-task-actions-e2e-"));
    const projectRoot = mkdtempSync(join(tmpdir(), "pier-task-actions-proj-"));
    writeQuickTaskProject(projectRoot);

    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      const first = await spawnSlowTaskUntilRunning(userDataDir, projectRoot);
      const tab = win.locator(`[data-panel-tab-id="${first.panelId}"]`);
      await tab.click();

      const control = win.getByTestId("terminal-runtime-control");
      await expect(control).toHaveAttribute("data-run-id", first.runId);
      await win.keyboard.press("Meta+Alt+r");

      let secondRunId = "";
      await expect
        .poll(
          async () => {
            const snapshot = await win.evaluate(async () =>
              window.pier.tasks.runsSnapshot()
            );
            const next = Object.values(snapshot.runs).find(
              (run) =>
                run.runId !== first.runId &&
                Object.values(run.nodes).some(
                  (node) => node.panelId === first.panelId
                )
            );
            secondRunId = next?.runId ?? secondRunId;
            return { runId: secondRunId, status: next?.status };
          },
          { intervals: [200, 300, 500], timeout: 20_000 }
        )
        .toEqual({ runId: expect.any(String), status: "running" });
      expect(secondRunId).not.toBe(first.runId);
      await expect(control).toHaveAttribute("data-run-id", secondRunId);
      await expect(tab).toHaveAttribute("data-tab-status", "running");

      // 旧 PTY 的 SIGTERM / command-finished 可能在新运行绑定后才到达。
      // 跨过迟到窗口再次核对，Panel 与 runtime-control 必须仍指向同一新 run。
      await win.waitForTimeout(3000);
      await expect(control).toHaveAttribute("data-run-id", secondRunId);
      await expect(control).toHaveAttribute("data-run-status", "running");
      await expect(tab).toHaveAttribute("data-tab-status", "running");

      await win.getByTestId("terminal-runtime-control-stop").click();

      await expect
        .poll(
          async () => {
            const snapshot = await win.evaluate(async () =>
              window.pier.tasks.runsSnapshot()
            );
            return snapshot.runs[secondRunId]?.status;
          },
          { intervals: [200, 300, 500], timeout: 20_000 }
        )
        .toBe("cancelled");
      await expect(control).toHaveAttribute("data-run-status", "cancelled");
      await expect(tab).toHaveAttribute("data-tab-status", "cancelled");

      // 取消后的死终端仍必须能通过与右键菜单相同的 action 重新运行。
      // 先等浮层完成 linger 并卸载，证明 action 依赖共享选择而非组件局部 state。
      await expect(control).toHaveCount(0, { timeout: 6000 });
      await win.keyboard.press("Meta+Alt+r");
      let resumedRunId = "";
      await expect
        .poll(
          async () => {
            const snapshot = await win.evaluate(async () =>
              window.pier.tasks.runsSnapshot()
            );
            const resumed = Object.values(snapshot.runs).find(
              (run) =>
                run.runId !== first.runId &&
                run.runId !== secondRunId &&
                Object.values(run.nodes).some(
                  (node) => node.panelId === first.panelId
                )
            );
            resumedRunId = resumed?.runId ?? resumedRunId;
            return { runId: resumedRunId, status: resumed?.status };
          },
          { intervals: [200, 300, 500], timeout: 20_000 }
        )
        .toEqual({ runId: expect.any(String), status: "running" });
      await expect(control).toHaveAttribute("data-run-id", resumedRunId);
      await expect(tab).toHaveAttribute("data-tab-status", "running");
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
      await tab.click();

      // 运行控制只允许出现在 terminal panel 浮层中。这里使用 Chromium 的真实
      // 布局结果守住最小宽度，避免 absolute + auto width 再次塌成一条边框。
      const panelRootBeforeReload = win.locator(
        '[data-testid="terminal-panel-root"]:visible'
      );
      const runtimeControl = panelRootBeforeReload.locator(
        '[data-floating-item="runtime-controls"]'
      );
      await expect(runtimeControl).toBeVisible();
      const runtimeBox = await runtimeControl.boundingBox();
      const panelBox = await panelRootBeforeReload.boundingBox();
      expect(runtimeBox).not.toBeNull();
      expect(panelBox).not.toBeNull();
      expect(runtimeBox?.width).toBeGreaterThanOrEqual(256);
      expect(runtimeBox?.x).toBeGreaterThanOrEqual(panelBox?.x ?? 0);
      expect(
        (runtimeBox?.x ?? 0) + (runtimeBox?.width ?? 0)
      ).toBeLessThanOrEqual((panelBox?.x ?? 0) + (panelBox?.width ?? 0));
      await expect(win.locator('[data-testid="task-status-item"]')).toHaveCount(
        0
      );

      const dragHandle = runtimeControl.locator(
        '[data-testid="terminal-runtime-control-drag-handle"]'
      );
      const handleBox = await dragHandle.boundingBox();
      expect(handleBox).not.toBeNull();
      await win.mouse.move(
        (handleBox?.x ?? 0) + (handleBox?.width ?? 0) / 2,
        (handleBox?.y ?? 0) + (handleBox?.height ?? 0) / 2
      );
      await win.mouse.down();
      await win.mouse.move(
        (handleBox?.x ?? 0) + (handleBox?.width ?? 0) / 2 + 80,
        (handleBox?.y ?? 0) + (handleBox?.height ?? 0) / 2 + 64,
        { steps: 8 }
      );
      await win.mouse.up();
      const movedRuntimeBox = await runtimeControl.boundingBox();
      expect(movedRuntimeBox).not.toBeNull();
      expect(movedRuntimeBox?.x ?? 0).toBeGreaterThan(
        (runtimeBox?.x ?? 0) + 40
      );
      expect(movedRuntimeBox?.y ?? 0).toBeGreaterThan(
        (runtimeBox?.y ?? 0) + 32
      );

      // Layout saves are debounced (SAVE_DEBOUNCE_MS = 500 in workspace-host);
      // reloading inside that window restores a stale layout without the task
      // panel. Wait past the debounce so the persisted layout includes it.
      await win.waitForTimeout(1000);
      const persistedLayoutText = await win.evaluate(async () => {
        const context = await window.pier.window.getContext();
        const layout = await window.pier.workspace.loadLayout(context.recordId);
        return JSON.stringify(layout);
      });
      expect(persistedLayoutText).toContain('"floatingLayout"');
      expect(persistedLayoutText).toContain('"runtime-controls"');
      const persistedPosition = persistedLayoutText.match(
        /"runtime-controls":\{"x":([\d.]+),"y":([\d.]+)\}/
      );
      expect(persistedPosition).not.toBeNull();
      expect(Number(persistedPosition?.[1])).toBeGreaterThan(0.5);
      expect(Number(persistedPosition?.[2])).toBeGreaterThan(0);

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
      const restoredRuntimeControl = panelRoot.locator(
        '[data-floating-item="runtime-controls"]'
      );
      await expect(restoredRuntimeControl).toBeVisible();
      const restoredRuntimeBox = await restoredRuntimeControl.boundingBox();
      expect(restoredRuntimeBox).not.toBeNull();
      expect(
        Math.abs((restoredRuntimeBox?.x ?? 0) - (movedRuntimeBox?.x ?? 0))
      ).toBeLessThan(4);
      expect(
        Math.abs((restoredRuntimeBox?.y ?? 0) - (movedRuntimeBox?.y ?? 0))
      ).toBeLessThan(4);
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

      // 主进程重启后 TaskRunCoordinator 与 panel 复用表都为空；重新运行仍需
      // 以持久化 task metadata + source panel id 重建运行，并把同一 panel 从
      // 静态结果卡切回真实原生终端。
      await restartedWin.keyboard.press("Meta+Alt+r");
      let rerunId = "";
      await expect
        .poll(
          async () => {
            const snapshot = await restartedWin.evaluate(async () =>
              window.pier.tasks.runsSnapshot()
            );
            const rerun = Object.values(snapshot.runs).find(
              (run) => run.rootTaskId === SLOW_TASK_ID
            );
            rerunId = rerun?.runId ?? rerunId;
            return {
              panelId: rerun?.nodes[SLOW_TASK_ID]?.panelId,
              runId: rerunId,
              status: rerun?.status,
            };
          },
          { intervals: [200, 300, 500], timeout: 20_000 }
        )
        .toEqual({ panelId, runId: expect.any(String), status: "running" });
      await expect(tab).toHaveAttribute("data-tab-status", "running");
      await expect(resultCard).toHaveCount(0);
      await expect(
        restartedWin.locator(
          '[data-testid="terminal-panel-root"]:visible .terminal-anchor'
        )
      ).toHaveCount(1);
      await expect(
        restartedWin.getByTestId("terminal-runtime-control")
      ).toHaveAttribute("data-run-id", rerunId);
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
