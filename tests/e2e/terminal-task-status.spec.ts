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
        },
      },
      null,
      2
    )
  );
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
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
