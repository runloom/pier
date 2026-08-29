import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { _electron as electron, expect, test } from "@playwright/test";

const OUT_MAIN = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "out",
  "main",
  "index.js"
);
const PROJECT_ROOT = join(import.meta.dirname, "..", "..", "..");
const PIER_CLI = join(PROJECT_ROOT, "bin", "pier.mjs");

const execFileAsync = promisify(execFile);

test.skip(process.platform !== "darwin", "native terminal is macOS-only");

interface CliResult<T> {
  data?: T;
  error?: { code?: string; message?: string };
  ok: boolean;
}

interface TerminalOpenData {
  panelId: string;
  windowId: string;
}

async function runPierCliJson<T>(
  userDataDir: string,
  args: string[]
): Promise<CliResult<T>> {
  const { stdout } = await execFileAsync(
    process.execPath,
    [PIER_CLI, ...args, "--json"],
    {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PIER_USER_DATA_DIR: userDataDir },
    }
  );
  return JSON.parse(stdout) as CliResult<T>;
}

async function gitIn(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}

async function makeDirtyRepo(dir: string): Promise<void> {
  await gitIn(dir, ["init", "-q", "-b", "main"]);
  await gitIn(dir, ["config", "user.email", "e2e@pier.local"]);
  await gitIn(dir, ["config", "user.name", "Pier E2E"]);
  writeFileSync(join(dir, "tracked.txt"), "clean\n");
  await gitIn(dir, ["add", "."]);
  await gitIn(dir, ["commit", "-q", "-m", "init"]);
  writeFileSync(join(dir, "tracked.txt"), "dirty\n");
}

test.describe("Git confirm commit e2e", () => {
  test("unstaged changes default into the confirm card and become HEAD", async () => {
    test.setTimeout(120_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-git-commit-e2e-"));
    const repo = mkdtempSync(join(tmpdir(), "pier-git-commit-repo-"));
    await makeDirtyRepo(repo);

    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await win
        .locator(
          '[data-testid="workspace-host-root"][data-workspace-ready="true"]'
        )
        .waitFor({ state: "visible", timeout: 30_000 });

      const opened = await runPierCliJson<TerminalOpenData>(userDataDir, [
        "terminal",
        "open",
        "--cwd",
        repo,
      ]);
      expect(opened.ok).toBe(true);
      const panelId = opened.data?.panelId ?? "";
      expect(panelId).not.toBe("");
      await win.locator(`[data-panel-tab-id="${panelId}"]`).click();

      const changesTrigger = win
        .locator('[data-testid="git-changes-status-trigger"]:visible')
        .first();
      await expect(changesTrigger).toBeVisible({ timeout: 20_000 });
      await changesTrigger.click();

      const commitButton = win.getByTestId("git-review-commit");
      await expect(commitButton).toBeVisible({ timeout: 20_000 });
      await commitButton.click();

      const dialog = win.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await expect(dialog).toContainText(
        /提交当前更改|Commit the current changes|現在の変更をコミットします|현재 변경을 커밋합니다/u
      );
      const include = dialog.getByRole("checkbox", {
        name: /包含未暂存的更改|Include unstaged changes|ステージしていない変更も含める|스테이징하지 않은 변경도 포함/u,
      });
      await expect(include).toBeChecked();
      const message = dialog.getByRole("textbox");
      await expect(message).toBeFocused();
      await message.fill("e2e confirm commit");
      await dialog
        .getByRole("button", { name: /^(?:提交|Commit|コミット|커밋)$/u })
        .click();
      await expect(dialog).toHaveCount(0, { timeout: 15_000 });

      const subject = (await gitIn(repo, ["log", "-1", "--format=%s"])).trim();
      expect(subject).toBe("e2e confirm commit");
      const files = await gitIn(repo, [
        "show",
        "--name-only",
        "--pretty=format:",
        "HEAD",
      ]);
      expect(files).toContain("tracked.txt");
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
