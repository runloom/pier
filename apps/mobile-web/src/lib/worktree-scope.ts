/**
 * 会话作用域：变更/文件根路径与目录叶子名。
 * 路由参数优先；无参数时回退快照启发式（兼容旧链接）。
 */
import type { ControlSnapshotPayload } from "@shared/contracts/local-control/control-snapshot.ts";

export function pathLeaf(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

export function pickWorktreeCwd(
  snapshot: ControlSnapshotPayload | null
): string | null {
  if (snapshot === null) {
    return null;
  }
  return (
    snapshot.worktrees.find((entry) => entry.path.length > 0)?.path ??
    snapshot.agents.find((entry) => entry.cwd !== undefined)?.cwd ??
    snapshot.panels.find((entry) => entry.cwd !== undefined)?.cwd ??
    snapshot.panels.find((entry) => entry.canonicalPath !== undefined)
      ?.canonicalPath ??
    null
  );
}

export function pickFileRoot(
  snapshot: ControlSnapshotPayload | null
): string | null {
  if (snapshot === null) {
    return null;
  }
  const worktree = snapshot.worktrees[0];
  if (worktree !== undefined) {
    return worktree.canonicalPath ?? worktree.path;
  }
  return pickWorktreeCwd(snapshot);
}

export function parentDir(path: string): string {
  const parts = path.split("/").filter((segment) => segment.length > 0);
  return parts.slice(0, -1).join("/");
}
