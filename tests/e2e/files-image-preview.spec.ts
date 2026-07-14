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
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

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

test("previews a signature-validated image and changes its zoom", async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(60_000);
  const userDataDir = mkdtempSync(join(tmpdir(), "pier-image-preview-e2e-"));
  const workspaceDir = mkdtempSync(join(tmpdir(), "pier-image-workspace-"));
  writeFileSync(join(workspaceDir, "preview.png"), PNG_1X1);
  writeFileSync(join(workspaceDir, "font.woff2"), Buffer.from([0, 1, 2, 3]));
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
    await page.getByText("preview.png", { exact: true }).first().click();

    const image = page.getByRole("img", { name: "preview.png" });
    await expect(image).toBeVisible({ timeout: 30_000 });
    await expect(image).toHaveAttribute(
      "src",
      /^pier-file-preview:\/\/file\/[A-Za-z0-9_-]{22}$/u
    );
    await expect(page.getByText(/^(Fit to window|适应窗口)$/u)).toBeVisible();
    const zoomMenu = page.getByRole("button", {
      name: /Zoom level: Fit to window|缩放级别: 适应窗口/u,
    });
    await expect(zoomMenu).toHaveAttribute("data-variant", "secondary");

    await zoomMenu.click();
    await page.screenshot({
      path: testInfo.outputPath("files-image-zoom-menu.png"),
    });
    await page
      .getByRole("menuitemradio", {
        name: /100%/u,
      })
      .click();
    await expect(page.getByText("100%", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Zoom in|放大/u }).click();
    await expect(page.getByText("110%", { exact: true })).toBeVisible();

    await page.screenshot({
      path: testInfo.outputPath("files-image-preview.png"),
    });

    await page.getByText("font.woff2", { exact: true }).first().click();
    await expect(page.getByText(/^(Binary|二进制) · 4 B$/u)).toBeVisible({
      timeout: 30_000,
    });
    const revealButton = page.getByRole("button", {
      name: /Show in file manager|在文件管理器中显示/u,
    });
    await expect(revealButton).toHaveAttribute("data-variant", "default");
    await page.screenshot({
      path: testInfo.outputPath("files-binary-empty.png"),
    });
    expect(consoleErrors).toEqual([]);
  } finally {
    await forceClose(application);
    rmSync(userDataDir, { force: true, recursive: true });
    rmSync(workspaceDir, { force: true, recursive: true });
  }
});
