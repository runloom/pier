import { normalizeFsRoot } from "./resolve-root.ts";

export function deriveLspWorkspaceKey(input: {
  isWorktree?: boolean;
  rootPath: string;
  workspaceKey?: string;
}): string {
  if (input.workspaceKey && input.workspaceKey.length > 0) {
    return input.workspaceKey;
  }
  const root = normalizeFsRoot(input.rootPath);
  return input.isWorktree ? `wt:${root}` : `main:${root}`;
}
