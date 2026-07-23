import type {
  PierFileTreeGitStatus,
  PierFileTreeItem,
} from "@pier/ui/file-tree.tsx";
import type {
  GitReviewFileStatus,
  GitReviewGroup,
  GitReviewIndexEntry,
} from "@shared/contracts/git-review.ts";
import {
  type GitReviewTreeFileRef,
  makeReviewTreeNodeId,
} from "./git-review-tree-section.ts";

export type { GitReviewTreeFileRef } from "./git-review-tree-section.ts";
export {
  makeReviewTreeNodeId,
  parseReviewTreeNodeId,
} from "./git-review-tree-section.ts";

/**
 * Tree + diff display order for uncommitted groups (VS Code SCM):
 * conflict → staged → unstaged. committed is commit/branch scope only.
 */
const TREE_GROUP_ORDER = [
  "conflict",
  "staged",
  "unstaged",
  "committed",
] as const satisfies readonly GitReviewGroup[];

/**
 * Invisible sort key so pierre path sort keeps TREE_GROUP_ORDER even when the
 * visible basename is a localized label (e.g. 暂存的更改 before 更改 in zh).
 * Basename for display is still the full string; control chars typically render empty.
 */
const GROUP_SORT_PREFIX: Record<GitReviewGroup, string> = {
  conflict: "\u0001",
  staged: "\u0002",
  unstaged: "\u0003",
  committed: "\u0004",
};

export interface GitReviewTreeGroupLabels {
  /** commit/branch scope only; falls back when omitted. */
  readonly committed?: string;
  readonly conflict: string;
  readonly staged: string;
  readonly unstaged: string;
}

export interface GitReviewTreeModel {
  entryByKey: ReadonlyMap<string, GitReviewIndexEntry>;
  fileRefByNodeId: ReadonlyMap<string, GitReviewTreeFileRef>;
  getFileRefForTreePath: (path: string) => GitReviewTreeFileRef | undefined;
  /**
   * File refs under a tree path: the file itself, or every file descendant of a
   * directory / group root (used by context-menu stage/unstage).
   */
  getFileRefsUnderTreePath: (path: string) => readonly GitReviewTreeFileRef[];
  /** Stable group id for a tree path under a group root (including the root). */
  getGroupForTreePath: (path: string) => GitReviewGroup | undefined;
  groupCounts: {
    conflict: number;
    unstaged: number;
    staged: number;
  };
  items: PierFileTreeItem[];
}

function treeStatus(status: GitReviewFileStatus): PierFileTreeGitStatus {
  return status === "conflicted" ? "modified" : status;
}

function inheritedStatus(status: PierFileTreeGitStatus): PierFileTreeGitStatus {
  return status === "added" || status === "untracked" ? status : "modified";
}

interface SlotRow {
  entry: GitReviewIndexEntry;
  group: GitReviewGroup;
  path: string;
  sectionKey: string;
  status: GitReviewFileStatus;
}

export function gitReviewTreeModel(
  entries: readonly GitReviewIndexEntry[],
  collidingFileLabel: (name: string) => string,
  groupLabels: GitReviewTreeGroupLabels
): GitReviewTreeModel {
  const entryByKey = new Map<string, GitReviewIndexEntry>();
  const slotsByGroup = new Map<GitReviewGroup, SlotRow[]>();
  for (const group of TREE_GROUP_ORDER) {
    slotsByGroup.set(group, []);
  }

  for (const entry of entries) {
    entryByKey.set(entry.entryKey, entry);
    for (const slot of entry.renderSlots) {
      if (!slotsByGroup.has(slot.group)) {
        continue;
      }
      slotsByGroup.get(slot.group)?.push({
        entry,
        group: slot.group,
        path: slot.targetPath,
        sectionKey: slot.sectionKey,
        status: slot.status,
      });
    }
  }

  const items = new Map<string, PierFileTreeItem>();
  const fileRefByNodeId = new Map<string, GitReviewTreeFileRef>();
  const fileRefByTreePath = new Map<string, GitReviewTreeFileRef>();
  const groupRootByGroup = new Map<GitReviewGroup, string>();
  const groupCounts = { conflict: 0, unstaged: 0, staged: 0 };

  for (const group of TREE_GROUP_ORDER) {
    const rows = slotsByGroup.get(group) ?? [];
    if (rows.length === 0) {
      continue;
    }
    if (group === "conflict" || group === "unstaged" || group === "staged") {
      groupCounts[group] = rows.length;
    }
    // Visible name = last path segment. Prefix with an invisible sort key so
    // localized labels (zh: 暂存的更改 vs 更改) cannot invert group order.
    const baseLabel = sanitizeTreeSegment(
      group === "committed"
        ? (groupLabels.committed ?? "Files")
        : groupLabels[group]
    );
    let groupRoot = `${GROUP_SORT_PREFIX[group]}${baseLabel}`;
    if (
      items.has(groupRoot) ||
      [...groupRootByGroup.values()].includes(groupRoot)
    ) {
      groupRoot = `${GROUP_SORT_PREFIX[group]}${baseLabel} (${group})`;
    }
    groupRootByGroup.set(group, groupRoot);
    items.set(groupRoot, {
      hasChildren: true,
      kind: "directory",
      loadState: "loaded",
      path: groupRoot,
    });

    const reservedPaths = new Set(rows.map((row) => row.path));
    const directoryPaths = new Set<string>();
    for (const row of rows) {
      for (const directory of ancestorDirectories(row.path)) {
        directoryPaths.add(directory);
        reservedPaths.add(directory);
      }
    }

    const sortedRows = [...rows].sort((left, right) =>
      left.path === right.path
        ? left.sectionKey.localeCompare(right.sectionKey)
        : left.path.localeCompare(right.path)
    );

    for (const row of sortedRows) {
      const status = treeStatus(row.status);
      const displayPath = directoryPaths.has(row.path)
        ? collidingFileDisplayPath(row.path, collidingFileLabel, reservedPaths)
        : row.path;
      const treePath = `${groupRoot}/${displayPath}`;
      const fileRef: GitReviewTreeFileRef = {
        entryKey: row.entry.entryKey,
        group: row.group,
        path: row.path,
        sectionKey: row.sectionKey,
        status: row.status,
      };
      const nodeId = makeReviewTreeNodeId(row.sectionKey);
      fileRefByNodeId.set(nodeId, fileRef);
      fileRefByTreePath.set(treePath, fileRef);

      const relativeSegments = displayPath.split("/");
      relativeSegments.pop();
      let directory = groupRoot;
      for (const segment of relativeSegments) {
        directory = `${directory}/${segment}`;
        const existing = items.get(directory);
        const nextStatus = inheritedStatus(status);
        items.set(directory, {
          gitStatus:
            existing?.gitStatus === undefined ||
            existing.gitStatus === nextStatus
              ? nextStatus
              : "modified",
          hasChildren: true,
          kind: "directory",
          loadState: "loaded",
          path: directory,
        });
      }
      items.set(treePath, {
        gitStatus: status,
        kind: "file",
        path: treePath,
      });
    }
  }

  return {
    entryByKey,
    fileRefByNodeId,
    getFileRefForTreePath: (path: string) => fileRefByTreePath.get(path),
    getFileRefsUnderTreePath: (path: string) => {
      const exact = fileRefByTreePath.get(path);
      if (exact) {
        return [exact];
      }
      const prefix = `${path}/`;
      const refs: GitReviewTreeFileRef[] = [];
      for (const [treePath, fileRef] of fileRefByTreePath) {
        if (treePath.startsWith(prefix)) {
          refs.push(fileRef);
        }
      }
      return refs;
    },
    getGroupForTreePath: (path: string) => {
      for (const group of TREE_GROUP_ORDER) {
        const root = groupRootByGroup.get(group);
        if (root === undefined) {
          continue;
        }
        if (path === root || path.startsWith(`${root}/`)) {
          return group;
        }
      }
      return;
    },
    groupCounts,
    items: [...items.values()],
  };
}

/** Path segment for tree basename; strip separators so labels stay one segment. */
function sanitizeTreeSegment(label: string): string {
  const trimmed = label.trim().replaceAll("/", "∕").replaceAll("\\", "∕");
  return trimmed.length > 0 ? trimmed : "Group";
}

function ancestorDirectories(path: string): string[] {
  const directories: string[] = [];
  let cursor = 0;
  while (true) {
    const slash = path.indexOf("/", cursor);
    if (slash < 0) {
      return directories;
    }
    directories.push(path.slice(0, slash));
    cursor = slash + 1;
  }
}

function collidingFileDisplayPath(
  path: string,
  collidingFileLabel: (name: string) => string,
  reservedPaths: Set<string>
): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const label = collidingFileLabel(name).replaceAll("/", "∕");
  let candidate = `${path}/${label}`;
  let suffix = 2;
  while (reservedPaths.has(candidate)) {
    candidate = `${path}/${label} ${suffix}`;
    suffix += 1;
  }
  reservedPaths.add(candidate);
  return candidate;
}
