import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  test,
} from "@playwright/test";
import { selectTheme, setWindowSize } from "../workbench/e2e-harness.ts";

const PROJECT_ROOT = join(import.meta.dirname, "..", "..", "..");
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

test("renders Markdown in the production worker and keeps scrollbar policy consistent", async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(60_000);
  const userDataDir = mkdtempSync(
    join(tmpdir(), "pier-markdown-scrollbar-e2e-")
  );
  const workspaceDir = mkdtempSync(join(tmpdir(), "pier-markdown-workspace-"));
  const markdown = [
    "# Worker Diagram",
    "",
    "```mermaid",
    "graph TD;A-->B",
    "```",
    "",
    ...Array.from(
      { length: 80 },
      (_, index) => `## Section ${index + 1}\n\nScrollbar comparison content.\n`
    ),
  ].join("\n");
  writeFileSync(join(workspaceDir, "scrollbars.md"), markdown);
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
    await setWindowSize(application, page, 900, 650);

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
    await page.getByText("scrollbars.md", { exact: true }).first().click();

    // Markdown may restore last open mode (preview); force source for scroller checks.
    const switchToSource = page.getByRole("button", {
      name: /切换到源码|Switch to source/u,
    });
    if (await switchToSource.isVisible().catch(() => false)) {
      await switchToSource.click();
    }
    await expect(
      page.getByRole("textbox", { name: /源码编辑器|Source editor/u })
    ).toBeVisible({ timeout: 15_000 });

    const sourceScroller = page.locator(
      '.cm-scroller[data-scrollbar="stable"], .cm-scroller[data-scrollbar="overlay"]'
    );
    await expect(sourceScroller).toBeVisible({ timeout: 30_000 });
    await sourceScroller.evaluate((element) => {
      element.scrollTop = 600;
      element.dispatchEvent(new Event("scroll"));
    });
    const sourcePolicy = await sourceScroller.evaluate((element) => ({
      gutter: getComputedStyle(element).scrollbarGutter,
      width: getComputedStyle(element).scrollbarWidth,
    }));
    await page.screenshot({
      path: testInfo.outputPath("files-markdown-source-scrollbar.png"),
    });

    const switchToPreview = page.getByRole("button", {
      name: /切换到预览|Switch to preview/u,
    });
    await switchToPreview.click();
    const previewScroller = page.locator(
      '[data-slot="markdown-preview"][data-scrollbar="stable"]'
    );
    await expect(previewScroller).toBeVisible();
    await expect(page.locator('[data-slot="markdown-prose"]')).toBeVisible({
      timeout: 30_000,
    });
    // Accessible name includes the copy-anchor button label; match the
    // heading's own text so "Section 10" cannot steal "Section 1".
    await expect(
      page
        .locator('[data-slot="markdown-prose"] h2.md-heading-group')
        .filter({ hasText: /^Section 1$/u })
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(
        /Unable to render Markdown preview|无法渲染 Markdown 预览/u
      )
    ).toHaveCount(0);
    // beautiful-mermaid does not emit official `svg.flowchart` / `g.nodes`;
    // the preview mounts one live SVG under the diagram shell.
    const diagram = page.locator('[data-slot="markdown-diagram"] svg').first();
    await expect(diagram).toBeVisible({ timeout: 30_000 });
    // Mermaid DOM shape varies by version; require a real SVG and non-accent
    // stroke/fill on graph geometry when present.
    const diagramColors = await diagram.evaluate((element) => {
      const accentProbe = document.createElement("span");
      accentProbe.style.color = "var(--action-accent)";
      document.body.append(accentProbe);
      const actionAccent = getComputedStyle(accentProbe).color;
      accentProbe.remove();
      const geometry =
        element.querySelector(
          "marker polygon, path.edgePath, polyline.edge, path.flowchart-link, .edgePath path"
        ) ?? element.querySelector("path, polyline, polygon");
      if (!(geometry instanceof SVGElement)) {
        return { actionAccent, geometryColor: null as string | null };
      }
      const style = getComputedStyle(geometry);
      return {
        actionAccent,
        geometryColor: style.fill === "none" ? style.stroke : style.fill,
      };
    });
    expect(diagramColors.geometryColor).toBeTruthy();
    expect(diagramColors.geometryColor).not.toBe(diagramColors.actionAccent);
    await previewScroller.evaluate((element) => {
      element.scrollTop = 600;
      element.dispatchEvent(new Event("scroll"));
    });
    const previewPolicy = await previewScroller.evaluate((element) => ({
      gutter: getComputedStyle(element).scrollbarGutter,
      width: getComputedStyle(element).scrollbarWidth,
    }));
    await page.screenshot({
      path: testInfo.outputPath("files-markdown-preview-scrollbar.png"),
    });

    expect(previewPolicy).toEqual(sourcePolicy);
    expect(previewPolicy).toEqual({ gutter: "stable", width: "thin" });
    expect(consoleErrors).toEqual([]);
  } finally {
    await forceClose(application);
    rmSync(userDataDir, { force: true, recursive: true });
    rmSync(workspaceDir, { force: true, recursive: true });
  }
});
