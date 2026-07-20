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
import {
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";
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

function reviewFile(name: string, value: number): string {
  return `${Array.from({ length: 120 }, (_, lineIndex) =>
    lineIndex === 60
      ? `export const ${name} = ${value};`
      : `export const stable_${name}_${lineIndex} = ${lineIndex};`
  ).join("\n")}\n`;
}

async function createRepository(root: string): Promise<void> {
  const sourceDirectory = join(root, "src");
  mkdirSync(sourceDirectory);
  await git(root, ["init", "-q", "-b", "main"]);
  await git(root, ["config", "user.email", "e2e@pier.local"]);
  await git(root, ["config", "user.name", "Pier E2E"]);
  for (const name of ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"]) {
    writeFileSync(join(sourceDirectory, `${name}.ts`), reviewFile(name, 0));
  }
  await git(root, ["add", "."]);
  await git(root, ["commit", "-q", "-m", "initial"]);
  for (const name of ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"]) {
    writeFileSync(join(sourceDirectory, `${name}.ts`), reviewFile(name, 1));
  }
}

async function openTerminalWhenReady(userDataDir: string, repository: string) {
  let result: { data?: { panelId?: string }; ok?: boolean } = {};
  await expect(async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [PIER_CLI, "terminal", "open", "--cwd", repository, "--json"],
      {
        cwd: PROJECT_ROOT,
        env: { ...process.env, PIER_USER_DATA_DIR: userDataDir },
      }
    );
    result = JSON.parse(stdout);
    expect(result.ok).toBe(true);
  }).toPass({ timeout: 10_000 });
  return result;
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

async function isDiffTextInViewport(
  page: Page,
  text: string
): Promise<boolean> {
  return page
    .locator("diffs-container")
    .evaluateAll((containers, expectedText) => {
      const scroller = document.querySelector<HTMLElement>(
        '[data-testid="pierre-diff-root"] .cv-scrollbar'
      );
      if (!scroller) {
        return false;
      }
      const viewport = scroller.getBoundingClientRect();
      return containers.some((container) => {
        const item = container.getBoundingClientRect();
        return (
          (container.shadowRoot?.textContent ?? "").includes(expectedText) &&
          item.bottom > viewport.top &&
          item.top < viewport.bottom
        );
      });
    }, text);
}

test("collapse-all then tree navigation shows the target diff without failures", async () => {
  test.setTimeout(120_000);
  const userDataDir = createTemporaryDirectory("pier-git-review-collapse-e2e-");
  const repository = createTemporaryDirectory("pier-git-review-collapse-repo-");
  await createRepository(repository);
  const application = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: PROJECT_ROOT,
    env: { ...process.env, CODEX_HOME: join(userDataDir, "codex-home") },
  });
  const child = application.process();

  try {
    const page = await application.firstWindow();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.waitForLoadState("domcontentloaded");
    await page
      .locator(
        '[data-testid="workspace-host-root"][data-workspace-ready="true"]'
      )
      .waitFor({ state: "visible", timeout: 30_000 });
    await expect(async () => {
      await setWindowSize(application, page, 1400, 800);
    }).toPass({ timeout: 10_000 });

    const opened = await openTerminalWhenReady(userDataDir, repository);
    expect(opened.ok).toBe(true);
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
    await expect
      .poll(() => isDiffTextInViewport(page, "alpha = 1"), { timeout: 15_000 })
      .toBe(true);

    // 复现路径:全部折叠 diff
    await page
      .getByRole("button", { name: /Collapse all files|折叠全部文件/u })
      .click();
    // 折叠本身不应触发渲染看门狗失败(观察 12s 覆盖 10s 超时窗口)
    await page.waitForTimeout(12_000);
    await expect(
      page.getByText(/Failed to render diff|渲染差异失败/u)
    ).toHaveCount(0);

    // 点击目录树导航到较后面的文件
    await page.getByRole("treeitem", { name: /zeta\.ts/u }).click();

    // 目标 diff 应展开并进入视口,且没有失败 alert
    await expect
      .poll(() => isDiffTextInViewport(page, "zeta = 1"), { timeout: 10_000 })
      .toBe(true);
    await expect(
      page.getByText(
        /Failed to navigate to file|Failed to render diff|Failed to refresh changes|导航到文件失败|渲染 diff 失败/u
      )
    ).toHaveCount(0);

    // 再点一个中间的文件,确认可重复导航
    await page.getByRole("treeitem", { name: /gamma\.ts/u }).click();
    await expect
      .poll(() => isDiffTextInViewport(page, "gamma = 1"), { timeout: 10_000 })
      .toBe(true);
    await expect(
      page.getByText(
        /Failed to navigate to file|Failed to render diff|导航到文件失败|渲染 diff 失败/u
      )
    ).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await application.close().catch(() => undefined);
    await forceClose(child);
    rmSync(userDataDir, { force: true, recursive: true });
    rmSync(repository, { force: true, recursive: true });
  }
});
