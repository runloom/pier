import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { closeApp, launchApp, setWindowSize } from "../support/app-harness.ts";

const PROJECT_ROOT = join(import.meta.dirname, "..", "..", "..");
const PIER_CLI = join(PROJECT_ROOT, "bin", "pier.mjs");
const execFileAsync = promisify(execFile);

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "pier-review-scrollbar-"));
  const git = (args: string[]) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git(["init", "-q"]);
  git(["config", "user.email", "e2e@pier.local"]);
  git(["config", "user.name", "Pier E2E"]);
  for (let index = 0; index < 88; index += 1) {
    writeFileSync(join(root, `file-${index}.ts`), "export const value = 0;\n");
  }
  git(["add", "--all"]);
  git(["commit", "-q", "-m", "fixture"]);
  for (let index = 0; index < 80; index += 1) {
    writeFileSync(join(root, `file-${index}.ts`), "export const value = 1;\n");
  }
  git(["add", "--all"]);
  for (let index = 80; index < 88; index += 1) {
    writeFileSync(join(root, `file-${index}.ts`), "export const value = 2;\n");
  }
  return root;
}

test("scrollbar dragging after switching Changes does not resize the review tree", async () => {
  test.setTimeout(90_000);
  const repository = createRepository();
  const context = await launchApp();
  const { app, userDataDir, win: page } = context;
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await setWindowSize(app, page, 1200, 800);
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
    }).toPass({ timeout: 20_000 });
    await page.getByTestId("git-changes-status-trigger").click();

    const switcher = page.getByTestId("git-review-surface-switcher");
    const staged = switcher.getByRole("tab", {
      name: /^(?:Staged Changes|已暂存更改)$/u,
    });
    const changes = switcher.getByRole("tab", {
      name: /^(?:Unstaged Changes|Changes|更改)$/u,
    });
    const scroller = page.locator('[data-file-tree-virtualized-scroll="true"]');
    const handle = page.locator(
      '[data-slot="file-panel-layout"] [data-slot="resizable-handle"]'
    );
    await staged.click();
    await changes.click();
    // Switching the diff reveals Changes below the long staged group.
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(500);

    const before = await scroller.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: element.scrollTop,
        width: rect.width,
        x: rect.right - 3,
        y:
          rect.top +
          ((element.scrollTop + element.clientHeight / 2) /
            element.scrollHeight) *
            element.clientHeight,
      };
    });
    await page.mouse.move(before.x, before.y);
    await page.mouse.down();
    try {
      // The separator used to capture this point inside the native scrollbar.
      await expect(handle).not.toHaveAttribute("data-separator", "active");
      await page.mouse.move(before.x + 2, before.y - 120, { steps: 12 });
      expect(
        await scroller.evaluate(
          (element) => element.getBoundingClientRect().width
        )
      ).toBeCloseTo(before.width, 0);
    } finally {
      await page.mouse.up();
    }
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollTop))
      .toBeLessThan(before.top - 200);

    // The dedicated divider still supports intentional resizing.
    const divider = await handle.boundingBox();
    if (!divider) {
      throw new Error("Expected the review sidebar divider");
    }
    const dividerX = divider.x + divider.width / 2;
    const dividerY = divider.y + 100;
    await page.mouse.move(dividerX, dividerY);
    await page.mouse.down();
    try {
      await expect(handle).toHaveAttribute("data-separator", "active");
      await page.mouse.move(dividerX + 40, dividerY, { steps: 10 });
    } finally {
      await page.mouse.up();
    }
    await expect
      .poll(() =>
        scroller.evaluate((element) => element.getBoundingClientRect().width)
      )
      .toBeCloseTo(before.width + 40, 0);

    await staged.click();
    await changes.click();
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(500);
    const beforeWheel = await scroller.evaluate((element) => element.scrollTop);
    await scroller.hover();
    await page.mouse.wheel(0, -300);
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollTop))
      .toBeLessThan(beforeWheel - 200);

    // Status refreshes during wheel input must not pull the viewport back.
    for (let round = 0; round < 3; round += 1) {
      await staged.click();
      await changes.click();
      await expect
        .poll(() => scroller.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(500);
      await scroller.hover();
      for (let step = 0; step < 5; step += 1) {
        const top = await scroller.evaluate((element) => element.scrollTop);
        writeFileSync(
          join(repository, "file-80.ts"),
          `export const value = ${round * 5 + step + 3};\n`
        );
        await page.mouse.wheel(0, -100);
        await expect
          .poll(() => scroller.evaluate((element) => element.scrollTop))
          .toBeLessThan(top - 80);
      }
    }

    await page
      .getByRole("button", { name: /Find in changed files|在变更文件中查找/u })
      .click();
    const search = page.getByTestId("git-review-tree-search-bar");
    const input = search.getByRole("textbox");
    await input.fill("file-80.ts");
    await expect(
      page.getByRole("treeitem", { name: /file-80\.ts/u })
    ).toBeVisible();
    await input.press("Enter");
    await expect(input).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(search).toHaveCount(0);

    await page
      .getByRole("button", { name: /Hide changed files|隐藏目录树/u })
      .click();
    await expect(scroller).toHaveCount(0);
    await page
      .getByRole("button", { name: /Show changed files|显示目录树/u })
      .click();
    await expect(scroller).toBeVisible();
    await expect
      .poll(() =>
        scroller.evaluate((element) => element.getBoundingClientRect().width)
      )
      .toBeCloseTo(before.width + 40, 0);
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await closeApp(context);
    rmSync(repository, { recursive: true, force: true });
  }
});
