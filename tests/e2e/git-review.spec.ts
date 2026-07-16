import { type ChildProcess, execFile } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
  type Locator,
  type Page,
  test,
} from "@playwright/test";
import { selectTheme, setWindowSize } from "./workbench-e2e-harness.ts";

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

function reviewBinaryFileName(index: number): string {
  return index === 6 ? "binary-6\\special.bin" : `binary-${String(index)}.bin`;
}

async function createReviewRepository(root: string): Promise<void> {
  const sourceDirectory = join(root, "src");
  mkdirSync(sourceDirectory);
  await git(root, ["init", "-q", "-b", "main"]);
  await git(root, ["config", "user.email", "e2e@pier.local"]);
  await git(root, ["config", "user.name", "Pier E2E"]);
  writeFileSync(join(sourceDirectory, "app.tsx"), "export const value = 1;\n");
  writeFileSync(
    join(sourceDirectory, "script.py"),
    "def answer():\n    return 1\n"
  );
  const largeSource = Array.from(
    { length: 10_000 },
    (_, index) => `export const line${String(index).padStart(5, "0")} = 0;`
  );
  writeFileSync(
    join(sourceDirectory, "large.ts"),
    `${largeSource.join("\n")}\n`
  );
  for (let index = 0; index < 7; index += 1) {
    writeFileSync(
      join(sourceDirectory, reviewBinaryFileName(index)),
      Buffer.from([0, index, 1])
    );
  }
  await git(root, ["add", "."]);
  await git(root, ["commit", "-q", "-m", "initial"]);
  writeFileSync(join(sourceDirectory, "app.tsx"), "export const value = 2;\n");
  await git(root, ["add", "src/app.tsx"]);
  writeFileSync(join(sourceDirectory, "app.tsx"), "export const value = 3;\n");
  writeFileSync(
    join(sourceDirectory, "script.py"),
    "def answer():\n    return 2\n"
  );
  writeFileSync(
    join(sourceDirectory, "large.ts"),
    `${largeSource
      .map((line, index) =>
        index % 2 === 0 ? line.replace("= 0", "= 1") : line
      )
      .join("\n")}\n`
  );
  for (let index = 0; index < 7; index += 1) {
    writeFileSync(
      join(sourceDirectory, reviewBinaryFileName(index)),
      Buffer.from([0, index, 2])
    );
  }
}

async function createScaledReviewRepository(
  root: string,
  fileCount: number,
  changedFileCount = fileCount
): Promise<void> {
  const sourceDirectory = join(root, "src");
  mkdirSync(sourceDirectory);
  await git(root, ["init", "-q", "-b", "main"]);
  await git(root, ["config", "user.email", "e2e@pier.local"]);
  await git(root, ["config", "user.name", "Pier E2E"]);
  for (let index = 0; index < fileCount; index += 1) {
    const suffix = String(index).padStart(4, "0");
    writeFileSync(
      join(sourceDirectory, `file-${suffix}.ts`),
      scaledReviewFile(suffix, 0)
    );
  }
  await git(root, ["add", "."]);
  await git(root, ["commit", "-q", "-m", "initial"]);
  modifyScaledReviewFiles(root, 0, changedFileCount);
}

async function createSpecialPathReviewRepository(root: string): Promise<void> {
  const sourceDirectory = join(root, "src");
  const nestedDirectory = join(sourceDirectory, "nested");
  mkdirSync(sourceDirectory);
  mkdirSync(nestedDirectory);
  await git(root, ["init", "-q", "-b", "main"]);
  await git(root, ["config", "user.email", "e2e@pier.local"]);
  await git(root, ["config", "user.name", "Pier E2E"]);
  const files = [
    [join(root, "\\notes.txt"), "rootSpecial"],
    [join(sourceDirectory, "dir\\..\\file.ts"), "parentTextSpecial"],
    [join(nestedDirectory, "back\\slash.ts"), "nestedSpecial"],
    [join(sourceDirectory, "sibling.ts"), "siblingSpecial"],
  ] as const;
  for (const [path, name] of files) {
    writeFileSync(path, `export const ${name} = 1;\n`);
  }
  await git(root, ["add", "--", "."]);
  await git(root, ["commit", "-q", "-m", "initial"]);
  for (const [path, name] of files) {
    writeFileSync(path, `export const ${name} = 2;\n`);
  }
}

function modifyScaledReviewFiles(
  root: string,
  startIndex: number,
  endIndex: number
): void {
  const sourceDirectory = join(root, "src");
  for (let index = startIndex; index < endIndex; index += 1) {
    const suffix = String(index).padStart(4, "0");
    writeFileSync(
      join(sourceDirectory, `file-${suffix}.ts`),
      scaledReviewFile(suffix, 1)
    );
  }
}

function scaledReviewFile(suffix: string, value: number): string {
  return `${Array.from({ length: 200 }, (_, lineIndex) =>
    lineIndex === 100
      ? `export const value${suffix} = ${value};`
      : `export const stable${suffix}_${lineIndex} = ${lineIndex};`
  ).join("\n")}\n`;
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

async function openTerminal(userDataDir: string, repository: string) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [PIER_CLI, "terminal", "open", "--cwd", repository, "--json"],
    {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PIER_USER_DATA_DIR: userDataDir },
    }
  );
  return JSON.parse(stdout) as {
    data?: { panelId?: string };
    ok?: boolean;
  };
}

async function openTerminalWhenReady(userDataDir: string, repository: string) {
  let result: Awaited<ReturnType<typeof openTerminal>> = {};
  await expect(async () => {
    result = await openTerminal(userDataDir, repository);
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

function groupForPanel(page: Page, panelId: string) {
  return page
    .locator(`[data-panel-tab-id="${panelId}"]`)
    .locator(
      "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' dv-groupview ')][1]"
    );
}

async function panelSharesGroup(
  page: Page,
  leftPanelId: string,
  rightPanelId: string
): Promise<boolean> {
  return await page
    .locator(`[data-panel-tab-id="${leftPanelId}"]`)
    .evaluate((left, rightSelector) => {
      const right = document.querySelector(rightSelector);
      return (
        left.closest(".dv-groupview") !== null &&
        left.closest(".dv-groupview") === right?.closest(".dv-groupview")
      );
    }, `[data-panel-tab-id="${rightPanelId}"]`);
}

async function openReviewFromTerminal(
  page: Page,
  terminalPanelId: string
): Promise<void> {
  await page.locator(`[data-panel-tab-id="${terminalPanelId}"]`).click();
  const statusTrigger = groupForPanel(page, terminalPanelId).locator(
    '[data-testid="worktree-status-trigger"]'
  );
  await expect(statusTrigger).toBeVisible({ timeout: 20_000 });
  await statusTrigger.click();
  await page.getByRole("menuitem", { name: /View Changes|查看变更/u }).click();
}

async function reviewPanelIds(page: Page): Promise<string[]> {
  return await page
    .locator('[data-panel-tab-id^="pier.git.changes:"]')
    .evaluateAll((elements) =>
      elements.flatMap((element) => {
        const id = (element as HTMLElement).dataset.panelTabId;
        return id ? [id] : [];
      })
    );
}

async function dragPanelToGroupCenter(
  page: Page,
  panelId: string,
  targetPanelId: string
): Promise<void> {
  const source = page
    .locator(`[data-panel-tab-id="${panelId}"]`)
    .locator(
      "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' dv-tab ')][1]"
    );
  const target = groupForPanel(page, targetPanelId).locator(
    ":scope > .dv-content-container"
  );
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (
    !(sourceBox && targetBox && targetBox.width > 100 && targetBox.height > 100)
  ) {
    throw new Error("Review drag source or target has no stable geometry");
  }
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 24 }
  );
  await page.waitForTimeout(250);
  await page.mouse.up();
}

async function dragSeparatorToX(
  page: Page,
  separator: Locator,
  targetX: number
): Promise<void> {
  const box = await separator.boundingBox();
  if (!box) {
    throw new Error("Review tree separator has no stable geometry");
  }
  const centerY = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, centerY);
  await page.mouse.down();
  await page.mouse.move(targetX, centerY, { steps: 16 });
  await page.mouse.up();
}

async function dragPanelToWidth(
  page: Page,
  separator: Locator,
  panel: Locator,
  requestedWidth: number
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [separatorBox, currentWidth] = await Promise.all([
      separator.boundingBox(),
      panel.evaluate((element) => element.getBoundingClientRect().width),
    ]);
    if (!separatorBox) {
      throw new Error("Review tree separator has no stable geometry");
    }
    if (Math.abs(currentWidth - requestedWidth) <= 2) {
      return;
    }
    await dragSeparatorToX(
      page,
      separator,
      separatorBox.x + separatorBox.width / 2 + (requestedWidth - currentWidth)
    );
    const nextWidth = await panel.evaluate(
      (element) => element.getBoundingClientRect().width
    );
    if (Math.abs(nextWidth - currentWidth) > 5) {
      return;
    }
    await page.waitForTimeout(16);
  }
}

test("opens one multi-file Review with the real tree and official Pierre CodeView", async () => {
  test.setTimeout(120_000);
  const userDataDir = createTemporaryDirectory("pier-git-review-e2e-");
  const repository = createTemporaryDirectory("pier-git-review-repo-");
  await createReviewRepository(repository);
  const application = await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    cwd: PROJECT_ROOT,
    env: { ...process.env, CODEX_HOME: join(userDataDir, "codex-home") },
  });
  const child = application.process();

  try {
    const page = await application.firstWindow();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).toMatch(/^file:/u);
    await page
      .locator(
        '[data-testid="workspace-host-root"][data-workspace-ready="true"]'
      )
      .waitFor({ state: "visible", timeout: 30_000 });
    await expect(async () => {
      await setWindowSize(application, page, 1400, 800);
    }).toPass({ timeout: 10_000 });
    await page.evaluate(() => {
      const NativeWorker = window.Worker;
      const stats = { created: 0, terminated: 0, urls: [] as string[] };
      const TrackedWorker = new Proxy(NativeWorker, {
        construct(target, args) {
          const worker = Reflect.construct(target, args) as Worker;
          const terminate = worker.terminate.bind(worker);
          let terminated = false;
          stats.created += 1;
          stats.urls.push(String(args[0]));
          worker.terminate = () => {
            if (!terminated) {
              terminated = true;
              stats.terminated += 1;
            }
            terminate();
          };
          return worker;
        },
      });
      Object.defineProperty(window, "Worker", {
        configurable: true,
        value: TrackedWorker,
        writable: true,
      });
      Reflect.set(window, "__pierGitReviewWorkerStats", stats);
    });

    const opened = await openTerminalWhenReady(userDataDir, repository);
    expect(opened.ok).toBe(true);
    const terminalPanelId = opened.data?.panelId ?? "";
    expect(terminalPanelId).not.toBe("");
    const terminalTab = page.locator(
      `[data-panel-tab-id="${terminalPanelId}"]`
    );
    await expect(terminalTab).toBeVisible();
    const terminalTabs = page.locator('[data-panel-tab-id^="terminal-"]');
    const terminalCount = await terminalTabs.count();
    await terminalTab.click();
    await page.keyboard.press("Meta+Shift+KeyD");
    await expect(terminalTabs).toHaveCount(terminalCount + 1, {
      timeout: 20_000,
    });
    const splitTerminalTab = terminalTabs.nth(terminalCount);
    await expect(splitTerminalTab).toBeVisible();
    const shortGroupHeight = await groupForPanel(
      page,
      terminalPanelId
    ).evaluate((group) => group.getBoundingClientRect().height);
    expect(shortGroupHeight).toBeGreaterThan(100);
    expect(shortGroupHeight).toBeLessThan(500);

    const statusTrigger = groupForPanel(page, terminalPanelId).locator(
      '[data-testid="worktree-status-trigger"]'
    );
    await expect(statusTrigger).toBeVisible({ timeout: 20_000 });
    await statusTrigger.click();
    await page
      .getByRole("menuitem", { name: /View Changes|查看变更/u })
      .click();

    const changesTab = page.locator('[data-panel-tab-id^="pier.git.changes:"]');
    await expect(changesTab).toBeVisible({ timeout: 20_000 });
    expect(
      await changesTab.evaluate((changesElement, terminalSelector) => {
        const terminalElement = document.querySelector(terminalSelector);
        return (
          changesElement.closest(".dv-groupview") !== null &&
          changesElement.closest(".dv-groupview") ===
            terminalElement?.closest(".dv-groupview")
        );
      }, `[data-panel-tab-id="${terminalPanelId}"]`)
    ).toBe(true);
    await expect(
      page.locator('[data-panel-tab-id^="pier.git.diff:"]')
    ).toHaveCount(0);
    await expect(page.getByRole("treeitem", { name: /app\.tsx/u })).toBeVisible(
      {
        timeout: 20_000,
      }
    );
    await expect(page.getByTestId("pierre-diff-root")).toBeVisible({
      timeout: 30_000,
    });
    const reviewHeader = page.locator('[data-slot="file-panel-header"]');
    await expect(reviewHeader).toBeVisible();
    expect(
      await reviewHeader.evaluate((header) =>
        Math.round(header.getBoundingClientRect().height)
      )
    ).toBe(40);
    const reviewLayout = reviewHeader.locator("xpath=parent::*");
    const [headerWidth, layoutWidth] = await Promise.all([
      reviewHeader.evaluate((header) => header.getBoundingClientRect().width),
      reviewLayout.evaluate((layout) => layout.getBoundingClientRect().width),
    ]);
    expect(Math.abs(headerWidth - layoutWidth)).toBeLessThanOrEqual(1);

    const reviewPanelGroup = reviewLayout.locator(
      '[data-slot="resizable-panel-group"]'
    );
    const reviewTreePanel = reviewLayout.getByTestId("git-review-tree");
    const reviewSeparator = reviewLayout.locator(
      '[data-slot="resizable-handle"]'
    );
    const panelGroupBox = await reviewPanelGroup.boundingBox();
    if (!panelGroupBox) {
      throw new Error("Review panel group has no stable geometry");
    }
    await expect
      .poll(() =>
        reviewTreePanel.evaluate((panel) => panel.getBoundingClientRect().width)
      )
      .toBeGreaterThanOrEqual(254);
    expect(
      await reviewTreePanel.evaluate((panel) =>
        Math.round(panel.getBoundingClientRect().width)
      )
    ).toBeLessThanOrEqual(258);

    await reviewSeparator.focus();
    const initialTreeWidth = await reviewTreePanel.evaluate(
      (panel) => panel.getBoundingClientRect().width
    );
    await page.keyboard.press("ArrowLeft");
    await expect
      .poll(() =>
        reviewTreePanel.evaluate((panel) => panel.getBoundingClientRect().width)
      )
      .toBeGreaterThanOrEqual(169);
    const shrunkenTreeWidth = await reviewTreePanel.evaluate(
      (panel) => panel.getBoundingClientRect().width
    );
    expect(shrunkenTreeWidth).toBeLessThan(initialTreeWidth);

    await page.keyboard.press("End");
    const maximumTreeWidth = panelGroupBox.width / 2;
    const clampedMaximumWidth = await reviewTreePanel.evaluate(
      (panel) => panel.getBoundingClientRect().width
    );
    expect(clampedMaximumWidth).toBeGreaterThanOrEqual(maximumTreeWidth - 3);
    expect(clampedMaximumWidth).toBeLessThanOrEqual(maximumTreeWidth + 2);

    const widthBeforePointerDrag = clampedMaximumWidth;
    await dragPanelToWidth(
      page,
      reviewSeparator,
      reviewTreePanel,
      Math.max(260, clampedMaximumWidth - 300)
    );
    await expect
      .poll(() =>
        reviewTreePanel.evaluate((panel) => panel.getBoundingClientRect().width)
      )
      .toBeLessThan(widthBeforePointerDrag - 5);
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const panel = document.querySelector<HTMLElement>(
            '[data-testid="git-review-tree"]'
          );
          const stored = Number.parseInt(
            globalThis.localStorage.getItem("pier.git.review.treeWidthPx") ??
              "",
            10
          );
          return panel && Number.isFinite(stored)
            ? Math.abs(panel.getBoundingClientRect().width - stored)
            : Number.POSITIVE_INFINITY;
        })
      )
      .toBeLessThanOrEqual(2);
    const storedTreeWidth = await page.evaluate(() =>
      Number.parseInt(
        globalThis.localStorage.getItem("pier.git.review.treeWidthPx") ?? "",
        10
      )
    );

    await reviewSeparator.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: /Expand changed files|展开变更文件/u })
    ).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.locator('file-tree-container[data-slot="pier-file-tree"]')
    ).toHaveCount(0);
    await expect(reviewTreePanel).toHaveAttribute("aria-hidden", "true");
    expect(pageErrors).toEqual([]);
    await page
      .getByRole("button", { name: /Expand changed files|展开变更文件/u })
      .click();
    await expect(
      page.getByRole("button", {
        name: /Collapse changed files|收起变更文件/u,
      })
    ).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.locator('file-tree-container[data-slot="pier-file-tree"]')
    ).toBeVisible();
    await expect
      .poll(() =>
        reviewTreePanel.evaluate((panel) => panel.getBoundingClientRect().width)
      )
      .toBeGreaterThanOrEqual(storedTreeWidth - 2);
    expect(
      await reviewTreePanel.evaluate((panel) =>
        Math.round(panel.getBoundingClientRect().width)
      )
    ).toBeLessThanOrEqual(storedTreeWidth + 2);
    await terminalTab.click();
    await expect(page.getByTestId("pierre-diff-root")).toHaveCount(0);
    await changesTab.click();
    await expect(page.getByTestId("pierre-diff-root")).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /Collapse changed files|收起变更文件/u,
      })
    ).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.locator('file-tree-container[data-slot="pier-file-tree"]')
    ).toBeVisible();
    expect(
      await page.evaluate(
        (root) =>
          globalThis.localStorage.getItem(
            `pier.git.review.treeCollapsed:${root}`
          ),
        repository
      )
    ).not.toBe("true");

    await page
      .getByRole("button", {
        name: /Collapse changed files|收起变更文件/u,
      })
      .click();
    await expect(
      page.locator('file-tree-container[data-slot="pier-file-tree"]')
    ).toHaveCount(0);
    await expect(reviewTreePanel).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByTestId("pierre-diff-root")).toBeVisible();
    await page
      .getByRole("button", {
        name: /Find in changed files|在变更文件中查找/u,
      })
      .click();
    const reviewTreeSearch = page.getByRole("textbox", {
      name: /Find in changed files|在变更文件中查找/u,
    });
    await expect(reviewTreeSearch).toBeFocused();
    await expect
      .poll(() =>
        reviewTreePanel.evaluate((panel) => panel.getBoundingClientRect().width)
      )
      .toBeGreaterThanOrEqual(storedTreeWidth - 2);
    expect(
      await reviewTreePanel.evaluate((panel) =>
        Math.round(panel.getBoundingClientRect().width)
      )
    ).toBeLessThanOrEqual(storedTreeWidth + 2);
    await reviewTreeSearch.fill("script.py");
    await reviewTreeSearch.press("Enter");
    await expect(reviewHeader.getByText("script.py")).toBeVisible();
    await reviewTreeSearch.press("Escape");
    await expect(page.getByTestId("git-review-tree-search-bar")).toHaveCount(0);
    await expect(
      page.getByRole("treeitem", { name: /app\.tsx/u })
    ).toBeVisible();
    await expect(
      page.getByRole("treeitem", { name: /script\.py/u, selected: true })
    ).toBeVisible();
    await splitTerminalTab.click();
    const inactiveReviewState = await page.evaluate(
      async (reviewPanelId) => {
        const snapshot = await window.pier.terminal.debugSnapshot();
        return snapshot.renderer?.panels.find(
          (panel) => panel.panelId === reviewPanelId
        );
      },
      await changesTab.getAttribute("data-panel-tab-id")
    );
    expect(inactiveReviewState).toMatchObject({
      dockviewActive: false,
      dockviewVisible: true,
      resourceMode: "visible",
    });
    await expect(page.getByTestId("git-review-tree")).toBeVisible();
    await expect(page.getByTestId("pierre-diff-root")).toBeVisible();
    await expect
      .poll(() => isDiffTextInViewport(page, "return 2"), {
        timeout: 10_000,
      })
      .toBe(true);
    await changesTab.click();
    await page
      .getByRole("treeitem", { name: /binary-6\\special\.bin/u })
      .click();
    await expect
      .poll(
        () =>
          page.locator("diffs-container").evaluateAll((containers) => {
            const scroller = document.querySelector<HTMLElement>(
              '[data-testid="pierre-diff-root"] .cv-scrollbar'
            );
            if (!scroller) {
              return false;
            }
            const viewport = scroller.getBoundingClientRect();
            return containers.some((container) => {
              const text = container.shadowRoot?.textContent ?? "";
              const bounds = container.getBoundingClientRect();
              return (
                text.includes("binary-6\\special.bin") &&
                /Binary file|二进制文件/u.test(text) &&
                bounds.bottom > viewport.top &&
                bounds.top < viewport.bottom
              );
            });
          }),
        { timeout: 30_000 }
      )
      .toBe(true);
    await expect(
      page
        .locator('[role="alert"]')
        .filter({ hasText: /Binary file|二进制文件/u })
    ).toHaveCount(0);
    await expect(
      page.getByText(/additional files could not be rendered|个文件无法显示/u)
    ).toHaveCount(0);
    const shortDiffHeight = await page
      .getByTestId("pierre-diff-root")
      .evaluate((root) => root.getBoundingClientRect().height);
    expect(shortDiffHeight).toBeGreaterThan(0);
    await page.getByRole("treeitem", { name: /app\.tsx/u }).click();

    const diffContainers = page.locator("diffs-container");
    await expect
      .poll(
        () =>
          diffContainers.evaluateAll((containers) => {
            const sectionTexts = containers.map(
              (container) => container.shadowRoot?.textContent ?? ""
            );
            return {
              hasStagedSection: sectionTexts.some(
                (text) =>
                  text.includes("value = 1") && text.includes("value = 2")
              ),
              hasWorktreeSection: sectionTexts.some(
                (text) =>
                  text.includes("value = 2") && text.includes("value = 3")
              ),
            };
          }),
        { timeout: 30_000 }
      )
      .toEqual({ hasStagedSection: true, hasWorktreeSection: true });
    const firstWorkerCount = await page.evaluate(
      () =>
        (
          Reflect.get(window, "__pierGitReviewWorkerStats") as {
            created: number;
          }
        ).created
    );
    expect(firstWorkerCount).toBeGreaterThan(0);
    const workerUrls = await page.evaluate(
      () =>
        (
          Reflect.get(window, "__pierGitReviewWorkerStats") as {
            urls: string[];
          }
        ).urls
    );
    expect(workerUrls).toEqual(
      expect.arrayContaining([expect.stringMatching(/worker-[^/]+\.js$/u)])
    );
    const appContainer = diffContainers
      .filter({ hasText: "export const value = 1" })
      .first();
    await expect(appContainer).toBeVisible({ timeout: 30_000 });
    await selectTheme(page, { id: "light", label: /Light|浅色/u });
    const initialThemeSignature = await appContainer.evaluate((host) => {
      const spans = [
        ...(host.shadowRoot?.querySelectorAll("[data-line] span") ?? []),
      ];
      return JSON.stringify({
        background: getComputedStyle(host).backgroundColor,
        tokenColors: [
          ...new Set(spans.map((span) => getComputedStyle(span).color)),
        ],
      });
    });
    await selectTheme(page, { id: "dark", label: /Dark|深色/u });
    await expect
      .poll(
        () =>
          appContainer.evaluate((host) => {
            const spans = [
              ...(host.shadowRoot?.querySelectorAll("[data-line] span") ?? []),
            ];
            return JSON.stringify({
              background: getComputedStyle(host).backgroundColor,
              tokenColors: [
                ...new Set(spans.map((span) => getComputedStyle(span).color)),
              ],
            });
          }),
        { timeout: 30_000 }
      )
      .not.toBe(initialThemeSignature);
    await expect
      .poll(
        () =>
          appContainer.evaluate((host) => {
            const spans = [
              ...(host.shadowRoot?.querySelectorAll("[data-line] span") ?? []),
            ];
            return new Set(spans.map((span) => getComputedStyle(span).color))
              .size;
          }),
        { timeout: 30_000 }
      )
      .toBeGreaterThan(1);
    const darkThemeSignature = await appContainer.evaluate((host) => {
      const spans = [
        ...(host.shadowRoot?.querySelectorAll("[data-line] span") ?? []),
      ];
      return {
        background: getComputedStyle(host).backgroundColor,
        tokenColors: [
          ...new Set(spans.map((span) => getComputedStyle(span).color)),
        ],
      };
    });
    expect(darkThemeSignature.tokenColors.length).toBeGreaterThan(1);

    await terminalTab.click();
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (
                Reflect.get(window, "__pierGitReviewWorkerStats") as {
                  terminated: number;
                }
              ).terminated
          ),
        { timeout: 5000 }
      )
      .toBeGreaterThanOrEqual(firstWorkerCount);
    await changesTab.click();
    await expect(page.getByTestId("pierre-diff-root")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("treeitem", { name: /app\.tsx/u }).click();
    await selectTheme(page, { id: "light", label: /Light|浅色/u });
    await expect
      .poll(
        () =>
          diffContainers
            .filter({ hasText: "export const value = 1" })
            .first()
            .evaluate((host) => {
              const spans = [
                ...(host.shadowRoot?.querySelectorAll("[data-line] span") ??
                  []),
              ];
              return JSON.stringify({
                background: getComputedStyle(host).backgroundColor,
                tokenColors: [
                  ...new Set(spans.map((span) => getComputedStyle(span).color)),
                ],
              });
            }),
        { timeout: 30_000 }
      )
      .not.toBe(JSON.stringify(darkThemeSignature));

    writeFileSync(
      join(repository, "src", "script.py"),
      "def answer():\n    return 4\n"
    );
    await page.getByRole("treeitem", { name: /script\.py/u }).click();
    await expect
      .poll(
        () =>
          diffContainers.evaluateAll((containers) =>
            containers.some((host) =>
              (host.shadowRoot?.textContent ?? "").includes("return 4")
            )
          ),
        { timeout: 30_000 }
      )
      .toBe(true);
    const scriptContainer = diffContainers
      .filter({ hasText: "return 4" })
      .first();
    await expect
      .poll(
        () =>
          scriptContainer.evaluate((host) => {
            const scroller = document.querySelector<HTMLElement>(
              '[data-testid="pierre-diff-root"] .cv-scrollbar'
            );
            if (!scroller) {
              return false;
            }
            const viewport = scroller.getBoundingClientRect();
            const item = host.getBoundingClientRect();
            return item.bottom > viewport.top && item.top < viewport.bottom;
          }),
        { timeout: 30_000 }
      )
      .toBe(true);
    await expect
      .poll(
        () =>
          scriptContainer.evaluate((host) => {
            const spans = [
              ...(host.shadowRoot?.querySelectorAll("[data-line] span") ?? []),
            ];
            return new Set(spans.map((span) => getComputedStyle(span).color))
              .size;
          }),
        { timeout: 30_000 }
      )
      .toBeGreaterThan(1);
    const codeTypography = await page
      .locator('[data-testid="pierre-diff-root"] .cv-scrollbar')
      .evaluate((element) => ({
        actual: getComputedStyle(element)
          .getPropertyValue("--diffs-font-family")
          .trim(),
        expected: getComputedStyle(document.documentElement)
          .getPropertyValue("--font-mono")
          .trim(),
      }));
    expect(codeTypography.expected).not.toBe("");
    expect(codeTypography.actual).toBe(codeTypography.expected);

    await page.evaluate(() => {
      const durations: number[] = [];
      Reflect.set(window, "__pierGitReviewLongTasks", durations);
      new PerformanceObserver((list) => {
        durations.push(...list.getEntries().map((entry) => entry.duration));
      }).observe({ entryTypes: ["longtask"] });
    });
    const largeStartedAt = performance.now();
    await page.getByRole("treeitem", { name: /large\.ts/u }).click();
    await expect
      .poll(
        () =>
          diffContainers.evaluateAll((containers) =>
            containers.some((container) =>
              (container.shadowRoot?.textContent ?? "").includes("line00000")
            )
          ),
        { timeout: 30_000 }
      )
      .toBe(true);
    const largeContainer = diffContainers
      .filter({ hasText: "large.ts" })
      .first();
    const initialVirtualWindow = await largeContainer.evaluate((container) => ({
      lineCount:
        container.shadowRoot?.querySelectorAll("[data-line]").length ?? 0,
      text: container.shadowRoot?.textContent ?? "",
    }));
    expect(initialVirtualWindow.text).not.toContain("line09998");
    expect(initialVirtualWindow.lineCount).toBeGreaterThan(0);
    expect(initialVirtualWindow.lineCount).toBeLessThan(1000);
    const largeFirstPaintMs = performance.now() - largeStartedAt;
    expect(largeFirstPaintMs).toBeLessThan(5000);
    const blankFrameMetrics = await largeContainer.evaluate(
      async (container) => {
        const scroller = document.querySelector<HTMLElement>(
          '[data-testid="pierre-diff-root"] .cv-scrollbar'
        );
        if (!scroller) {
          throw new Error("large diff scroller missing");
        }
        const targetScrollTop = scroller.scrollHeight - scroller.clientHeight;
        const scrollLargeDiffToBottom = () => {
          scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
        };
        const startedAt = performance.now();
        scroller.dispatchEvent(
          new WheelEvent("wheel", { bubbles: true, deltaY: 1 })
        );
        scrollLargeDiffToBottom();
        scroller.dispatchEvent(new Event("scroll"));
        return await new Promise<{
          finalScrollTop: number;
          maxVisibleLine: number;
          maxBlankMs: number;
          maxConsecutiveBlankFrames: number;
          sampledFrames: number;
          scrollHeight: number;
          targetScrollTop: number;
          targetReached: boolean;
        }>((resolve) => {
          let blankFrames = 0;
          let blankStartedAt: number | null = null;
          let maxBlankFrames = 0;
          let maxBlankMs = 0;
          let maxVisibleLine = -1;
          let sampledFrames = 0;
          let settledVisibleFrames = 0;
          const sample = (now: number) => {
            sampledFrames += 1;
            const viewport = scroller.getBoundingClientRect();
            const lines = [
              ...(container.shadowRoot?.querySelectorAll<HTMLElement>(
                "[data-line]"
              ) ?? []),
            ];
            const visible = lines.filter((line) => {
              const rect = line.getBoundingClientRect();
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                rect.bottom > viewport.top &&
                rect.top < viewport.bottom
              );
            });
            if (visible.length === 0) {
              blankStartedAt ??= sampledFrames === 1 ? startedAt : now;
              blankFrames += 1;
              maxBlankFrames = Math.max(maxBlankFrames, blankFrames);
              settledVisibleFrames = 0;
            } else {
              if (blankStartedAt !== null) {
                maxBlankMs = Math.max(maxBlankMs, now - blankStartedAt);
              }
              blankStartedAt = null;
              blankFrames = 0;
              const targetVisible = visible.some((line) => {
                const match = line.textContent?.match(/line(\d{5})/u);
                if (match?.[1] !== undefined) {
                  maxVisibleLine = Math.max(maxVisibleLine, Number(match[1]));
                }
                return match?.[1] !== undefined && Number(match[1]) >= 9900;
              });
              settledVisibleFrames = targetVisible
                ? settledVisibleFrames + 1
                : 0;
            }
            const targetReached = settledVisibleFrames >= 2;
            if (targetReached || now - startedAt >= 5000) {
              if (blankStartedAt !== null) {
                maxBlankMs = Math.max(maxBlankMs, now - blankStartedAt);
              }
              resolve({
                finalScrollTop: scroller.scrollTop,
                maxVisibleLine,
                maxBlankMs,
                maxConsecutiveBlankFrames: maxBlankFrames,
                sampledFrames,
                scrollHeight: scroller.scrollHeight,
                targetScrollTop,
                targetReached,
              });
              return;
            }
            scrollLargeDiffToBottom();
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
      }
    );
    expect(
      blankFrameMetrics.targetReached,
      JSON.stringify(blankFrameMetrics)
    ).toBe(true);
    expect(blankFrameMetrics.maxConsecutiveBlankFrames).toBeLessThanOrEqual(2);
    expect(blankFrameMetrics.maxBlankMs).toBeLessThanOrEqual(100);
    expect(blankFrameMetrics.sampledFrames).toBeGreaterThan(0);
    expect(
      await largeContainer.evaluate(
        (container) =>
          container.shadowRoot?.querySelectorAll("[data-line]").length ?? 0
      )
    ).toBeLessThan(1000);
    const longTasks = await page.evaluate(
      () => (Reflect.get(window, "__pierGitReviewLongTasks") as number[]) ?? []
    );
    expect(Math.max(0, ...longTasks)).toBeLessThan(100);

    const cycleReviewResource = async (count: number) => {
      for (let index = 0; index < count; index += 1) {
        await terminalTab.click();
        await expect(page.getByTestId("pierre-diff-root")).toHaveCount(0);
        await changesTab.click();
        await expect(page.getByTestId("pierre-diff-root")).toBeVisible({
          timeout: 30_000,
        });
      }
    };
    await cycleReviewResource(2);
    await terminalTab.click();
    await expect(page.getByTestId("pierre-diff-root")).toHaveCount(0);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.collectGarbage");
    const baselineHeap = await cdp.send("Runtime.getHeapUsage");
    await changesTab.click();
    await cycleReviewResource(20);
    await terminalTab.click();
    await expect(page.getByTestId("pierre-diff-root")).toHaveCount(0);
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const stats = Reflect.get(window, "__pierGitReviewWorkerStats") as {
              created: number;
              terminated: number;
            };
            return stats.created - stats.terminated;
          }),
        { timeout: 2000 }
      )
      .toBe(0);
    await cdp.send("HeapProfiler.collectGarbage");
    const finalHeap = await cdp.send("Runtime.getHeapUsage");
    const allowedHeapGrowth = Math.max(
      10 * 1024 * 1024,
      baselineHeap.usedSize * 0.1
    );
    expect(finalHeap.usedSize - baselineHeap.usedSize).toBeLessThanOrEqual(
      allowedHeapGrowth
    );
    await cdp.detach();
    await expect(changesTab).toHaveCount(1);
    await expect(
      page.locator('[data-panel-tab-id^="pier.git.diff:"]')
    ).toHaveCount(0);

    const relevantConsoleErrors = consoleErrors.filter((message) =>
      /worker|wasm|content security|csp|module|unhandled/iu.test(message)
    );
    expect(relevantConsoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await application.close().catch(() => undefined);
    await forceClose(child);
    rmSync(userDataDir, { force: true, recursive: true });
    rmSync(repository, { force: true, recursive: true });
  }
});

test("keeps 35-file first content and 2,001-file on-demand navigation bounded", async () => {
  test.setTimeout(180_000);
  const userDataDir = createTemporaryDirectory("pier-git-review-scale-e2e-");
  const repository = createTemporaryDirectory("pier-git-review-scale-repo-");
  await createScaledReviewRepository(repository, 2001, 35);
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
    await page.evaluate(() => {
      const durations: number[] = [];
      Reflect.set(window, "__pierGitReviewScaleLongTasks", durations);
      new PerformanceObserver((list) => {
        durations.push(...list.getEntries().map((entry) => entry.duration));
      }).observe({ entryTypes: ["longtask"] });
    });

    const opened = await openTerminalWhenReady(userDataDir, repository);
    expect(opened.ok).toBe(true);
    const statusTrigger = page
      .locator('[data-testid="worktree-status-trigger"]:visible')
      .first();
    await expect(statusTrigger).toBeVisible({ timeout: 20_000 });
    await statusTrigger.click();
    const viewChangesItem = page.getByRole("menuitem", {
      name: /View Changes|查看变更/u,
    });
    await viewChangesItem.evaluate((element) => {
      element.addEventListener(
        "click",
        () => {
          Reflect.set(
            window,
            "__pierGitReviewFirstContentStartedAt",
            performance.now()
          );
        },
        { once: true }
      );
    });
    await viewChangesItem.click();
    await expect(
      page.getByRole("treeitem", { name: /file-0000\.ts/u })
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("pierre-diff-root")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator("diffs-container").first()).toBeVisible({
      timeout: 30_000,
    });
    const firstContentDuration = await page.evaluate(
      () =>
        performance.now() -
        Number(Reflect.get(window, "__pierGitReviewFirstContentStartedAt"))
    );
    expect(firstContentDuration).toBeLessThan(2000);

    modifyScaledReviewFiles(repository, 35, 2001);
    const target = page.getByRole("treeitem", { name: /file-2000\.ts/u });
    await expect(async () => {
      await page.locator('[data-slot="pier-file-tree-bridge"]').hover();
      await page.mouse.wheel(0, 100_000);
      await expect(target).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    await expect(
      page.getByText(
        /more files.*load|还有.*文件.*加载|changed files.*(?:omitted|limit)|变更文件.*(?:省略|上限)/u
      )
    ).toHaveCount(0);
    await target.evaluate((element) => {
      element.addEventListener(
        "click",
        () => {
          Reflect.set(
            window,
            "__pierGitReviewNavigationStartedAt",
            performance.now()
          );
        },
        { once: true }
      );
    });
    await target.click();
    await expect
      .poll(() => isDiffTextInViewport(page, "value2000"), {
        timeout: 30_000,
      })
      .toBe(true);
    const navigationDuration = await page.evaluate(
      () =>
        performance.now() -
        Number(Reflect.get(window, "__pierGitReviewNavigationStartedAt"))
    );
    expect(navigationDuration).toBeLessThan(2000);

    const indexPath = join(repository, ".git", "index");
    const validIndex = readFileSync(indexPath);
    try {
      writeFileSync(indexPath, "invalid Git index for Review E2E");
      writeFileSync(
        join(repository, "src", "file-0000.ts"),
        scaledReviewFile("0000", 2)
      );
      const refreshFailure = page.getByText(
        /Failed to refresh changes|刷新变更失败/u
      );
      await expect(refreshFailure).toBeVisible({ timeout: 30_000 });
      // 再点已选中文件：应重新定位保留正文（不依赖 selection change）。
      await target.click();
      await expect
        .poll(() => isDiffTextInViewport(page, "value2000"), {
          timeout: 15_000,
        })
        .toBe(true);

      const failureAlert = refreshFailure.locator(
        'xpath=ancestor::*[@role="alert"][1]'
      );
      await failureAlert.getByRole("button", { name: /Details|详情/u }).click();
      const detailsDialog = page.getByRole("alertdialog");
      await expect(detailsDialog).toBeVisible();
      await expect(detailsDialog).toContainText(/index|Git|fatal|error/iu);
      await detailsDialog.getByRole("button", { name: /OK|确定/u }).click();

      writeFileSync(indexPath, validIndex);
      const onDemandTarget = page.getByRole("treeitem", {
        name: /file-1999\.ts/u,
      });
      await expect(onDemandTarget).toBeVisible({ timeout: 5000 });
      await onDemandTarget.click();
      await expect
        .poll(() => isDiffTextInViewport(page, "value1999"), {
          timeout: 30_000,
        })
        .toBe(true);
    } finally {
      writeFileSync(indexPath, validIndex);
    }

    await page.locator('[data-slot="pier-file-tree-bridge"]').hover();
    await page.mouse.wheel(0, -100_000);
    const loadedTarget = page.getByRole("treeitem", {
      name: /file-0001\.ts/u,
    });
    await expect(loadedTarget).toBeVisible({ timeout: 5000 });
    await loadedTarget.evaluate((element) => {
      element.addEventListener(
        "click",
        () => {
          Reflect.set(
            window,
            "__pierGitReviewLoadedNavigationStartedAt",
            performance.now()
          );
        },
        { once: true }
      );
    });
    await loadedTarget.click();
    await expect
      .poll(() => isDiffTextInViewport(page, "value0001"), {
        timeout: 5000,
      })
      .toBe(true);
    const loadedNavigationDuration = await page.evaluate(
      () =>
        performance.now() -
        Number(Reflect.get(window, "__pierGitReviewLoadedNavigationStartedAt"))
    );
    expect(loadedNavigationDuration).toBeLessThan(500);
    const longTasks = await page.evaluate(
      () =>
        (Reflect.get(window, "__pierGitReviewScaleLongTasks") as number[]) ?? []
    );
    expect(Math.max(0, ...longTasks)).toBeLessThan(100);
    await expect(
      page.locator('[data-panel-tab-id^="pier.git.changes:"]')
    ).toHaveCount(1);
    expect(pageErrors).toEqual([]);
  } finally {
    await application.close().catch(() => undefined);
    await forceClose(child);
    rmSync(userDataDir, { force: true, recursive: true });
    rmSync(repository, { force: true, recursive: true });
  }
});

test("reuses Review in its actual Dockview group after a drag", async () => {
  test.setTimeout(120_000);
  const userDataDir = createTemporaryDirectory("pier-git-review-groups-e2e-");
  const repository = createTemporaryDirectory("pier-git-review-groups-repo-");
  await createReviewRepository(repository);
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
    await page.emulateMedia({ reducedMotion: "reduce" });

    const opened = await openTerminalWhenReady(userDataDir, repository);
    const terminalA = opened.data?.panelId ?? "";
    expect(terminalA).not.toBe("");
    const terminalTabs = page.locator('[data-panel-tab-id^="terminal-"]');
    await expect(
      page.locator(`[data-panel-tab-id="${terminalA}"]`)
    ).toBeVisible();
    const beforeSplitIds = await terminalTabs.evaluateAll((elements) =>
      elements.flatMap((element) => {
        const id = (element as HTMLElement).dataset.panelTabId;
        return id ? [id] : [];
      })
    );
    await page.locator(`[data-panel-tab-id="${terminalA}"]`).click();
    await page.keyboard.press("Meta+KeyD");
    await expect(terminalTabs).toHaveCount(beforeSplitIds.length + 1, {
      timeout: 20_000,
    });
    const afterSplitIds = await terminalTabs.evaluateAll((elements) =>
      elements.flatMap((element) => {
        const id = (element as HTMLElement).dataset.panelTabId;
        return id ? [id] : [];
      })
    );
    const terminalB = afterSplitIds.find(
      (panelId) => !beforeSplitIds.includes(panelId)
    );
    if (!terminalB) {
      throw new Error("split terminal id missing");
    }
    await expect
      .poll(() => panelSharesGroup(page, terminalA, terminalB))
      .toBe(false);
    await expect(
      groupForPanel(page, terminalB).locator(
        '[data-testid="worktree-status-trigger"]'
      )
    ).toBeVisible({ timeout: 20_000 });

    await openReviewFromTerminal(page, terminalA);
    await expect
      .poll(() => reviewPanelIds(page), { timeout: 20_000 })
      .toHaveLength(1);
    const originalReviewId = (await reviewPanelIds(page))[0];
    if (!originalReviewId) {
      throw new Error("Review panel id missing");
    }
    expect(await panelSharesGroup(page, originalReviewId, terminalA)).toBe(
      true
    );

    await dragPanelToGroupCenter(page, originalReviewId, terminalB);
    await expect
      .poll(() => panelSharesGroup(page, originalReviewId, terminalB), {
        timeout: 10_000,
      })
      .toBe(true);
    expect(await panelSharesGroup(page, originalReviewId, terminalA)).toBe(
      false
    );
    expect(await reviewPanelIds(page)).toEqual([originalReviewId]);

    await openReviewFromTerminal(page, terminalB);
    expect(await reviewPanelIds(page)).toEqual([originalReviewId]);
    await expect(
      page
        .locator(`[data-panel-tab-id="${originalReviewId}"]`)
        .locator(
          "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' dv-tab ')][1]"
        )
    ).toHaveClass(/dv-active-tab/u);

    await openReviewFromTerminal(page, terminalA);
    await expect
      .poll(() => reviewPanelIds(page), { timeout: 20_000 })
      .toHaveLength(2);
    const originalGroupReviewId = (await reviewPanelIds(page)).find(
      (panelId) => panelId !== originalReviewId
    );
    if (!originalGroupReviewId) {
      throw new Error("new Review id for original group missing");
    }
    expect(await panelSharesGroup(page, originalGroupReviewId, terminalA)).toBe(
      true
    );
    expect(await panelSharesGroup(page, originalReviewId, terminalB)).toBe(
      true
    );
  } finally {
    await application.close().catch(() => undefined);
    await forceClose(child);
    rmSync(userDataDir, { force: true, recursive: true });
    rmSync(repository, { force: true, recursive: true });
  }
});

test("opens POSIX backslash paths through the real tree keyboard flow", async () => {
  test.skip(process.platform === "win32", "POSIX Git paths only");
  test.setTimeout(120_000);
  const userDataDir = createTemporaryDirectory("pier-git-review-paths-e2e-");
  const repository = createTemporaryDirectory("pier-git-review-paths-repo-");
  await createSpecialPathReviewRepository(repository);
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
    const opened = await openTerminalWhenReady(userDataDir, repository);
    const terminalId = opened.data?.panelId ?? "";
    expect(terminalId).not.toBe("");
    await openReviewFromTerminal(page, terminalId);

    const treeHost = page.locator(
      '[data-slot="pier-file-tree"][aria-label="Changed files"], [data-slot="pier-file-tree"][aria-label="变更文件"]'
    );
    await expect(treeHost).toBeVisible({ timeout: 20_000 });
    const tree = treeHost.getByRole("tree");
    await expect(tree).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(
        () =>
          tree
            .locator('[role="treeitem"][data-item-path]')
            .evaluateAll((rows) =>
              rows.map((row) => (row as HTMLElement).dataset.itemPath ?? "")
            ),
        { timeout: 20_000 }
      )
      .toEqual(
        expect.arrayContaining([
          "\\notes.txt",
          "src/dir\\..\\file.ts",
          "src/nested/back\\slash.ts",
          "src/sibling.ts",
        ])
      );
    const renderedPaths = await tree
      .locator('[role="treeitem"][data-item-path]')
      .evaluateAll((rows) =>
        rows.map((row) => (row as HTMLElement).dataset.itemPath ?? "")
      );
    expect(renderedPaths).not.toContain("src/dir");
    expect(renderedPaths).not.toContain("src/..");

    const srcDirectory = tree.locator(
      '[role="treeitem"][data-item-path="src/"]'
    );
    await expect(srcDirectory).toBeVisible();
    if ((await srcDirectory.getAttribute("aria-expanded")) === "true") {
      await srcDirectory.click();
    }
    await expect(srcDirectory).toHaveAttribute("aria-expanded", "false");
    await srcDirectory.focus();
    await srcDirectory.press("ArrowRight");
    await expect(srcDirectory).toHaveAttribute("aria-expanded", "true");

    const nestedBackslash = tree.getByRole("treeitem", {
      name: /back\\slash\.ts/u,
    });
    await expect(nestedBackslash).toBeVisible();
    await nestedBackslash.focus();
    await nestedBackslash.press("Enter");
    await expect
      .poll(
        () =>
          page.locator("diffs-container").evaluateAll((containers) => {
            const scroller = document.querySelector<HTMLElement>(
              '[data-testid="pierre-diff-root"] .cv-scrollbar'
            );
            if (!scroller) {
              return false;
            }
            const viewport = scroller.getBoundingClientRect();
            return containers.some((container) => {
              const text = container.shadowRoot?.textContent ?? "";
              const rect = container.getBoundingClientRect();
              return (
                text.includes("nestedSpecial = 1") &&
                text.includes("nestedSpecial = 2") &&
                rect.bottom > viewport.top &&
                rect.top < viewport.bottom
              );
            });
          }),
        { timeout: 30_000 }
      )
      .toBe(true);

    const rootBackslash = tree.getByRole("treeitem", {
      name: /\\notes\.txt/u,
    });
    await rootBackslash.focus();
    await rootBackslash.press("Enter");
    await expect
      .poll(
        () =>
          page.locator("diffs-container").evaluateAll((containers) => {
            const scroller = document.querySelector<HTMLElement>(
              '[data-testid="pierre-diff-root"] .cv-scrollbar'
            );
            if (!scroller) {
              return false;
            }
            const viewport = scroller.getBoundingClientRect();
            return containers.some((container) => {
              const text = container.shadowRoot?.textContent ?? "";
              const rect = container.getBoundingClientRect();
              return (
                text.includes("rootSpecial = 1") &&
                text.includes("rootSpecial = 2") &&
                rect.bottom > viewport.top &&
                rect.top < viewport.bottom
              );
            });
          }),
        { timeout: 30_000 }
      )
      .toBe(true);
  } finally {
    await application.close().catch(() => undefined);
    await forceClose(child);
    rmSync(userDataDir, { force: true, recursive: true });
    rmSync(repository, { force: true, recursive: true });
  }
});
