import { WRITE_TIMEOUT_MS } from "./operation-helpers.ts";
import type { GitServiceExec } from "./service-support.ts";

/** `fatal: pathspec '…' did not match any files`（exit 128）。 */
export function isGitPathspecError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("pathspec") &&
    (message.includes("did not match") || message.includes("退出码 128"))
  );
}

/**
 * Stage paths：已跟踪走 `add -u`，未跟踪先过滤 ignore 再 `add`。
 * 逐路径容错 pathspec 未命中，避免 rename 旧路径拖垮整批。
 */
export async function stagePaths(
  runGit: GitServiceExec,
  cwd: string,
  paths: readonly string[]
): Promise<void> {
  if (paths.length === 0) {
    throw new Error("stage requires at least one path");
  }
  // 父目录被 gitignore、但文件已跟踪时，`git add -- path` 会 exit 1
  //（文案点名父目录）。已跟踪路径改走 `add -u`；未跟踪先 check-ignore
  // 过滤，避免 Stage All 因忽略项整批失败。
  //
  // rename / 目录整理会同时传入 target+old：旧路径常已不在 index 与
  // worktree。对「仍可操作」的路径逐个 add，pathspec 未命中则跳过，
  // 避免整批 exit 128。
  const uniquePaths = [...new Set(paths)];
  const trackedOutput = await runGit(
    ["ls-files", "-z", "--cached", "--", ...uniquePaths],
    cwd,
    { timeoutMs: WRITE_TIMEOUT_MS }
  );
  const tracked = new Set(
    trackedOutput.split("\0").filter((path) => path.length > 0)
  );
  const trackedPaths = uniquePaths.filter((path) => tracked.has(path));
  const untrackedPaths = uniquePaths.filter((path) => !tracked.has(path));

  for (const path of trackedPaths) {
    try {
      await runGit(["add", "-u", "--", path], cwd, {
        timeoutMs: WRITE_TIMEOUT_MS,
      });
    } catch (error) {
      if (!isGitPathspecError(error)) {
        throw error;
      }
    }
  }

  if (untrackedPaths.length === 0) {
    return;
  }

  let ignored = new Set<string>();
  try {
    const ignoredOutput = await runGit(
      ["check-ignore", "--", ...untrackedPaths],
      cwd,
      { timeoutMs: WRITE_TIMEOUT_MS }
    );
    ignored = new Set(
      ignoredOutput
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    );
  } catch {
    // check-ignore exit 1 = 无一命中；其它失败时保守尝试全部 untracked。
    ignored = new Set();
  }

  const othersOutput = await runGit(
    ["ls-files", "-z", "--others", "--", ...untrackedPaths],
    cwd,
    { timeoutMs: WRITE_TIMEOUT_MS }
  );
  const existingOthers = new Set(
    othersOutput.split("\0").filter((path) => path.length > 0)
  );
  const addableUntracked = untrackedPaths.filter(
    (path) => !ignored.has(path) && existingOthers.has(path)
  );
  for (const path of addableUntracked) {
    try {
      await runGit(["add", "--", path], cwd, {
        timeoutMs: WRITE_TIMEOUT_MS,
      });
    } catch (error) {
      if (!isGitPathspecError(error)) {
        throw error;
      }
    }
  }
}

/**
 * Unstage paths：只 restore 仍在 index ∪ HEAD 的路径，避免 pathspec 空打。
 */
export async function unstagePaths(
  runGit: GitServiceExec,
  cwd: string,
  paths: readonly string[]
): Promise<void> {
  if (paths.length === 0) {
    throw new Error("unstage requires at least one path");
  }
  // restore --staged 的合法目标 = 存在于 index 或 HEAD 的路径：
  // 已暂存删除 / rename 旧路径不在 index，但 restore 会从 HEAD 恢复
  // index 条目，必须保留；两边都不存在的路径会让 restore 报
  // pathspec 错误，需要剔除。--with-tree=HEAD 恰好给出 index ∪ HEAD。
  let stagedOutput: string;
  try {
    stagedOutput = await runGit(
      ["ls-files", "-z", "--with-tree=HEAD", "--", ...paths],
      cwd,
      { timeoutMs: WRITE_TIMEOUT_MS }
    );
  } catch {
    // unborn HEAD（无提交）无法解析 tree-ish：回退到只按 index 过滤，
    // 与历史行为一致（此时 restore --staged 本身也无法工作）。
    stagedOutput = await runGit(
      ["ls-files", "-z", "--cached", "--", ...paths],
      cwd,
      { timeoutMs: WRITE_TIMEOUT_MS }
    );
  }
  const staged = new Set(
    stagedOutput.split("\0").filter((path) => path.length > 0)
  );
  const restorePaths = paths.filter((path) => staged.has(path));
  if (restorePaths.length === 0) {
    return;
  }
  await runGit(["restore", "--staged", "--", ...restorePaths], cwd, {
    timeoutMs: WRITE_TIMEOUT_MS,
  });
}
