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
  "out",
  "main",
  "index.js"
);
const PROJECT_ROOT = join(import.meta.dirname, "..", "..");
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

async function gitIn(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function makeDirtyableRepo(dir: string): Promise<void> {
  await gitIn(dir, ["init", "-q", "-b", "main"]);
  await gitIn(dir, ["config", "user.email", "e2e@pier.local"]);
  await gitIn(dir, ["config", "user.name", "Pier E2E"]);
  writeFileSync(join(dir, "tracked.txt"), "clean\n");
  await gitIn(dir, ["add", "."]);
  await gitIn(dir, ["commit", "-q", "-m", "init"]);
}

test.describe("Git status live updates e2e", () => {
  /**
   * 回归：同窗口两个消费方(两个终端面板的状态栏 item)watch 同一 gitRoot,
   * 关闭其中一个面板(其订阅 STOP)后,另一个面板必须继续收到 git 变更广播。
   * 旧实现 IPC 层无引用计数,任一面板 unmount 即杀死共享订阅,
   * 其余面板的 git 状态永久冻结——正是"改了代码但状态不更新"的现场。
   */
  test("closing one terminal panel keeps git status live for the rest", async () => {
    test.setTimeout(120_000);
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-git-live-e2e-"));
    const repo = mkdtempSync(join(tmpdir(), "pier-git-live-repo-"));
    await makeDirtyableRepo(repo);

    const app = await electron.launch({
      args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
    });
    try {
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");

      // 两个同 cwd 终端面板 → 两个状态栏 item watch 同一 gitRoot
      const first = await runPierCliJson<TerminalOpenData>(userDataDir, [
        "terminal",
        "open",
        "--cwd",
        repo,
      ]);
      expect(first.ok).toBe(true);
      const second = await runPierCliJson<TerminalOpenData>(userDataDir, [
        "terminal",
        "open",
        "--cwd",
        repo,
      ]);
      expect(second.ok).toBe(true);
      const firstPanelId = first.data?.panelId ?? "";
      const secondPanelId = second.data?.panelId ?? "";
      expect(firstPanelId).not.toBe("");
      expect(secondPanelId).not.toBe("");

      const firstTab = win.locator(`[data-panel-tab-id="${firstPanelId}"]`);
      const secondTab = win.locator(`[data-panel-tab-id="${secondPanelId}"]`);
      await expect(firstTab).toBeVisible();
      await expect(secondTab).toBeVisible();

      // 干净仓库:状态栏 item 已渲染,dirty 指示不存在
      await expect(
        win.locator('[data-testid="worktree-status-trigger"]:visible').first()
      ).toBeVisible();
      await expect(
        win.locator('[data-testid="git-dirty-indicator"]')
      ).toHaveCount(0);

      // 关闭第二个面板:点 tab 聚焦(避免按键落进终端)后 Mod+W
      await secondTab.click();
      await win.keyboard.press("ControlOrMeta+KeyW");
      await expect(secondTab).toHaveCount(0);

      // 外部修改工作树 → 存活面板的状态栏必须出现 dirty 指示。
      // 旧实现在此冻结(共享订阅已被关闭面板的 STOP 杀死),断言超时。
      writeFileSync(join(repo, "tracked.txt"), "dirty content\n");
      await expect(
        win.locator('[data-testid="git-dirty-indicator"]:visible').first()
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await app.close();
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
