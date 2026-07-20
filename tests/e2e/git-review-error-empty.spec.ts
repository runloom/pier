import { type ChildProcess, execFile } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { _electron as electron, expect, test } from "@playwright/test";
import { setWindowSize } from "./workbench-e2e-harness.ts";

const PROJECT_ROOT = join(import.meta.dirname, "..", "..");
const OUT_MAIN = join(PROJECT_ROOT, "out", "main", "index.js");
const PIER_CLI = join(PROJECT_ROOT, "bin", "pier.mjs");
const execFileAsync = promisify(execFile);

function createTemporaryDirectory(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function forceClose(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  child.kill("SIGKILL");
  await Promise.race([
    exited,
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ]);
}

test("index load failure renders an Empty error state with retry", async () => {
  test.setTimeout(120_000);
  const userDataDir = createTemporaryDirectory("pier-git-error-empty-e2e-");
  const repository = createTemporaryDirectory("pier-git-error-empty-repo-");
  const sourceDirectory = join(repository, "src");
  mkdirSync(sourceDirectory);
  await git(repository, ["init", "-q", "-b", "main"]);
  await git(repository, ["config", "user.email", "e2e@pier.local"]);
  await git(repository, ["config", "user.name", "Pier E2E"]);
  writeFileSync(join(sourceDirectory, "app.ts"), "export const value = 0;\n");
  await git(repository, ["add", "."]);
  await git(repository, ["commit", "-q", "-m", "initial"]);
  writeFileSync(join(sourceDirectory, "app.ts"), "export const value = 1;\n");
  const application = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: PROJECT_ROOT,
    env: { ...process.env, CODEX_HOME: join(userDataDir, "codex-home") },
  });
  const child = application.process();

  try {
    const page = await application.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page
      .locator(
        '[data-testid="workspace-host-root"][data-workspace-ready="true"]'
      )
      .waitFor({ state: "visible", timeout: 30_000 });
    await expect(async () => {
      await setWindowSize(application, page, 1400, 800);
    }).toPass({ timeout: 10_000 });

    await expect(async () => {
      const { stdout } = await execFileAsync(
        process.execPath,
        [PIER_CLI, "terminal", "open", "--cwd", repository, "--json"],
        {
          cwd: PROJECT_ROOT,
          env: { ...process.env, PIER_USER_DATA_DIR: userDataDir },
        }
      );
      expect((JSON.parse(stdout) as { ok?: boolean }).ok).toBe(true);
    }).toPass({ timeout: 10_000 });

    const statusTrigger = page
      .locator('[data-testid="worktree-status-trigger"]:visible')
      .first();
    await expect(statusTrigger).toBeVisible({ timeout: 20_000 });
    await statusTrigger.click();
    await page
      .getByRole("menuitem", { name: /View Changes|查看变更/u })
      .click();
    await expect(page.getByTestId("pierre-diff-root")).toBeVisible({
      timeout: 30_000,
    });

    // 损坏 index 后让面板资源释放再恢复:恢复即初次 index 读取失败。
    writeFileSync(
      join(repository, ".git", "index"),
      "invalid Git index for error empty E2E"
    );
    const changesTab = page.locator('[data-panel-tab-id^="pier.git.changes:"]');
    const terminalTab = page
      .locator('[data-panel-tab-id^="terminal-"]')
      .first();
    await terminalTab.click();
    await expect(page.getByTestId("pierre-diff-root")).toHaveCount(0, {
      timeout: 30_000,
    });
    await changesTab.click();

    const failureTitle = page.getByText(/Failed to load changes|加载变更失败/u);
    await expect(failureTitle).toBeVisible({ timeout: 30_000 });
    // 错误主体状态是 Empty,不是 Alert 横条。
    await expect(
      page.locator('[data-slot="error-empty"]', {
        hasText: /Failed to load|加载/u,
      })
    ).toBeVisible();
    expect(
      await page
        .locator('[role="alert"]')
        .filter({ hasText: /Failed to load|加载变更失败/u })
        .count()
    ).toBe(0);
    await page.screenshot({ path: "test-results/error-empty-state.png" });

    const detailsButton = page.getByRole("button", { name: /Details|详情/u });
    await expect(detailsButton).toBeVisible();
    await detailsButton.click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/index|Git|fatal|error/iu);
    await dialog.getByRole("button", { name: /OK|确定/u }).click();

    // 修复 index 后 Retry 应恢复正文。
    await execFileAsync("rm", ["-f", join(repository, ".git", "index")]);
    await git(repository, ["read-tree", "HEAD"]);
    await page.getByRole("button", { name: /Retry|重试/u }).click();
    await expect(page.getByTestId("pierre-diff-root")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("treeitem", { name: /app\.ts/u })
    ).toBeVisible();
  } finally {
    await application.close().catch(() => undefined);
    await forceClose(child);
    rmSync(userDataDir, { force: true, recursive: true });
    rmSync(repository, { force: true, recursive: true });
  }
});
