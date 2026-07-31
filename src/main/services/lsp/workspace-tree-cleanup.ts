import type { WorkspaceLspPolicy } from "./workspace-policy.ts";

/** Bound wait for retained process-tree cleanup before ensure may proceed. */
export const LSP_TREE_CLEANUP_WAIT_MS = 10_000;
/** Second-chance wait after retryTermination is kicked. */
export const LSP_TREE_CLEANUP_RETRY_WAIT_MS = 5000;

/**
 * Wait for retained trees to leave the workspace, then retry termination once
 * if the first wait timed out / failed.
 */
export async function waitForLspTreeCleanupWithRetry(input: {
  host: { retryTermination(sessionIds: readonly string[]): Promise<void> };
  policy: Pick<WorkspaceLspPolicy, "treeBlockersOf" | "waitForTreeCleanup">;
  workspaceKey: string;
}): Promise<boolean> {
  if (await input.policy.waitForTreeCleanup(input.workspaceKey)) {
    return true;
  }
  const blockers = input.policy.treeBlockersOf(input.workspaceKey);
  if (blockers.length === 0) {
    return false;
  }
  try {
    await input.host.retryTermination(blockers);
  } catch (error) {
    console.error("[lsp] tree cleanup retry failed", {
      error,
      workspaceKey: input.workspaceKey,
    });
  }
  return await input.policy.waitForTreeCleanup(
    input.workspaceKey,
    LSP_TREE_CLEANUP_RETRY_WAIT_MS
  );
}
