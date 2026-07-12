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
import { selectTheme, setWindowSize } from "./mission-control-e2e-harness.ts";

const PROJECT_ROOT = join(import.meta.dirname, "..", "..");
const OUT_MAIN = join(PROJECT_ROOT, "out", "main", "index.js");
const PIER_CLI = join(PROJECT_ROOT, "bin", "pier.mjs");
const execFileAsync = promisify(execFile);

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

test("uses available file-tree width and shares the sidebar search surface", async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(60_000);
  const userDataDir = mkdtempSync(join(tmpdir(), "pier-file-tree-layout-e2e-"));
  const workspaceDir = mkdtempSync(join(tmpdir(), "pier-file-tree-workspace-"));
  const rulesDir = join(workspaceDir, ".eslint-rules");
  mkdirSync(rulesDir);
  writeFileSync(
    join(rulesDir, "no-direct-dockview-imports.js"),
    "export {};\n"
  );
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
      name: "no-direct-dockview-imports.js",
    });
    await expect(rule).toBeVisible();
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
