import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from "@playwright/test";

const OUT_MAIN = join(
  import.meta.dirname,
  "..",
  "..",
  "out",
  "main",
  "index.js"
);

const APP_CLOSE_TIMEOUT_MS = 20_000;

async function waitForWorkspaceReady(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page
    .locator('[data-testid="workspace-host-root"][data-workspace-ready="true"]')
    .waitFor({ state: "visible", timeout: 30_000 });
}

async function killAndWait(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
  });
  child.kill("SIGKILL");
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      exited,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Electron child did not exit after SIGKILL")),
          5000
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function closeApplication(
  application: ElectronApplication
): Promise<void> {
  const child = application.process();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      application.close(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("Electron application close timed out"));
        }, APP_CLOSE_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    await killAndWait(child);
    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function forceCloseApplication(
  application: ElectronApplication | null
): Promise<void> {
  if (!application) {
    return;
  }
  let child: ChildProcess;
  try {
    child = application.process();
  } catch {
    return;
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      application.close().catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 5000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  await killAndWait(child);
}

function startFifoWriter(path: string, payload: string): ChildProcess {
  return spawn(
    process.execPath,
    [
      "-e",
      "const fs=require('node:fs');const [path,payload]=process.argv.slice(1);for(;;)fs.writeFileSync(path,payload);",
      path,
      payload,
    ],
    { stdio: "ignore" }
  );
}

function rejectIfFifoWriterFailsToStart(writer: ChildProcess): Promise<never> {
  return new Promise((_resolve, reject) => {
    writer.once("error", reject);
  });
}

test.describe("Startup stability e2e", () => {
  test("closes cleanly while the startup screen is still active", async () => {
    test.setTimeout(60_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-starting-close-e2e-"));
    let application: ElectronApplication | null = null;
    try {
      const localEnvironmentsFifo = join(
        userDataDir,
        "local-environments.json"
      );
      execFileSync("mkfifo", [localEnvironmentsFifo]);
      application = await electron.launch({
        args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
      });
      const page = await application.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      await expect(
        page.getByText(/Starting Pier…|正在启动 Pier…/)
      ).toBeVisible();
      // renderer 已阻塞在 local environments 读取；放行读取后，关闭流程应立即完成，
      // 且不会因 WorkspaceHost 从未挂载而等待布局保存。
      const writer = startFifoWriter(
        localEnvironmentsFifo,
        '{"projects":[],"version":1,"worktreeBindings":[]}\n'
      );
      try {
        await Promise.race([
          closeApplication(application),
          rejectIfFifoWriterFailsToStart(writer),
        ]);
      } finally {
        await killAndWait(writer);
      }
      application = null;
    } finally {
      await forceCloseApplication(application);
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test("vetoes a real close once when durable draft protection fails, then retries", async () => {
    test.setTimeout(90_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-close-failure-e2e-"));
    let application: ElectronApplication | null = null;
    let draftOwnerBackup = "";
    let draftOwnerDir = "";
    try {
      application = await electron.launch({
        args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
      });
      const page = await application.firstWindow();
      await waitForWorkspaceReady(page);
      await page
        .locator('[data-testid="files-project-status-trigger"]')
        .click();
      await page.getByText("package.json", { exact: true }).first().click();
      const editor = page.locator(
        '[data-testid="files-code-mirror-editor"] .cm-content'
      );
      await expect(editor).toBeVisible({ timeout: 30_000 });
      await editor.click();
      await page.keyboard.press("Meta+End");
      await page.keyboard.type("\n ");
      await expect(
        page.getByRole("status", { name: /Protected|已保护/ })
      ).toBeAttached({ timeout: 30_000 });

      const { recordId } = await page.evaluate(() =>
        window.pier.window.getContext()
      );
      draftOwnerDir = join(userDataDir, "file-drafts", "entries", recordId);
      draftOwnerBackup = `${draftOwnerDir}.backup`;
      expect(existsSync(draftOwnerDir)).toBe(true);
      renameSync(draftOwnerDir, draftOwnerBackup);
      writeFileSync(draftOwnerDir, "blocked");

      await editor.click();
      await page.keyboard.type(" ");
      await expect(
        page.getByRole("button", { name: /Not protected|未保护/ })
      ).toBeVisible({ timeout: 30_000 });
      await page.evaluate(() => window.pier.window.closeCurrent());

      const failureDialog = page.getByRole("alertdialog");
      await expect(failureDialog).toBeVisible({ timeout: 30_000 });
      await expect(
        failureDialog.getByRole("heading", {
          name: /Unable to close window|无法关闭窗口/,
        })
      ).toBeVisible();
      await expect(page.getByRole("alertdialog")).toHaveCount(1);
      expect(application.windows()).toHaveLength(1);

      await failureDialog.getByRole("button", { name: /OK|确定/ }).click();
      await expect(failureDialog).toBeHidden();
      expect(application.windows()).toHaveLength(1);

      rmSync(draftOwnerDir, { force: true });
      renameSync(draftOwnerBackup, draftOwnerDir);
      draftOwnerBackup = "";
      await editor.click();
      await page.keyboard.type(" ");
      await expect(
        page.getByRole("status", { name: /Protected|已保护/ })
      ).toBeAttached({ timeout: 30_000 });
      await page.evaluate(() => window.pier.window.closeCurrent());
      await expect.poll(() => application?.windows().length ?? 0).toBe(0);

      await closeApplication(application);
      application = null;
    } finally {
      if (draftOwnerBackup && existsSync(draftOwnerBackup)) {
        rmSync(draftOwnerDir, { force: true });
        renameSync(draftOwnerBackup, draftOwnerDir);
      }
      await forceCloseApplication(application);
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test("restores the last focused record without background focus stealing", async () => {
    test.setTimeout(90_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-startup-e2e-"));
    let firstApp: ElectronApplication | null = null;
    let restoredApp: ElectronApplication | null = null;
    let secondRecordId = "";
    try {
      firstApp = await electron.launch({
        args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
      });
      const firstWindow = await firstApp.firstWindow();
      await waitForWorkspaceReady(firstWindow);

      const secondWindowPromise = firstApp.waitForEvent("window");
      await firstWindow.evaluate(() => window.pier.createWindow());
      const secondWindow = await secondWindowPromise;
      await waitForWorkspaceReady(secondWindow);
      const secondContext = await secondWindow.evaluate(() =>
        window.pier.window.getContext()
      );
      secondRecordId = secondContext.recordId;

      await firstWindow.evaluate(
        (windowId) => window.pier.focusWindow(windowId),
        secondContext.windowId
      );
      await expect
        .poll(async () => {
          const windows = await firstWindow.evaluate(() =>
            window.pier.listWindows()
          );
          return windows.find((win) => win.recordId === secondRecordId)
            ?.focused;
        })
        .toBe(true);

      await closeApplication(firstApp);
      firstApp = null;

      restoredApp = await electron.launch({
        args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
      });
      try {
        const restoredWindow = await restoredApp.firstWindow();
        await waitForWorkspaceReady(restoredWindow);

        await expect
          .poll(async () => {
            const windows = await restoredWindow.evaluate(() =>
              window.pier.listWindows()
            );
            const mostRecent = [...windows].sort(
              (left, right) =>
                (right.lastFocusedAt ?? -1) - (left.lastFocusedAt ?? -1)
            )[0];
            return {
              mostRecentRecordId:
                mostRecent?.lastFocusedAt === undefined
                  ? undefined
                  : mostRecent.recordId,
              total: windows.length,
            };
          })
          .toEqual({ mostRecentRecordId: secondRecordId, total: 2 });

        for (let attempt = 0; attempt < 5; attempt += 1) {
          const windows = await restoredWindow.evaluate(() =>
            window.pier.listWindows()
          );
          const focusedRecordId = windows.find((win) => win.focused)?.recordId;
          expect(
            focusedRecordId === undefined || focusedRecordId === secondRecordId
          ).toBe(true);
          expect(
            [...windows].sort(
              (left, right) =>
                (right.lastFocusedAt ?? -1) - (left.lastFocusedAt ?? -1)
            )[0]?.recordId
          ).toBe(secondRecordId);
          await restoredWindow.waitForTimeout(200);
        }
      } finally {
        await closeApplication(restoredApp);
        restoredApp = null;
      }
    } finally {
      await forceCloseApplication(restoredApp);
      await forceCloseApplication(firstApp);
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
