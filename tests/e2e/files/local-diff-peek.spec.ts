import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { selectTheme, setWindowSize } from "../support/app-harness.ts";
import { expectRenderedLocalDiff } from "../support/rendered-diff.ts";

const ROOT = join(import.meta.dirname, "../../..");
const run = promisify(execFile);

async function expectExcerptWidth(page: Page) {
  const excerpt = page.locator('[data-slot="pier-diff-excerpt"]');
  await expect
    .poll(async () => {
      const right = await excerpt.evaluate((element) => {
        const scroll = element.firstElementChild as HTMLElement;
        return (
          scroll.getBoundingClientRect().left +
          scroll.clientLeft +
          scroll.clientWidth
        );
      });
      const content = await excerpt
        .locator("[data-content]")
        .first()
        .boundingBox();
      return content ? Math.abs(right - content.x - content.width) : 999;
    })
    .toBeLessThanOrEqual(1);
}

async function expectSourceClearance(page: Page, inset = 16) {
  await expect
    .poll(() =>
      page.locator('[data-slot="file-change-peek"]').evaluate((peek) => {
        const scroll = peek.closest(".cm-scroller") as HTMLElement;
        const minimap = scroll.querySelector(".cm-minimap-gutter");
        const content = scroll.querySelector(".cm-content") as HTMLElement;
        const gutters = scroll.querySelector(
          ":scope > .cm-gutters:not(.cm-minimap-gutter)"
        );
        const box = peek.getBoundingClientRect();
        const edge = Math.min(
          scroll.getBoundingClientRect().left + scroll.clientWidth,
          minimap?.getBoundingClientRect().left ?? Number.POSITIVE_INFINITY
        );
        const inset = Number.parseFloat(
          getComputedStyle(content).getPropertyValue("--files-editor-end-inset")
        );
        return {
          gap: Math.round(edge - box.right),
          inset,
          visible: box.left >= (gutters?.getBoundingClientRect().right ?? 0),
        };
      })
    )
    .toEqual({ gap: inset, inset, visible: true });
}

async function expectNaturalExcerptHeight(page: Page) {
  await expectExcerptWidth(page);
  const excerpt = page.locator('[data-slot="pier-diff-excerpt"]');
  await expect
    .poll(async () => {
      const box = await excerpt.boundingBox();
      const lastLine = await excerpt
        .locator("[data-line]")
        .last()
        .boundingBox();
      return box && lastLine
        ? Math.round(box.y + box.height - lastLine.y - lastLine.height)
        : -1;
    })
    .toBeGreaterThanOrEqual(0);
  await expect
    .poll(async () => {
      const box = await excerpt.boundingBox();
      const lastLine = await excerpt
        .locator("[data-line]")
        .last()
        .boundingBox();
      return box && lastLine
        ? Math.round(box.y + box.height - lastLine.y - lastLine.height)
        : 999;
    })
    .toBeLessThanOrEqual(10);
  const sourceLineHeight = await page
    .locator(".cm-line:visible")
    .first()
    .evaluate((line) => getComputedStyle(line).lineHeight);
  await expect(excerpt.locator("[data-line]").first()).toHaveCSS(
    "line-height",
    sourceLineHeight
  );
}

test("previews HEAD/current changes locally in source and Markdown without moving the editor selection", async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(120_000);
  const userDataDir = mkdtempSync(join(tmpdir(), "pier-peek-data-"));
  const workspace = mkdtempSync(join(tmpdir(), "pier-peek-worktree-"));
  const base = [
    "# Local preview",
    "",
    "Before text",
    "",
    "## Second section",
    "",
    "Another old paragraph",
    "",
    "End.",
    "",
  ].join("\n");
  writeFileSync(join(workspace, "peek.md"), base);
  const additionBase = [
    "# Files 编辑器：局部修改预览",
    "",
    "**日期**：2026-09-05",
    "",
    "## 阅读与编辑",
    "",
    "在正文旁查看修改，再继续当前工作。",
    "",
  ].join("\n");
  writeFileSync(join(workspace, "addition.md"), additionBase);
  writeFileSync(join(workspace, "large.txt"), "Large change\n");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: workspace });
  git("init");
  git("config", "user.email", "pier@example.test");
  git("config", "user.name", "Pier Test");
  git("add", ".");
  git("commit", "-m", "fixture");
  writeFileSync(
    join(workspace, "addition.md"),
    `> 历史方案：点击直接打开完整审查已由 [2026-09-05 局部预览规格](../../../superpowers/specs/2026-09-05-files-local-diff-peek-design.md) 替代。本文保留当时的取舍记录。\n\n${additionBase}`
  );
  writeFileSync(
    join(workspace, "large.txt"),
    `Large change\n${Array.from({ length: 100 }, (_, index) => `Added row ${index + 1}`).join("\n")}\n`
  );
  writeFileSync(
    join(workspace, "peek.md"),
    base
      .replace("Before text", "Current text")
      .replace("Another old paragraph", "Another current paragraph")
  );
  const app = await electron.launch({
    args: [join(ROOT, "out/main/index.js")],
    cwd: ROOT,
    env: { ...process.env, ELECTRON_USER_DATA_DIR: userDataDir },
    timeout: 30_000,
  });
  try {
    const page = await app.firstWindow();
    console.info("local peek: Electron launched");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page
      .locator(
        '[data-testid="workspace-host-root"][data-workspace-ready="true"]'
      )
      .waitFor({ timeout: 30_000 });
    console.info("local peek: workspace ready");
    await selectTheme(page, { id: "dark", label: /Dark|深色/u });
    await setWindowSize(app, page, 1100, 760);
    const result = await run(
      process.execPath,
      [
        join(ROOT, "bin/pier.mjs"),
        "terminal",
        "open",
        "--cwd",
        workspace,
        "--json",
      ],
      {
        cwd: ROOT,
        env: { ...process.env, PIER_USER_DATA_DIR: userDataDir },
        timeout: 20_000,
      }
    );
    expect(JSON.parse(result.stdout).ok).toBe(true);
    console.info("local peek: fixture workspace opened");
    await page.locator('[data-testid="files-project-status-trigger"]').click();
    await page.getByRole("treeitem", { name: "peek.md" }).click();
    const toSource = page.getByRole("button", {
      name: /Switch to source|切换到源码/u,
    });
    if (await toSource.isVisible()) await toSource.click();
    const editor = page.getByRole("textbox", {
      name: /Source editor|源码编辑器/u,
    });
    await expect(editor).toBeVisible();
    const marker = page.locator(".cm-gitRow-modified").first();
    await expect(marker).toBeVisible({ timeout: 20_000 });
    console.info("local peek: source markers ready");
    await editor.click();
    await page.keyboard.press("ArrowRight");
    const selection = await page.evaluate(() => ({
      anchor: window.getSelection()?.anchorOffset,
      focus: window.getSelection()?.focusOffset,
      text: window.getSelection()?.anchorNode?.textContent,
    }));
    await marker.click();
    const peek = page.locator('[data-slot="file-change-peek"]');
    await expect(peek).toBeVisible();
    await expect(
      peek.getByRole("button", { name: /Close preview|关闭预览/u })
    ).toBeInViewport();
    await expect(peek.locator('[data-slot="pier-diff-excerpt"]')).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      peek.locator("[data-line]").filter({ hasText: "Before text" }).first()
    ).toBeVisible({ timeout: 20_000 });
    expect(
      await page.evaluate(() => ({
        anchor: window.getSelection()?.anchorOffset,
        focus: window.getSelection()?.focusOffset,
        text: window.getSelection()?.anchorNode?.textContent,
      }))
    ).toEqual(selection);
    await expect(editor).toBeVisible();
    await expectSourceClearance(page);
    await expectNaturalExcerptHeight(page);
    await expect
      .poll(async () => {
        const line = await page
          .locator(".cm-line:visible")
          .filter({ hasText: "## Second section" })
          .boundingBox();
        const number = await page
          .locator(".cm-lineNumbers .cm-gutterElement:visible")
          .filter({ hasText: /^5$/u })
          .boundingBox();
        return line && number ? Math.abs(line.y - number.y) : 999;
      })
      .toBeLessThan(2);
    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath("source-local-peek.png"),
    });
    await page.evaluate(() =>
      window.pier.pluginSettings.set("pier.files.editor.minimap", false)
    );
    await expect(page.locator(".cm-minimap-gutter")).toHaveCount(0);
    await expectSourceClearance(page);
    await page.evaluate(() =>
      window.pier.pluginSettings.set("pier.files.editor.minimap", true)
    );
    await expect(page.locator(".cm-minimap-gutter")).toBeVisible();
    await expectSourceClearance(page);
    await page.evaluate(() =>
      window.pier.preferences.update({ codeFontSize: 17 })
    );
    await expect(page.locator(".cm-line:visible").first()).toHaveCSS(
      "font-size",
      "17px"
    );
    await expectNaturalExcerptHeight(page);
    await page.evaluate(() =>
      window.pier.preferences.update({ codeFontSize: 13 })
    );
    await expect(page.locator(".cm-line:visible").first()).toHaveCSS(
      "font-size",
      "13px"
    );
    await expectNaturalExcerptHeight(page);
    await marker.click();
    await expect(peek).toHaveCount(0);
    await editor.focus();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.press("Alt+F5");
    await expect(peek).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(peek).toHaveCount(0);
    await page.keyboard.press("Meta+Shift+P");
    await expect(page.locator("[cmdk-input]")).toBeVisible();
    await page
      .locator("[cmdk-item]")
      .filter({ hasText: /查看修改|View changes/u })
      .first()
      .click();
    await expect(peek).toBeVisible();
    await expect
      .poll(() =>
        peek.evaluate((element) => element.contains(document.activeElement))
      )
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(peek).toHaveCount(0);
    await expect(editor).toBeFocused();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("\nUnsaved content");
    await page.locator("[data-file-changes-trigger]").click();
    await expect(peek).toContainText(/Unsaved|未保存/u);
    await expect(peek).toHaveAccessibleDescription(
      /includes unsaved edits|包含未保存修改/u
    );
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: /Switch to preview|切换到预览/u })
      .click();
    await expect(page.locator('[data-slot="markdown-prose"]')).toBeVisible({
      timeout: 20_000,
    });
    const bar = page
      .locator(
        '[data-slot="markdown-preview-git-bars"] [data-git-bar-kind="modified"]'
      )
      .first();
    await expect(bar).toBeVisible({ timeout: 20_000 });
    await bar.click();
    await expect(peek).toBeVisible();
    await expectRenderedLocalDiff(peek);
    const box = await peek.boundingBox();
    const boundary = await page
      .locator('[data-slot="file-changes-surface"]')
      .boundingBox();
    expect(
      box &&
        boundary &&
        box.x >= boundary.x &&
        box.x + box.width <= boundary.x + boundary.width + 1
    ).toBe(true);
    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath("markdown-local-peek.png"),
    });
    await page.keyboard.press("Escape");
    await expect(peek).toHaveCount(0);
    await page.keyboard.press("Meta+Shift+P");
    await expect(page.locator("[cmdk-input]")).toBeVisible();
    await page
      .locator("[cmdk-item]")
      .filter({ hasText: /查看修改|View changes/u })
      .first()
      .click();
    await expect(peek).toBeVisible();
    await expect
      .poll(() =>
        peek.evaluate((element) => element.contains(document.activeElement))
      )
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(peek).toHaveCount(0);
    await selectTheme(page, { id: "light", label: /Light|浅色/u });
    await setWindowSize(app, page, 720, 600);
    await bar.click();
    await expect(peek).toBeVisible();
    await expectRenderedLocalDiff(peek);
    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath("markdown-local-peek-light-narrow.png"),
    });
    await page.keyboard.press("Escape");
    await page.getByRole("treeitem", { name: "addition.md" }).click();
    if (await toSource.isVisible()) await toSource.click();
    await expect(editor).toBeVisible();
    await setWindowSize(app, page, 1100, 760);
    const added = page.locator(".cm-gitRow-added:visible").first();
    await added.click();
    await expectSourceClearance(page);
    await expectNaturalExcerptHeight(page);
    await expect(
      peek.getByRole("button", { name: /Next change|下一处修改/u })
    ).toHaveCount(0);
    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath("source-added-light.png"),
    });
    const scroller = page.locator(".cm-scroller:visible");
    await scroller.evaluate((element) => {
      element.scrollLeft = 400;
    });
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(100);
    await expectSourceClearance(page);
    await expectNaturalExcerptHeight(page);
    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath("source-horizontal-scroll.png"),
    });
    await setWindowSize(app, page, 720, 600);
    await expectSourceClearance(page, 12);
    const narrowExcerpt = peek.locator('[data-slot="pier-diff-excerpt"]');
    await expect
      .poll(() =>
        narrowExcerpt.evaluate((element) => {
          const scroll = element.firstElementChild as HTMLElement;
          return {
            capped:
              Math.abs(
                element.getBoundingClientRect().height -
                  Number.parseFloat(getComputedStyle(element).maxHeight)
              ) < 1,
            scrolls: scroll.scrollHeight > scroll.clientHeight,
            overflow: getComputedStyle(scroll).overflowY,
          };
        })
      )
      .toEqual({ capped: true, scrolls: true, overflow: "auto" });
    await narrowExcerpt.evaluate((element) => {
      const scroll = element.firstElementChild as HTMLElement;
      scroll.scrollTop = scroll.scrollHeight;
    });
    await expect(
      narrowExcerpt.locator("[data-line]").filter({ hasText: "**日期**" })
    ).toBeInViewport({ ratio: 0.99 });
    await expectExcerptWidth(page);
    await narrowExcerpt.evaluate((element) => {
      (element.firstElementChild as HTMLElement).scrollTop = 0;
    });
    await scroller.evaluate((element) => {
      element.scrollLeft = 0;
    });
    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath("source-added-light-narrow.png"),
    });
    await page.keyboard.press("Escape");
    await page.getByRole("treeitem", { name: "large.txt" }).click();
    await page.locator(".cm-gitRow-added:visible").first().click();
    await expect(peek).toBeVisible();
    const excerpt = peek.locator('[data-slot="pier-diff-excerpt"]');
    await expect(
      excerpt.locator("[data-line]").filter({ hasText: /^Added row 1$/u })
    ).toBeVisible();
    const scrollHeight = await excerpt.evaluate((element) => {
      const scroll = element.firstElementChild as HTMLElement;
      return { client: scroll.clientHeight, total: scroll.scrollHeight };
    });
    expect(scrollHeight.total).toBeGreaterThan(scrollHeight.client * 2);
    const outerScrollTop = await scroller.evaluate(
      (element) => element.scrollTop
    );
    await excerpt.hover();
    await page.mouse.wheel(0, 10_000);
    await expect(
      excerpt.locator("[data-line]").filter({ hasText: "Added row 100" })
    ).toBeInViewport({ ratio: 0.99 });
    expect(await scroller.evaluate((element) => element.scrollTop)).toBe(
      outerScrollTop
    );
    await expectExcerptWidth(page);
    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath("source-large-change.png"),
    });
    expect(
      errors.filter((message) =>
        /CodeMirror|CodeView|FileDiff|Worker|update.*progress|Maximum update/u.test(
          message
        )
      )
    ).toEqual([]);
  } finally {
    await app
      .windows()[0]
      ?.screenshot({ path: testInfo.outputPath("last-state.png") })
      .catch(() => undefined);
    app.process().kill("SIGKILL");
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});
