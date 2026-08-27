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
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { setWindowSize } from "../support/app-harness.ts";

const PROJECT_ROOT = join(import.meta.dirname, "..", "..", "..");
const OUT_MAIN = join(PROJECT_ROOT, "out", "main", "index.js");
const PIER_CLI = join(PROJECT_ROOT, "bin", "pier.mjs");
const execFileAsync = promisify(execFile);

function createTemporaryDirectory(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

function reviewFile(name: string, value: number, lines = 120): string {
  const marker = Math.floor(lines / 2);
  return `${Array.from({ length: lines }, (_, lineIndex) =>
    lineIndex === marker
      ? `export const ${name} = ${value};`
      : `export const stable_${name}_${lineIndex} = ${lineIndex};`
  ).join("\n")}\n`;
}

const NAMED_REVIEW_FILES = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "zeta",
] as const;

/** 折叠回环只在「一屏装不下」的规模下才会被触发，用编号文件凑够条目数。 */
function numberedReviewFiles(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `file${String(index).padStart(3, "0")}`
  );
}

async function createRepository(
  root: string,
  names: readonly string[] = NAMED_REVIEW_FILES,
  lines = 120
): Promise<void> {
  const sourceDirectory = join(root, "src");
  mkdirSync(sourceDirectory);
  await git(root, ["init", "-q", "-b", "main"]);
  await git(root, ["config", "user.email", "e2e@pier.local"]);
  await git(root, ["config", "user.name", "Pier E2E"]);
  for (const name of names) {
    writeFileSync(
      join(sourceDirectory, `${name}.ts`),
      reviewFile(name, 0, lines)
    );
  }
  await git(root, ["add", "."]);
  await git(root, ["commit", "-q", "-m", "initial"]);
  for (const name of names) {
    writeFileSync(
      join(sourceDirectory, `${name}.ts`),
      reviewFile(name, 1, lines)
    );
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

/**
 * 目标 diff 顶边相对滚动视口顶边的偏移（px）。
 * 树导航 align:"start"，命中后目标文件头应当齐顶；正数表示上方还留着别的内容。
 * S3 headerFlushPx：设备像素取整后 |delta| ≤ 1。
 */
async function diffItemViewportOffset(
  page: Page,
  text: string
): Promise<number | null> {
  return page
    .locator("diffs-container")
    .evaluateAll((containers, expectedText) => {
      const scroller = document.querySelector<HTMLElement>(
        '[data-testid="pierre-diff-root"] .cv-scrollbar'
      );
      if (!scroller) {
        return null;
      }
      const target = containers.find((container) =>
        (container.shadowRoot?.textContent ?? "").includes(expectedText)
      );
      if (!target) {
        return null;
      }
      return Math.round(
        target.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top
      );
    }, text);
}

async function expectHeaderFlush(page: Page, text: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const offset = await diffItemViewportOffset(page, text);
        return offset == null ? Number.POSITIVE_INFINITY : Math.abs(offset);
      },
      { timeout: 10_000 }
    )
    .toBeLessThanOrEqual(1);
}

/**
 * 折叠项的实际渲染高度。必须等于 itemMetrics.diffHeaderHeight——
 * Pierre 折叠项不重测 DOM，两者每差 1px 就会在树导航时按折叠项个数线性错位。
 */
async function collapsedItemHeights(page: Page): Promise<number[]> {
  return page
    .locator("diffs-container")
    .evaluateAll((containers) =>
      containers.map(
        (container) =>
          Math.round(container.getBoundingClientRect().height * 100) / 100
      )
    );
}

/**
 * 折叠稳定后内容总高必须逐帧收敛。滚动条持续抖动的可观测形式就是
 * scrollHeight 在相邻帧之间反复变化（Pierre 不停重测折叠项 / 布局回环）。
 */
async function scrollHeightSamples(
  page: Page,
  frames: number
): Promise<number[]> {
  return page.evaluate(async (count) => {
    const scroller = document.querySelector<HTMLElement>(
      '[data-testid="pierre-diff-root"] .cv-scrollbar'
    );
    if (!scroller) {
      return [];
    }
    const samples: number[] = [];
    for (let index = 0; index < count; index += 1) {
      await new Promise((resolve) => {
        requestAnimationFrame(() => resolve(undefined));
      });
      samples.push(scroller.scrollHeight);
    }
    return samples;
  }, frames);
}

/** 文件树是虚拟化的：深处的条目要先滚进渲染窗口才存在于 DOM。 */
async function revealTreeItem(page: Page, name: RegExp) {
  const item = page.getByRole("treeitem", { name });
  const anchor = page.getByRole("treeitem", { name: /file000\.ts/u });
  const box = await anchor.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await item.count()) > 0) {
      break;
    }
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(120);
  }
  await expect(item).toBeVisible({ timeout: 15_000 });
  return item;
}

async function openReviewPanel(
  application: ElectronApplication,
  page: Page,
  userDataDir: string,
  repository: string
): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page
    .locator('[data-testid="workspace-host-root"][data-workspace-ready="true"]')
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
  const changesTrigger = page
    .locator('[data-testid="git-changes-status-trigger"]:visible')
    .first();
  if (await changesTrigger.isVisible().catch(() => false)) {
    await changesTrigger.click();
  } else {
    await statusTrigger.click();
    await page.getByTestId("git-status-row-changes").click();
  }
  await expect(page.getByTestId("pierre-diff-root")).toBeVisible({
    timeout: 30_000,
  });
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

    await openReviewPanel(application, page, userDataDir, repository);
    await expect(
      page.getByRole("treeitem", { name: /alpha\.ts/u })
    ).toBeVisible({ timeout: 30_000 });
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
    // 13px 代码字号：头高取整为 35，避免折叠导航按项累积半像素。
    for (const height of await collapsedItemHeights(page)) {
      expect(height).toBeCloseTo(35, 1);
    }
    // 折叠已静置 12s，此后内容总高不得再逐帧变化，否则滚动条会一直抖。
    const heightSamples = await scrollHeightSamples(page, 60);
    expect(heightSamples.length).toBe(60);
    expect([...new Set(heightSamples)]).toHaveLength(1);

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
    // 折叠态下导航必须齐顶，不能把上一个文件的折叠头留在目标上方
    await expectHeaderFlush(page, "zeta = 1");

    // 再点一个中间的文件,确认可重复导航
    await page.getByRole("treeitem", { name: /gamma\.ts/u }).click();
    await expect
      .poll(() => isDiffTextInViewport(page, "gamma = 1"), { timeout: 10_000 })
      .toBe(true);
    await expectHeaderFlush(page, "gamma = 1");
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

/**
 * 折叠全部会把选中项挤出可见集合，触发被动恢复；恢复自身又滚动、改布局、
 * 产生新的渲染窗口上报，回头再次触发恢复。没有尝试预算时这个环不会停：
 * 滚动条持续抖动、条目被反复重渲染。规模必须大到一屏装不下，否则不复现。
 */
test("collapse-all with a selected file settles instead of looping", async () => {
  test.setTimeout(180_000);
  const userDataDir = createTemporaryDirectory("pier-git-review-loop-e2e-");
  const repository = createTemporaryDirectory("pier-git-review-loop-repo-");
  // 正文要足够大，折叠时内容仍在陆续到达——布局静止的仓库触发不了这个环。
  await createRepository(repository, numberedReviewFiles(50), 1500);
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
    await openReviewPanel(application, page, userDataDir, repository);

    // 先建立选中态：恢复路径只在有选中项时才武装。
    // 目标取列表深处，折叠后它上方内容塌缩最多，最容易被挤出可见集合。
    await expect(
      page.getByRole("treeitem", { name: /file000\.ts/u })
    ).toBeVisible({ timeout: 30_000 });
    const selected = await revealTreeItem(page, /file040\.ts/u);
    await selected.click();

    // 不等正文落位就折叠：正文仍在到达，布局持续变动，选中项被反复挤出可见集合。
    await page
      .getByRole("button", { name: /Collapse all files|折叠全部文件/u })
      .click();
    await page.waitForTimeout(30_000);

    // 静置后内容总高必须恒定。回环存在时它会逐帧横跳。
    const samples = await scrollHeightSamples(page, 90);
    expect(samples).toHaveLength(90);
    const deltas = samples
      .slice(1)
      .map((height, index) => Math.sign(height - (samples[index] ?? height)))
      .filter((direction) => direction !== 0);
    const directionFlips = deltas.filter(
      (direction, index) => index > 0 && direction !== deltas[index - 1]
    ).length;
    expect(directionFlips).toBe(0);
    expect([...new Set(samples)]).toHaveLength(1);
    expect(pageErrors).toEqual([]);
  } finally {
    await application.close().catch(() => undefined);
    await forceClose(child);
    rmSync(userDataDir, { force: true, recursive: true });
    rmSync(repository, { force: true, recursive: true });
  }
});

/**
 * 折叠路径前序只剩头高，打不中展开文件底垫 / 行高这条病理。
 * 默认展开时点第二个及更后的 content 文件，header 必须贴滚动根（S3 ≤ 1px）。
 */
test("expanded previous files tree navigation pins later files flush", async () => {
  test.setTimeout(120_000);
  const userDataDir = createTemporaryDirectory("pier-git-review-flush-e2e-");
  const repository = createTemporaryDirectory("pier-git-review-flush-repo-");
  await createRepository(repository);
  const application = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: PROJECT_ROOT,
    env: { ...process.env, CODEX_HOME: join(userDataDir, "codex-home") },
  });
  const child = application.process();

  try {
    const page = await application.firstWindow();
    await openReviewPanel(application, page, userDataDir, repository);
    await expect(
      page.getByRole("treeitem", { name: /alpha\.ts/u })
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => isDiffTextInViewport(page, "alpha = 1"), { timeout: 15_000 })
      .toBe(true);

    await page.getByRole("treeitem", { name: /beta\.ts/u }).click();
    await expect
      .poll(() => isDiffTextInViewport(page, "beta = 1"), { timeout: 10_000 })
      .toBe(true);
    await expectHeaderFlush(page, "beta = 1");

    await page.getByRole("treeitem", { name: /zeta\.ts/u }).click();
    await expect
      .poll(() => isDiffTextInViewport(page, "zeta = 1"), { timeout: 10_000 })
      .toBe(true);
    await expectHeaderFlush(page, "zeta = 1");
  } finally {
    await application.close().catch(() => undefined);
    await forceClose(child);
    rmSync(userDataDir, { force: true, recursive: true });
    rmSync(repository, { force: true, recursive: true });
  }
});
