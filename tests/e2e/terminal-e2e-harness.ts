import { type ChildProcess, execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect } from "@playwright/test";

export const OUT_MAIN = join(
  import.meta.dirname,
  "..",
  "..",
  "out",
  "main",
  "index.js"
);
export const PROJECT_ROOT = join(import.meta.dirname, "..", "..");
export const PIER_CLI = join(PROJECT_ROOT, "bin", "pier.mjs");

export const execFileAsync = promisify(execFile);

export const APP_CLOSE_TIMEOUT_MS = 5000;
export const DIRECTORY_REMOVE_RETRIES = 10;
export const DIRECTORY_REMOVE_RETRY_DELAY_MS = 100;

export interface CliResult<T> {
  data?: T;
  error?: {
    code?: string;
    message?: string;
  };
  ok: boolean;
}

export interface RunSpawnData {
  runId: string;
}

export interface RunStatusData {
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

export async function runPierCliJson<T>(
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

export async function killAndWait(
  child: ChildProcess,
  timeoutMs = APP_CLOSE_TIMEOUT_MS
): Promise<void> {
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
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function removeDirectory(path: string): void {
  rmSync(path, {
    force: true,
    maxRetries: DIRECTORY_REMOVE_RETRIES,
    recursive: true,
    retryDelay: DIRECTORY_REMOVE_RETRY_DELAY_MS,
  });
}

export function writeQuickTaskProject(projectRoot: string): void {
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

export const SLOW_TASK_ID = "package-script:slow";

/** Spawns a package-script task and polls until it runs with a panel attached. */
export async function spawnTaskUntilRunning(
  userDataDir: string,
  projectRoot: string,
  taskId: string
): Promise<{ panelId: string; runId: string }> {
  const spawn = await runPierCliJson<RunSpawnData>(userDataDir, [
    "tasks",
    "run",
    taskId,
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
        const node = status.data?.nodes[taskId];
        panelId = node?.panelId ?? panelId;
        return { hasPanelId: panelId !== "", nodeStatus: node?.status };
      },
      { intervals: [200, 200, 200, 200, 300], timeout: 15_000 }
    )
    .toEqual({ hasPanelId: true, nodeStatus: "running" });

  return { panelId, runId };
}

/** Spawns the slow task and polls until it is running with a panel attached. */
export async function spawnSlowTaskUntilRunning(
  userDataDir: string,
  projectRoot: string
): Promise<{ panelId: string; runId: string }> {
  return await spawnTaskUntilRunning(userDataDir, projectRoot, SLOW_TASK_ID);
}

export const PID_LOOP_TASK_ID = "package-script:pid-loop";

/**
 * Project whose `pid-loop` script records its own PID then appends dates
 * forever. Gives cross-window transfer e2e a live PTY + stable PID without
 * osascript keystroke injection (blocked on hosts without Accessibility).
 */
export function writePidLoopProject(
  projectRoot: string,
  pidFile: string
): void {
  const script = [
    `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
    "setInterval(() => {",
    `  fs.appendFileSync(${JSON.stringify(`${pidFile}.dates`)}, Date.now() + "\\n");`,
    "}, 250);",
  ].join(" ");
  writeFileSync(
    join(projectRoot, "package.json"),
    JSON.stringify(
      {
        name: "pier-panel-transfer-pid-e2e",
        private: true,
        scripts: {
          "pid-loop": `node -e 'const fs = require("node:fs"); ${script}'`,
        },
      },
      null,
      2
    )
  );
}

export function makeTempUserDataDir(prefix = "pier-e2e-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}
