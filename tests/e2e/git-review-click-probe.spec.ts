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

async function createRepository(root: string): Promise<void> {
  const sourceDirectory = join(root, "src");
  mkdirSync(sourceDirectory);
  await git(root, ["init", "-q", "-b", "main"]);
  await git(root, ["config", "user.email", "e2e@pier.local"]);
  await git(root, ["config", "user.name", "Pier E2E"]);
  const names = [
    "alpha",
    "beta",
    "gamma",
    "delta",
    ...Array.from(
      { length: 26 },
      (_, i) => `extra-${String(i).padStart(2, "0")}`
    ),
  ];
  for (const name of names) {
    writeFileSync(
      join(sourceDirectory, `${name}.ts`),
      `export const x${name.replace("-", "_")} = 0;\n`
    );
  }
  await git(root, ["add", "."]);
  await git(root, ["commit", "-q", "-m", "initial"]);
  for (const name of names) {
    writeFileSync(
      join(sourceDirectory, `${name}.ts`),
      `export const x${name.replace("-", "_")} = 1;\n`
    );
  }
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

test("tree click still opens files after search navigation", async () => {
  test.setTimeout(120_000);
  const userDataDir = createTemporaryDirectory("pier-git-click-probe-e2e-");
  const repository = createTemporaryDirectory("pier-git-click-probe-repo-");
  await createRepository(repository);
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
    await expect(
      page.getByRole("treeitem", { name: /alpha\.ts/u })
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("pierre-diff-root")).toBeVisible({
      timeout: 30_000,
    });

    console.log("STEP: click gamma before search");
    await page.getByRole("treeitem", { name: /gamma\.ts/u }).click();
    await expect(
      page.getByRole("treeitem", { name: /gamma\.ts/u, selected: true })
    ).toBeVisible({ timeout: 5000 });

    console.log("STEP: search navigate beta");
    await page
      .getByRole("button", { name: /Find in changed files|在变更文件中查找/u })
      .click();
    const search = page.getByRole("textbox", {
      name: /Find in changed files|在变更文件中查找/u,
    });
    await search.fill("beta.ts");
    await search.press("Enter");
    await expect(
      page.getByRole("treeitem", { name: /beta\.ts/u, selected: true })
    ).toBeVisible({ timeout: 5000 });
    await search.press("Escape");
    await expect(page.getByTestId("git-review-tree-search-bar")).toHaveCount(0);

    console.log("STEP: click delta after search close");
    await page.getByRole("treeitem", { name: /delta\.ts/u }).click();
    await expect(
      page.getByRole("treeitem", { name: /delta\.ts/u, selected: true })
    ).toBeVisible({ timeout: 5000 });

    console.log("STEP: click alpha after that");
    await page.getByRole("treeitem", { name: /alpha\.ts/u }).click();
    await expect(
      page.getByRole("treeitem", { name: /alpha\.ts/u, selected: true })
    ).toBeVisible({ timeout: 5000 });

    console.log("STEP: collapse+expand sidebar");
    await page
      .getByRole("button", { name: /Collapse changed files|收起变更文件/u })
      .click();
    await expect(
      page.locator('file-tree-container[data-slot="pier-file-tree"]')
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: /Expand changed files|展开变更文件/u })
      .click();
    await expect(
      page.getByRole("treeitem", { name: /gamma\.ts/u })
    ).toBeVisible({ timeout: 5000 });
    console.log("STEP: click gamma after sidebar remount");
    await page.getByRole("treeitem", { name: /gamma\.ts/u }).click();
    await expect(
      page.getByRole("treeitem", { name: /gamma\.ts/u, selected: true })
    ).toBeVisible({ timeout: 5000 });

    console.log("STEP: keyboard separator resize like 353");
    const reviewSeparator = page.locator('[data-slot="resizable-handle"]');
    await reviewSeparator.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("End");
    await page.waitForTimeout(200);
    await reviewSeparator.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.locator('file-tree-container[data-slot="pier-file-tree"]')
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: /Expand changed files|展开变更文件/u })
      .click();
    await expect(
      page.getByRole("treeitem", { name: /gamma\.ts/u })
    ).toBeVisible({ timeout: 5000 });
    console.log("STEP: click gamma after keyboard collapse/expand");
    await page.getByRole("treeitem", { name: /gamma\.ts/u }).click();
    await expect(
      page.getByRole("treeitem", { name: /gamma\.ts/u, selected: true })
    ).toBeVisible({ timeout: 5000 });

    console.log("STEP: tab away and back");
    const changesTab = page.locator('[data-panel-tab-id^="pier.git.changes:"]');
    const terminalTab = page
      .locator('[data-panel-tab-id^="terminal-"]')
      .first();
    await terminalTab.click();
    // 复刻 353:等待资源释放(diff 视图卸载)后再切回
    await expect(page.getByTestId("pierre-diff-root")).toHaveCount(0, {
      timeout: 30_000,
    });
    console.log("STEP: diff released while hidden");
    await changesTab.click();
    await expect(page.getByTestId("pierre-diff-root")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole("treeitem", { name: /delta\.ts/u })
    ).toBeVisible({ timeout: 5000 });
    console.log("STEP: click delta after tab switch");
    await page.getByRole("treeitem", { name: /delta\.ts/u }).click();
    await expect(
      page.getByRole("treeitem", { name: /delta\.ts/u, selected: true })
    ).toBeVisible({ timeout: 5000 });
    console.log("STEP: click beta last");
    // beta 在树顶部,虚拟化窗口外没有 DOM:先滚回顶部再点。
    await page.locator('[data-slot="pier-file-tree-bridge"]').hover();
    await page.mouse.wheel(0, -10_000);
    await expect(page.getByRole("treeitem", { name: /beta\.ts/u })).toBeVisible(
      { timeout: 5000 }
    );
    await page.getByRole("treeitem", { name: /beta\.ts/u }).click();
    await expect(
      page.getByRole("treeitem", { name: /beta\.ts/u, selected: true })
    ).toBeVisible({ timeout: 5000 });
  } finally {
    await application.close().catch(() => undefined);
    await forceClose(child);
    rmSync(userDataDir, { force: true, recursive: true });
    rmSync(repository, { force: true, recursive: true });
  }
});
