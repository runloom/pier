interface GitBranchSwitchExecOptions {
  timeoutMs?: number;
}

type GitBranchSwitchExec = (
  args: readonly string[],
  cwd: string,
  options?: GitBranchSwitchExecOptions
) => Promise<string>;

/** 防止分支名被 Git 解释成命令选项。 */
export function assertSafeBranchName(name: string): void {
  if (name.startsWith("-")) {
    throw new Error(
      `branch name must not start with "-" (would be interpreted as git flag): ${name}`
    );
  }
}

export async function switchBranch(
  exec: GitBranchSwitchExec,
  cwd: string,
  name: string,
  options: { create: boolean; timeoutMs: number }
): Promise<void> {
  assertSafeBranchName(name);
  if (options.create) {
    await exec(["check-ref-format", "--branch", name], cwd);
  }
  await exec(["switch", ...(options.create ? ["-c"] : []), name], cwd, {
    timeoutMs: options.timeoutMs,
  });
}
