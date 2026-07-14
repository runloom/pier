import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  test,
} from "@playwright/test";
import { selectTheme, setWindowSize } from "./workbench-e2e-harness.ts";

const PROJECT_ROOT = join(import.meta.dirname, "..", "..");
const OUT_MAIN = join(PROJECT_ROOT, "out", "main", "index.js");
const PIER_CLI = join(PROJECT_ROOT, "bin", "pier.mjs");
const execFileAsync = promisify(execFile);
const RULE_FILE_NAME =
  "no-direct-dockview-imports-with-an-intentionally-long-name-for-breadcrumb-overflow.js";

async function forceClose(application: ElectronApplication): Promise<void> {
  const child = application.process();
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

test("uses available file-tree width and shares file icons and the sidebar search surface", async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(60_000);
  const userDataDir = mkdtempSync(join(tmpdir(), "pier-file-tree-layout-e2e-"));
  const workspaceDir = mkdtempSync(join(tmpdir(), "pier-file-tree-workspace-"));
  const rulesDir = join(workspaceDir, ".eslint-rules");
  mkdirSync(rulesDir);
  writeFileSync(join(rulesDir, RULE_FILE_NAME), "export {};\n");
  writeFileSync(join(workspaceDir, "dirty.txt"), "clean\n");
  execFileSync("git", ["init"], { cwd: workspaceDir });
  execFileSync("git", ["config", "user.email", "pier@example.test"], {
    cwd: workspaceDir,
  });
  execFileSync("git", ["config", "user.name", "Pier Test"], {
    cwd: workspaceDir,
  });
  execFileSync("git", ["add", "."], { cwd: workspaceDir });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: workspaceDir });
  writeFileSync(join(workspaceDir, "dirty.txt"), "modified\n");
  const application = await electron.launch({
    args: [OUT_MAIN],
    cwd: PROJECT_ROOT,
    env: { ...process.env, ELECTRON_USER_DATA_DIR: userDataDir },
  });

  try {
    const page = await application.firstWindow();
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).toMatch(/^file:/u);
    await expect(page).toHaveTitle(/Pier/u);
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    await page
      .locator(
        '[data-testid="workspace-host-root"][data-workspace-ready="true"]'
      )
      .waitFor({ state: "visible", timeout: 30_000 });
    await selectTheme(page, { id: "dark", label: /Dark|深色/u });
    await setWindowSize(application, page, 1400, 800);

    await expect
      .poll(
        async () => {
          const { stdout } = await execFileAsync(
            process.execPath,
            [PIER_CLI, "terminal", "open", "--cwd", workspaceDir, "--json"],
            {
              cwd: PROJECT_ROOT,
              env: { ...process.env, PIER_USER_DATA_DIR: userDataDir },
            }
          );
          return (JSON.parse(stdout) as { ok?: boolean }).ok === true;
        },
        { timeout: 20_000 }
      )
      .toBe(true);

    await page.locator('[data-testid="files-project-status-trigger"]').click();
    const dirty = page.getByRole("treeitem", { name: /dirty\.txt/u });
    await expect(dirty).toHaveAttribute("data-item-git-status", "modified", {
      timeout: 20_000,
    });
    await page.getByRole("treeitem", { name: ".eslint-rules" }).click();
    const rule = page.getByRole("treeitem", {
      name: RULE_FILE_NAME,
    });
    await expect(rule).toBeVisible();
    const treeFileIcon = rule.locator(
      '[data-item-section="icon"] svg[data-icon-token="javascript"]'
    );
    await expect(treeFileIcon).toBeVisible();
    const treeFileIconPresentation = {
      color: await treeFileIcon.evaluate(
        (element) => getComputedStyle(element).color
      ),
      href: await treeFileIcon.locator("use").getAttribute("href"),
      token: await treeFileIcon.getAttribute("data-icon-token"),
    };
    await rule.click();
    const tabFileIcon = page.locator(
      `[data-panel-tab-icon="pier.file:${RULE_FILE_NAME}"]`
    );
    await expect(tabFileIcon).toBeVisible();
    const tabFileIconPresentation = {
      color: await tabFileIcon.evaluate(
        (element) => getComputedStyle(element).color
      ),
      href: await tabFileIcon.locator("use").getAttribute("href"),
      token: await tabFileIcon.getAttribute("data-icon-token"),
    };
    expect(tabFileIconPresentation).toEqual(treeFileIconPresentation);
    const fileChrome = page
      .getByRole("button", { name: /Find in tree|在树中查找/u })
      .locator("xpath=ancestor::header");
    const fileChromeCenter = fileChrome.locator(":scope > div").nth(1);
    await expect(fileChromeCenter).toBeVisible();
    expect(
      await fileChromeCenter.evaluate(
        (element) => getComputedStyle(element).overflowX
      )
    ).toBe("hidden");
    const fileTabId = await tabFileIcon.evaluate((element) =>
      element.closest("[data-panel-tab-id]")?.getAttribute("data-panel-tab-id")
    );
    expect(fileTabId).toBeTruthy();
    const fileTab = page.locator(`[data-panel-tab-id="${fileTabId}"]`);
    await setWindowSize(application, page, 720, 800);
    const narrowBreadcrumbLayout = await fileChromeCenter.evaluate((center) => {
      const breadcrumb = center.firstElementChild;
      if (!(breadcrumb instanceof HTMLElement)) {
        throw new Error("file breadcrumb missing");
      }
      const centerRect = center.getBoundingClientRect();
      const segments = [
        ...center.querySelectorAll<HTMLElement>("button[title]"),
      ];
      const segmentRects = segments.map((segment) =>
        segment.getBoundingClientRect()
      );
      const lastRect = segmentRects.at(-1);
      return {
        lastSegmentVisible:
          lastRect !== undefined &&
          lastRect.left < centerRect.right &&
          lastRect.right <= centerRect.right + 0.5,
        overflowX: getComputedStyle(breadcrumb).overflowX,
        segmentsDoNotOverlap: segmentRects.every(
          (rect, index) =>
            index === segmentRects.length - 1 ||
            rect.right <= (segmentRects[index + 1]?.left ?? rect.right) + 0.5
        ),
      };
    });
    expect(narrowBreadcrumbLayout).toEqual({
      lastSegmentVisible: true,
      overflowX: "auto",
      segmentsDoNotOverlap: true,
    });

    const filesGroupView = page.locator('[data-slot="pier.files.groupView"]');
    const existingTerminalTab = page
      .locator('[data-panel-tab-id^="terminal-"]')
      .first();
    await expect(existingTerminalTab).toBeVisible();
    await existingTerminalTab.click();
    expect(
      await filesGroupView.evaluate(
        (element) => getComputedStyle(element).display
      )
    ).toBe("none");
    await fileTab.click();
    await expect(fileChrome).toBeVisible();

    await page.keyboard.down("Meta");
    await expect(tabFileIcon).toBeHidden();
    await expect(fileTab.locator("[data-panel-tab-index-hint]")).toContainText(
      "⌘"
    );
    await page.keyboard.up("Meta");
    await expect(tabFileIcon).toBeVisible();
    await fileTab.dblclick();
    await dirty.click();
    await selectTheme(page, { id: "light", label: /Light|浅色/u });
    await expect
      .poll(async () => ({
        tab: await tabFileIcon.evaluate(
          (element) => getComputedStyle(element).color
        ),
        tree: await treeFileIcon.evaluate(
          (element) => getComputedStyle(element).color
        ),
      }))
      .toEqual({
        tab: "rgb(213, 169, 16)",
        tree: "rgb(213, 169, 16)",
      });
    await selectTheme(page, { id: "dark", label: /Dark|深色/u });
    const layout = await rule.evaluate((element) => {
      const content = element.querySelector<HTMLElement>(
        '[data-item-section="content"]'
      );
      const decoration = element.querySelector<HTMLElement>(
        '[data-item-section="decoration"]'
      );
      const git = element.querySelector<HTMLElement>(
        '[data-item-section="git"]'
      );
      const rowRect = element.getBoundingClientRect();
      const contentRect = content?.getBoundingClientRect();
      return {
        contentFlexGrow: content ? getComputedStyle(content).flexGrow : null,
        decorationWidth: decoration?.getBoundingClientRect().width ?? null,
        gitWidth: git?.getBoundingClientRect().width ?? null,
        unusedRightSpace:
          contentRect === undefined ? null : rowRect.right - contentRect.right,
      };
    });

    await page
      .getByRole("button", { name: /Find in tree|在树中查找/u })
      .click();
    const search = page.getByTestId("files-tree-search-bar");
    await expect(search).toBeVisible();
    const treeList = page.locator(
      'file-tree-container[data-slot="pier-file-tree"] [data-file-tree-virtualized-list="true"]'
    );
    const surfaces = {
      search: await search.evaluate(
        (element) => getComputedStyle(element).backgroundColor
      ),
      tree: await treeList.evaluate(
        (element) => getComputedStyle(element).backgroundColor
      ),
    };

    expect(layout.contentFlexGrow).toBe("1");
    expect(layout.decorationWidth).toBe(0);
    expect(layout.gitWidth).toBe(0);
    expect(layout.unusedRightSpace).not.toBeNull();
    expect(layout.unusedRightSpace ?? Number.POSITIVE_INFINITY).toBeLessThan(
      12
    );
    expect(surfaces.search).toBe(surfaces.tree);
    expect(consoleErrors).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("files-tree-width-and-search-surface.png"),
    });
  } finally {
    await forceClose(application);
    rmSync(userDataDir, { force: true, recursive: true });
    rmSync(workspaceDir, { force: true, recursive: true });
  }
});
