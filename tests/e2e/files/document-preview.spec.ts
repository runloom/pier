import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
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
import { selectTheme, setWindowSize } from "../support/app-harness.ts";
import {
  writeMinimalDocx,
  writeMinimalPdf,
  writeMinimalXlsx,
  writeUnsupportedFixtures,
} from "./document-preview-fixtures.ts";

const PROJECT_ROOT = join(import.meta.dirname, "..", "..", "..");
const OUT_MAIN = join(PROJECT_ROOT, "out", "main", "index.js");
const PIER_CLI = join(PROJECT_ROOT, "bin", "pier.mjs");
const execFileAsync = promisify(execFile);
const EXPECTED_CONSOLE_ERROR = /Refused to load|example\.com|ERR_FAILED/u;

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

const HIDE_TREE_LABEL =
  /Hide file tree|隐藏目录树|ファイルツリーを隠す|파일 트리 숨기기/u;
const SHOW_TREE_LABEL =
  /Show file tree|显示目录树|ファイルツリーを表示|파일 트리 표시/u;

/** The sidebar auto-collapses when the window narrows; reopen it to pick files. */
async function showFileTree(page: Page): Promise<void> {
  const expand = page.getByRole("button", { name: SHOW_TREE_LABEL });
  if ((await expand.count()) > 0) {
    await expand.first().click();
  }
  await expect(page.getByRole("tree").first()).toBeVisible();
}

async function hideFileTree(page: Page): Promise<void> {
  await page.getByRole("button", { name: HIDE_TREE_LABEL }).first().click();
  await expect(
    page.getByRole("button", { name: SHOW_TREE_LABEL }).first()
  ).toBeVisible();
}

/**
 * Open or focus a file from the Files tree. Clipped dockview tabs drop out of
 * the accessibility tree at narrow widths, so the tree is the reliable entry.
 */
async function openFromTree(page: Page, fileName: string): Promise<void> {
  await page
    .getByRole("tree")
    .getByText(fileName, { exact: true })
    .first()
    .click();
}

test("previews PDF, DOCX and XLSX read-only and falls back for unsupported documents", async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(120_000);
  const userDataDir = mkdtempSync(join(tmpdir(), "pier-doc-preview-e2e-"));
  const workspaceDir = mkdtempSync(join(tmpdir(), "pier-doc-workspace-"));
  writeMinimalPdf(workspaceDir);
  await writeMinimalDocx(workspaceDir);
  writeMinimalXlsx(workspaceDir);
  writeUnsupportedFixtures(workspaceDir);
  // Dev-mode assets resolve from `<cwd>/node_modules/pdfjs-dist` and
  // `<cwd>/resources`. The app launches with the fixture workspace as cwd so
  // its initial worktree is the fixture; symlink the shared assets so CMaps,
  // standard fonts and bundled UI fonts resolve instead of 404ing.
  mkdirSync(join(workspaceDir, "node_modules"), { recursive: true });
  symlinkSync(
    join(PROJECT_ROOT, "node_modules", "pdfjs-dist"),
    join(workspaceDir, "node_modules", "pdfjs-dist"),
    "dir"
  );
  symlinkSync(
    join(PROJECT_ROOT, "resources"),
    join(workspaceDir, "resources"),
    "dir"
  );

  const application = await electron.launch({
    args: [OUT_MAIN],
    cwd: workspaceDir,
    env: { ...process.env, ELECTRON_USER_DATA_DIR: userDataDir },
  });

  try {
    const page = await application.firstWindow();
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(`${message.text()} [${message.location().url}]`);
      }
    });
    await page.waitForLoadState("domcontentloaded");
    await page
      .locator(
        '[data-testid="workspace-host-root"][data-workspace-ready="true"]'
      )
      .waitFor({ state: "visible", timeout: 30_000 });
    await selectTheme(page, { id: "dark", label: /Dark|深色/u });
    await setWindowSize(application, page, 1000, 700);

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

    // PDF: page renders, text layer is selectable, zoom changes canvas width.
    await page.getByText("report.pdf", { exact: true }).first().click();
    await expect(
      page.locator('[data-slot="document-preview-pdf"]')
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.locator('[data-slot="document-preview-pdf"] .textLayer')
    ).toContainText("Pier PDF preview");
    await expect(page.getByText("1 / 1")).toBeVisible();
    const canvas = page.locator('[data-slot="document-preview-pdf-canvas"]');
    // The page width must follow the scroll viewport, not its own canvas:
    // observing the shrink-wrapped canvas feeds the rendered width back into
    // the fit scale and compounds each zoom step.
    const settledCanvasWidth = async (): Promise<number> => {
      let previous = -1;
      let stableSamples = 0;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const width = (await canvas.boundingBox())?.width ?? 0;
        if (Math.abs(width - previous) < 0.5) {
          stableSamples += 1;
          if (stableSamples >= 3) {
            return width;
          }
        } else {
          stableSamples = 0;
        }
        previous = width;
        await page.waitForTimeout(100);
      }
      return previous;
    };
    const beforeZoomWidth = await settledCanvasWidth();
    await page.getByRole("button", { name: /Zoom in|放大/u }).click();
    const afterZoomWidth = await settledCanvasWidth();
    const bodyBox = await page
      .locator('[data-slot="document-preview-body"]')
      .boundingBox();
    expect(afterZoomWidth).toBeGreaterThan(beforeZoomWidth);
    // One zoom step is 1.25x. A feedback loop jumps to the 3x fit cap and
    // would land far above this ratio.
    expect(afterZoomWidth / beforeZoomWidth).toBeLessThan(1.4);
    // Fit width must return the page to the viewport instead of pinning the
    // compounded fit scale.
    await page.getByRole("button", { name: /Fit width|适合宽度/u }).click();
    const fittedWidth = await settledCanvasWidth();
    expect(fittedWidth).toBeLessThanOrEqual((bodyBox?.width ?? 0) + 1);
    await page.screenshot({
      path: testInfo.outputPath("document-preview-pdf.png"),
    });

    // DOCX: body text is readable and external images never load.
    await page.getByText("notes.docx", { exact: true }).first().click();
    await expect(page.getByText("Pier DOCX preview")).toBeVisible({
      timeout: 30_000,
    });
    // Embedded images render through data: URLs; the declared external image
    // relationship is never prefetched and no remote src reaches the DOM.
    await expect(
      page.locator(
        '[data-slot="document-preview-docx"] img[src^="data:image/"]'
      )
    ).toHaveCount(1);
    await expect(
      page.locator('[data-slot="document-preview-docx"] img[src^="http"]')
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("document-preview-docx.png"),
    });

    // XLSX: grid renders, sheet tabs switch worksheets.
    await page.getByText("data.xlsx", { exact: true }).first().click();
    const grid = page.locator('[role="grid"]');
    await expect(grid).toBeVisible({ timeout: 30_000 });
    await expect(grid).toContainText("Alice");
    // The grid is flush with the panel body and columns scale to the panel
    // width like the CSV preview instead of staying at a narrow fixed width.
    const gridGeometry = await page.evaluate(() => {
      const gridElement = document.querySelector('[role="grid"]');
      const bodyElement = document.querySelector(
        '[data-slot="document-preview-body"]'
      );
      if (!(gridElement && bodyElement)) {
        throw new Error("XLSX grid is missing");
      }
      const headers = gridElement.querySelectorAll('[role="columnheader"]');
      return {
        bodyLeft: bodyElement.getBoundingClientRect().left,
        firstDataWidth: headers[1]?.getBoundingClientRect().width ?? 0,
        gridLeft: gridElement.getBoundingClientRect().left,
      };
    });
    expect(gridGeometry.gridLeft).toBeCloseTo(gridGeometry.bodyLeft, 0);
    expect(gridGeometry.firstDataWidth).toBeGreaterThan(250);
    const sheetTabGeometry = await page.evaluate(() => {
      const activeTab = [
        ...document.querySelectorAll('[data-slot="tabs-trigger"]'),
      ].find((tab) => tab.getAttribute("aria-selected") === "true");
      if (!activeTab) {
        throw new Error("XLSX active sheet tab is missing");
      }
      const after = getComputedStyle(activeTab, "::after");
      const list = activeTab.closest('[data-slot="tabs-list"]');
      const bar = activeTab.closest(
        '[data-slot="document-preview-sheet-tabs"]'
      );
      const listStyle = list ? getComputedStyle(list) : null;
      const barStyle = bar ? getComputedStyle(bar) : null;
      const style = getComputedStyle(activeTab);
      const range = document.createRange();
      range.selectNodeContents(activeTab);
      const textBox = range.getBoundingClientRect();
      const listBox = list?.getBoundingClientRect();
      const barBox = bar?.getBoundingClientRect();
      const labelCenterOffsetPx = listBox
        ? Math.abs(
            (textBox.top + textBox.bottom) / 2 -
              (listBox.top + listBox.bottom) / 2
          )
        : 0;
      const trackCenterOffsetPx =
        listBox && barBox
          ? Math.abs(
              (listBox.top + listBox.bottom) / 2 -
                (barBox.top + barBox.bottom) / 2
            )
          : 0;
      return {
        afterHeight: after.height,
        afterOpacity: after.opacity,
        afterTop: after.top,
        barHeight: barStyle?.height ?? "",
        columnGap: listStyle?.columnGap ?? "",
        fontSize: style.fontSize,
        labelCenterOffsetPx,
        paddingLeft: style.paddingLeft,
        trackCenterOffsetPx,
        trackHeight: listStyle?.height ?? "",
      };
    });
    const { labelCenterOffsetPx, trackCenterOffsetPx, ...sheetTabStyles } =
      sheetTabGeometry;
    // Same line-tab grammar as the review surface switcher: shared 28px track,
    // text-xs, 10px trigger padding and 16px gap. The sheet footer adds a 36px
    // shell (terminal composer chrome parity) with the track centered; the
    // trigger box height stays owned by the shared component. Only the
    // indicator edge is inverted because the sheet strip is docked below the
    // grid.
    expect(sheetTabStyles).toEqual({
      afterHeight: "2px",
      afterOpacity: "1",
      afterTop: "0px",
      barHeight: "36px",
      columnGap: "16px",
      fontSize: "12px",
      paddingLeft: "10px",
      trackHeight: "28px",
    });
    // 36px shell = 28px track + 4px breathing room on each side.
    expect(trackCenterOffsetPx).toBeLessThanOrEqual(1);
    // The label must also be centered inside the track; a 1px tolerance
    // absorbs device-pixel rounding. A regression (e.g. padding that pushes
    // the label to the bottom edge) fails here.
    expect(labelCenterOffsetPx).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath("document-preview-xlsx.png"),
    });
    await page.getByRole("tab", { name: "Summary" }).click();
    await expect(grid).toContainText("Total");
    await expect(grid).not.toContainText("Alice");
    // Leave the workbook on its first sheet so the narrow pass is deterministic.
    await page.getByRole("tab", { name: "Data", exact: true }).click();
    await expect(grid).toContainText("Alice");

    // Unsupported formats explain the state and offer the default app.
    await page.getByText("deck.pptx", { exact: true }).first().click();
    await expect(
      page.locator('[data-slot="document-preview-unsupported"]')
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/can’t be previewed in the workspace|无法在工作台内预览/u)
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /Open in default app|在默认应用中打开/u,
      })
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("document-preview-unsupported.png"),
    });

    await page.getByText("locked.docx", { exact: true }).first().click();
    await expect(page.getByText(/encrypted|已加密/u).first()).toBeVisible({
      timeout: 30_000,
    });

    // Light theme: every surface stays legible on the paper theme.
    await selectTheme(page, { id: "light", label: /Light|浅色/u });
    await page.getByText("report.pdf", { exact: true }).first().click();
    await expect(
      page.locator('[data-slot="document-preview-pdf"]')
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("document-preview-pdf-light.png"),
    });
    await page.getByText("notes.docx", { exact: true }).first().click();
    await expect(page.getByText("Pier DOCX preview")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("document-preview-docx-light.png"),
    });
    await page.getByText("data.xlsx", { exact: true }).first().click();
    await expect(page.locator('[role="grid"]')).toContainText("Alice");
    await page.screenshot({
      path: testInfo.outputPath("document-preview-xlsx-light.png"),
    });
    await page.getByText("deck.pptx", { exact: true }).first().click();
    await expect(
      page.locator('[data-slot="document-preview-unsupported"]')
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("document-preview-unsupported-light.png"),
    });

    // Narrow panel (~480px): open each document from the tree, hide the tree
    // so the preview owns the full panel, then restore it for the next file.
    await setWindowSize(application, page, 480, 700);
    await showFileTree(page);

    await openFromTree(page, "report.pdf");
    await expect(
      page.locator('[data-slot="document-preview-pdf"]')
    ).toBeVisible();
    await hideFileTree(page);
    await page.screenshot({
      path: testInfo.outputPath("document-preview-pdf-narrow.png"),
    });
    await showFileTree(page);

    await openFromTree(page, "notes.docx");
    await expect(page.getByText("Pier DOCX preview")).toBeVisible();
    await hideFileTree(page);
    await page.screenshot({
      path: testInfo.outputPath("document-preview-docx-narrow.png"),
    });
    await showFileTree(page);

    await openFromTree(page, "data.xlsx");
    await expect(page.locator('[role="grid"]')).toContainText("Alice");
    await hideFileTree(page);
    await page.screenshot({
      path: testInfo.outputPath("document-preview-xlsx-narrow.png"),
    });

    const unexpectedErrors = consoleErrors.filter(
      (message) => !EXPECTED_CONSOLE_ERROR.test(message)
    );
    expect(unexpectedErrors).toEqual([]);
  } finally {
    await forceClose(application);
    rmSync(userDataDir, { force: true, recursive: true });
    rmSync(workspaceDir, { force: true, recursive: true });
  }
});
