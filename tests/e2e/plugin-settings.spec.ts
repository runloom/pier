import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
const SETTINGS_ACCELERATOR =
  process.platform === "darwin" ? "Meta+Comma" : "Control+Comma";
const SETTING_ROW_ID = "plugin-setting-pier.git.statusItem.showDirtyIndicator";

const execFileAsync = promisify(execFile);

interface CliResult<T> {
  data?: T;
  error?: {
    message?: string;
  };
  ok: boolean;
}

interface TerminalOpenData {
  panelId: string;
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
      env: {
        ...process.env,
        PIER_USER_DATA_DIR: userDataDir,
      },
    }
  );
  return JSON.parse(stdout) as CliResult<T>;
}

async function launchPierApp(
  userDataDir: string
): Promise<ElectronApplication> {
  return await electron.launch({
    args: [OUT_MAIN, `--user-data-dir=${userDataDir}`],
  });
}

/**
 * 全新 userDataDir 首次启动的默认终端 cwd 是用户 HOME（native 层无预置 cwd），
 * 不是仓库目录 —— 经 CLI `terminal open --cwd <repo>` 显式开一个 git-aware 面板，
 * 与 tests/e2e/terminal-task-status.spec.ts 的 CLI 驱动惯用法一致。
 * CLI control socket 由 main 进程异步起听，domcontentloaded 之后不保证已就绪，
 * 轮询到 CLI 可连通为止。
 */
async function openGitAwareTerminal(userDataDir: string): Promise<void> {
  let opened: CliResult<TerminalOpenData> | undefined;
  await expect
    .poll(
      async () => {
        opened = await runPierCliJson<TerminalOpenData>(userDataDir, [
          "terminal",
          "open",
          "--cwd",
          PROJECT_ROOT,
        ]).catch(() => undefined);
        return opened?.ok ?? false;
      },
      { timeout: 15_000 }
    )
    .toBe(true);
  expect(opened?.data?.panelId).toEqual(expect.any(String));
}

async function openGitPluginSettings(win: Page): Promise<void> {
  await win.waitForTimeout(1500);
  await win.keyboard.press(SETTINGS_ACCELERATOR);
  await expect(win.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
  const navItem = win.locator('[data-testid="settings-nav-plugin-pier.git"]');
  await expect(navItem).toBeVisible({ timeout: 5000 });
  await navItem.click();
  await win.waitForTimeout(400);
}

test.describe("Plugin settings e2e", () => {
  test("插件设置导航项出现 → 改 boolean → git 状态项 dirty indicator 隐藏 → 重启持久化", async () => {
    test.setTimeout(120_000);
    // 前缀刻意保持短：unix domain socket 路径（pier-control.sock）macOS 上有
    // sockaddr_un 104 字节上限，tmpdir 前缀加 /private/var 展开后过长会导致
    // local-control-server listen EINVAL（CLI 连不上，非本 Task 缺陷）。
    const userDataDir = mkdtempSync(join(tmpdir(), "pier-plugin-e2e-"));
    try {
      const app = await launchPierApp(userDataDir);
      const win = await app.firstWindow();
      await win.waitForLoadState("domcontentloaded");
      await win.waitForTimeout(1500);

      // 前置：CLI 显式开一个 cwd 指向仓库的终端面板，git 状态项才可见
      // （全新 userDataDir 的默认终端 cwd 是 HOME，非仓库目录）
      await openGitAwareTerminal(userDataDir);
      await expect(
        win.locator('[data-testid="worktree-status-trigger"]')
      ).toBeVisible({ timeout: 15_000 });

      await openGitPluginSettings(win);

      const switchControl = win.locator(`[id="${SETTING_ROW_ID}"]`);
      await expect(switchControl).toBeVisible({ timeout: 5000 });
      await expect(switchControl).toHaveAttribute("aria-checked", "true");
      await switchControl.click();
      await expect(switchControl).toHaveAttribute("aria-checked", "false");

      // 关闭设置，dirty indicator 必须消失（onDidChange 实时响应；
      // 工作树 clean 时本就不渲染 —— 断言 count 0 两种情形均成立）
      await win.keyboard.press("Escape");
      await expect(
        win.locator('[data-testid="git-dirty-indicator"]')
      ).toHaveCount(0, { timeout: 5000 });

      await app.close();

      // 二次 launch 同 userDataDir：plugin-settings.json 持久化生效
      const app2 = await launchPierApp(userDataDir);
      const win2 = await app2.firstWindow();
      await win2.waitForLoadState("domcontentloaded");
      await openGitPluginSettings(win2);
      await expect(win2.locator(`[id="${SETTING_ROW_ID}"]`)).toHaveAttribute(
        "aria-checked",
        "false",
        { timeout: 5000 }
      );
      await app2.close();
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
