import type { PanelContext } from "@shared/contracts/panel.ts";

export type PanelGitIdentityFields = Pick<
  PanelContext,
  "branch" | "cwd" | "gitRoot" | "head" | "worktreeRoot"
>;

/**
 * Terminal git-identity digest. `updatedAt` / `contextId` / `source` are
 * excluded so a same-cwd re-resolve does not flash the status bar.
 */
export function panelGitIdentityDigest(
  context: PanelGitIdentityFields | null | undefined
): string {
  return [
    context?.cwd ?? "",
    context?.gitRoot ?? "",
    context?.worktreeRoot ?? "",
    context?.branch ?? "",
    context?.head ?? "",
  ].join("\0");
}

export function panelGitIdentityUnchanged(
  left: PanelGitIdentityFields | null | undefined,
  right: PanelGitIdentityFields | null | undefined
): boolean {
  return panelGitIdentityDigest(left) === panelGitIdentityDigest(right);
}
