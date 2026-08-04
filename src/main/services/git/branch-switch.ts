import { localNameFromRemoteTracking } from "../../../shared/git-branch-names.ts";

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

export interface SwitchBranchResult {
  /** 最终所在本地分支名 */
  localName: string;
  /**
   * created-tracking：新建并设置跟踪
   * switched-existing：本地已有，仅 switch（未改 tip/upstream）
   * switched-local：普通本地 switch
   */
  mode: "created-tracking" | "switched-existing" | "switched-local";
  remoteRef: null | string;
}

async function refExists(
  exec: GitBranchSwitchExec,
  cwd: string,
  ref: string,
  timeoutMs: number
): Promise<boolean> {
  try {
    await exec(["show-ref", "--verify", "--quiet", ref], cwd, { timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/**
 * 从 remote-tracking 检出：本地已有同名则 switch；否则建跟踪分支。
 * 禁止 detached checkout `origin/foo`。
 */
export async function switchFromRemoteTracking(
  exec: GitBranchSwitchExec,
  cwd: string,
  remoteRef: string,
  timeoutMs: number
): Promise<SwitchBranchResult> {
  assertSafeBranchName(remoteRef);
  const localName = localNameFromRemoteTracking(remoteRef);
  if (localName === null) {
    throw new Error(`invalid remote-tracking name: ${remoteRef}`);
  }
  assertSafeBranchName(localName);
  const remoteOk = await refExists(
    exec,
    cwd,
    `refs/remotes/${remoteRef}`,
    timeoutMs
  );
  if (!remoteOk) {
    throw new Error(`remote-tracking branch not found: ${remoteRef}`);
  }
  const localOk = await refExists(
    exec,
    cwd,
    `refs/heads/${localName}`,
    timeoutMs
  );
  if (localOk) {
    await exec(["switch", localName], cwd, { timeoutMs });
    return {
      localName,
      mode: "switched-existing",
      remoteRef,
    };
  }
  await exec(["check-ref-format", "--branch", localName], cwd, {
    timeoutMs,
  });
  await exec(["switch", "-c", localName, "--track", remoteRef], cwd, {
    timeoutMs,
  });
  return {
    localName,
    mode: "created-tracking",
    remoteRef,
  };
}

export async function switchBranch(
  exec: GitBranchSwitchExec,
  cwd: string,
  name: string,
  options: { create: boolean; timeoutMs: number }
): Promise<SwitchBranchResult> {
  assertSafeBranchName(name);
  if (options.create) {
    await exec(["check-ref-format", "--branch", name], cwd);
    await exec(["switch", "-c", name], cwd, {
      timeoutMs: options.timeoutMs,
    });
    return { localName: name, mode: "switched-local", remoteRef: null };
  }

  // 若 name 是已存在的 remote-tracking（如 origin/foo），走建/切本地跟踪分支。
  const remoteRefPath = `refs/remotes/${name}`;
  if (await refExists(exec, cwd, remoteRefPath, options.timeoutMs)) {
    return switchFromRemoteTracking(exec, cwd, name, options.timeoutMs);
  }

  await exec(["switch", name], cwd, {
    timeoutMs: options.timeoutMs,
  });
  return { localName: name, mode: "switched-local", remoteRef: null };
}
