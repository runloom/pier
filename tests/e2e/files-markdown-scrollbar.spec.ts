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
import { selectTheme, setWindowSize } from "./workbench-e2e-harness.ts";

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

    const sourceScroller = page.locator(
      '.cm-scroller[data-scrollbar="stable"]'
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

    await page.getByRole("radio", { name: /Preview|预览/u }).click();
    const previewScroller = page.locator(
      '[data-slot="markdown-preview"][data-scrollbar="stable"]'
    );
    await expect(previewScroller).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Section 1", exact: true })
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(
        /Unable to render Markdown preview|无法渲染 Markdown 预览/u
      )
    ).toHaveCount(0);
    const diagram = page.locator('[data-slot="markdown-diagram"] svg');
    await expect(diagram).toBeVisible({ timeout: 30_000 });
    const diagramColors = await diagram.evaluate((element) => {
      const arrow = element.querySelector("marker polygon");
      const edge = element.querySelector("polyline.edge");
      if (!(arrow instanceof SVGElement && edge instanceof SVGElement)) {
        throw new Error("Expected Mermaid arrow and edge elements");
      }
      const accentProbe = document.createElement("span");
      accentProbe.style.color = "var(--action-accent)";
      document.body.append(accentProbe);
      const colors = {
        actionAccent: getComputedStyle(accentProbe).color,
        arrow: getComputedStyle(arrow).fill,
        edge: getComputedStyle(edge).stroke,
      };
      accentProbe.remove();
      return colors;
    });
    expect(diagramColors.arrow).not.toBe(diagramColors.actionAccent);
    expect(diagramColors.arrow).not.toBe(diagramColors.edge);
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
