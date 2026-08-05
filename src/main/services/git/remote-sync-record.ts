import type { GitRemoteSync } from "../../../shared/contracts/git.ts";
import { isAuthRemoteFailure } from "../../../shared/git-remote-failure.ts";
import type { GitOperationExec } from "./operation-helpers.ts";
import { listWorktreePaths } from "./operation-helpers.ts";
import { getRemoteSync, recordRemoteSync } from "./remote-sync-registry.ts";

/**
 * 用户触发 fetch 的 remoteSync 写入（与 autofetch 共用 registry）。
 * 与 createGitService 解耦：只负责健康度状态，不跑 git。
 */
export async function recordUserFetchPhase(
  execGit: GitOperationExec,
  cwd: string,
  phase:
    | { kind: "fetching" }
    | { kind: "ok" }
    | { kind: "failed"; message: string }
): Promise<void> {
  const roots = await resolveRecordRoots(execGit, cwd);
  const prior =
    getRemoteSync(cwd)?.lastSuccessAt ??
    getRemoteSync(roots[0] ?? cwd)?.lastSuccessAt ??
    null;

  if (phase.kind === "fetching") {
    recordRemoteSync(roots, {
      lastSuccessAt: prior,
      state: "fetching",
    } satisfies GitRemoteSync);
    return;
  }
  if (phase.kind === "ok") {
    recordRemoteSync(roots, {
      lastSuccessAt: Date.now(),
      state: "idle",
    } satisfies GitRemoteSync);
    return;
  }
  recordRemoteSync(roots, {
    lastSuccessAt: prior,
    state: isAuthRemoteFailure(phase.message) ? "authRequired" : "backoff",
  } satisfies GitRemoteSync);
}

async function resolveRecordRoots(
  execGit: GitOperationExec,
  cwd: string
): Promise<string[]> {
  try {
    const rootOut = await execGit(
      ["rev-parse", "--path-format=absolute", "--show-toplevel"],
      cwd
    );
    const root = rootOut.trim();
    if (root.length === 0) {
      return [cwd];
    }
    return listWorktreePaths(execGit, root);
  } catch {
    return [cwd];
  }
}
