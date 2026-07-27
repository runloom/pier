import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

/** package-script taskId 前缀（`stableId(["package-script", name])`）。 */
const PACKAGE_SCRIPT_TASK_ID_PREFIX = "package-script:";

export type ResolveGitCommonDir = (cwd: string) => Promise<string | null>;

export function isPackageScriptTaskId(taskId: string): boolean {
  return taskId.startsWith(PACKAGE_SCRIPT_TASK_ID_PREFIX);
}

/**
 * 解析仓库级身份：`git rev-parse --git-common-dir`。
 * 同一 git 仓库的多个 worktree 返回同一绝对路径；非 git 目录返回 null。
 */
export async function resolveGitCommonDir(cwd: string): Promise<string | null> {
  if (!(cwd && isAbsolute(cwd))) {
    return null;
  }
  try {
    const output = await runGit(
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      cwd
    );
    const trimmed = output.trim();
    if (!trimmed) {
      return null;
    }
    const absolute = isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
    try {
      return await realpath(absolute);
    } catch {
      return absolute;
    }
  } catch {
    return null;
  }
}

function runGit(args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `git exited ${code ?? "null"}`));
    });
  });
}
