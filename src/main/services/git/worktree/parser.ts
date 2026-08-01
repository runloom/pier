import type { WorktreeItem } from "@shared/contracts/worktree.ts";

function shortBranchName(ref: string): string {
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
}

function emptyItem(path: string, isMain: boolean): WorktreeItem {
  return {
    bare: false,
    branch: null,
    detached: false,
    head: null,
    isCurrent: false,
    isMain,
    locked: false,
    lockedReason: null,
    path,
    prunable: false,
    prunableReason: null,
  };
}

function finalizeItem(
  items: WorktreeItem[],
  item: WorktreeItem | null,
  currentPath: string | undefined
): void {
  if (!item) {
    return;
  }
  items.push({
    ...item,
    isCurrent: currentPath === item.path,
  });
}

function parseFlagWithReason(line: string, flag: string): string | null {
  if (line === flag) {
    return null;
  }
  return line.startsWith(`${flag} `) ? line.slice(flag.length + 1) : null;
}

function applyWorktreeLine(item: WorktreeItem, line: string): void {
  if (line.startsWith("HEAD ")) {
    item.head = line.slice("HEAD ".length);
    return;
  }
  if (line.startsWith("branch ")) {
    item.branch = shortBranchName(line.slice("branch ".length));
    return;
  }
  if (line === "bare") {
    item.bare = true;
    return;
  }
  if (line === "detached") {
    item.detached = true;
    item.branch = null;
    return;
  }

  const lockedReason = parseFlagWithReason(line, "locked");
  if (lockedReason !== null || line === "locked") {
    item.locked = true;
    item.lockedReason = lockedReason;
    return;
  }

  const prunableReason = parseFlagWithReason(line, "prunable");
  if (prunableReason !== null || line === "prunable") {
    item.prunable = true;
    item.prunableReason = prunableReason;
  }
}

export function parseGitWorktreeListPorcelainZ(
  output: string,
  currentPath?: string
): WorktreeItem[] {
  const items: WorktreeItem[] = [];
  let current: WorktreeItem | null = null;

  // Git's -z format keeps records NUL-delimited while attributes remain line-based.
  const lines = output
    .split("\0")
    .flatMap((chunk) => chunk.split("\n"))
    .map((line) => line.trimEnd());

  for (const line of lines) {
    if (line.length === 0) {
      finalizeItem(items, current, currentPath);
      current = null;
      continue;
    }

    if (line.startsWith("worktree ")) {
      finalizeItem(items, current, currentPath);
      current = emptyItem(line.slice("worktree ".length), items.length === 0);
      continue;
    }

    if (!current) {
      continue;
    }

    applyWorktreeLine(current, line);
  }

  finalizeItem(items, current, currentPath);
  return items;
}
