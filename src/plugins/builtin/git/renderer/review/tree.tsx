import type {
  PierFileTreeGitStatus,
  PierFileTreeItem,
} from "@pier/ui/file/tree.tsx";
import type {
  GitReviewFileStatus,
  GitReviewGroup,
  GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";
import { orderReviewPresentationSlots } from "./document/presentation-order.ts";
import {
  GIT_REVIEW_PRESENTATION_GROUP_ORDER,
  type GitReviewUncommittedGroup,
} from "./surface-group.ts";
import {
  type GitReviewTreeFileRef,
  makeReviewTreeNodeId,
} from "./tree-section.ts";

export type { GitReviewTreeFileRef } from "./tree-section.ts";
export {
  makeReviewTreeNodeId,
  parseReviewTreeNodeId,
} from "./tree-section.ts";

/**
 * Invisible sort key so pierre path sort keeps TREE_GROUP_ORDER even when the
 * visible basename is a localized label (e.g. 已暂存更改 before 更改 in zh).
 * Basename for display is still the full string; control chars typically render empty.
 */
const GROUP_SORT_PREFIX = Object.fromEntries(
  GIT_REVIEW_PRESENTATION_GROUP_ORDER.map((group, index) => [
    group,
    String.fromCharCode(index + 1),
  ])
);

function groupSortPrefix(group: GitReviewGroup): string {
  const prefix = GROUP_SORT_PREFIX[group];
  if (prefix === undefined) {
    throw new Error(`Missing Git review tree sort prefix for ${group}`);
  }
  return prefix;
}

export interface GitReviewTreeGroupLabels {
  /**
   * commit/branch scope group root. Prefer product copy like "Changed Files";
   * bare "Files" is ambiguous next to uncommitted "Changes" / "Staged Changes".
   */
  readonly committed: string;
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
  /**
   * Repo-relative path for copy/reveal. Tree rows nest under a synthetic group
   * root (`Changed Files` / `Changes` / …); strip that prefix. Group roots
   * themselves return null. Collision display rows resolve via fileRef.
   */
  getRepoRelativePath: (treePath: string) => string | null;
  groupCounts: {
    conflict: number;
    unstaged: number;
    staged: number;
  };
  groupLabels: GitReviewTreeGroupLabels;
  items: PierFileTreeItem[];
  mutation: {
    expectedIndexRevision: string | null;
    uncommitted: boolean;
  };
  /**
   * Full presentation ledger (all slots, including meta/notice).
   * Content-bearing subsequence of this order matches CodeView / demand /
   * comment nav when they share the same `collidingFileLabel` and group filter.
   */
  orderedFileRefs: readonly GitReviewTreeFileRef[];
  /** Ordered uncommitted group roots that are actually present in `items`. */
  visibleGroups: readonly GitReviewUncommittedGroup[];
}

function treeStatus(status: GitReviewFileStatus): PierFileTreeGitStatus {
  return status === "conflicted" ? "modified" : status;
}

function inheritedStatus(status: PierFileTreeGitStatus): PierFileTreeGitStatus {
  return status === "added" || status === "untracked" ? status : "modified";
}

export function gitReviewTreeModel(
  entries: readonly GitReviewIndexEntry[],
  collidingFileLabel: (name: string) => string,
  groupLabels: GitReviewTreeGroupLabels,
  mutation: GitReviewTreeModel["mutation"] = {
    expectedIndexRevision: null,
    uncommitted: false,
  }
): GitReviewTreeModel {
  const entryByKey = new Map<string, GitReviewIndexEntry>();
  for (const entry of entries) {
    entryByKey.set(entry.entryKey, entry);
  }

  // Single ordered ledger shared with CodeView (display paths + collision).
  const orderedSlots = orderReviewPresentationSlots(entries, {
    collidingFileLabel,
  });

  const items = new Map<string, PierFileTreeItem>();
  const fileRefByNodeId = new Map<string, GitReviewTreeFileRef>();
  const fileRefByTreePath = new Map<string, GitReviewTreeFileRef>();
  const groupRootByGroup = new Map<GitReviewGroup, string>();
  const groupCounts = { conflict: 0, unstaged: 0, staged: 0 };
  const visibleGroups: GitReviewUncommittedGroup[] = [];
  const orderedFileRefs: GitReviewTreeFileRef[] = [];

  // orderedSlots is already group-ordered; walk once and switch roots.
  let currentGroup: GitReviewGroup | null = null;
  let groupRoot = "";

  for (const row of orderedSlots) {
    if (row.group !== currentGroup) {
      currentGroup = row.group;
      const baseLabel = sanitizeTreeSegment(groupLabels[currentGroup]);
      const sortPrefix = groupSortPrefix(currentGroup);
      groupRoot = `${sortPrefix}${baseLabel}`;
      if (
        items.has(groupRoot) ||
        [...groupRootByGroup.values()].includes(groupRoot)
      ) {
        groupRoot = `${sortPrefix}${baseLabel} (${currentGroup})`;
      }
      groupRootByGroup.set(currentGroup, groupRoot);
      items.set(groupRoot, {
        hasChildren: true,
        kind: "directory",
        loadState: "loaded",
        path: groupRoot,
      });
      if (
        currentGroup === "conflict" ||
        currentGroup === "unstaged" ||
        currentGroup === "staged"
      ) {
        visibleGroups.push(currentGroup);
        groupCounts[currentGroup] = 0;
      }
    }
    if (
      currentGroup === "conflict" ||
      currentGroup === "unstaged" ||
      currentGroup === "staged"
    ) {
      groupCounts[currentGroup] += 1;
    }

    const status = treeStatus(row.status);
    const treePath = `${groupRoot}/${row.displayPath}`;
    const fileRef: GitReviewTreeFileRef = {
      entryKey: row.entryKey,
      group: row.group,
      path: row.path,
      sectionKey: row.sectionKey,
      status: row.status,
    };
    const nodeId = makeReviewTreeNodeId(row.sectionKey);
    fileRefByNodeId.set(nodeId, fileRef);
    fileRefByTreePath.set(treePath, fileRef);
    orderedFileRefs.push(fileRef);

    const relativeSegments = row.displayPath.split("/");
    relativeSegments.pop();
    let directory = groupRoot;
    for (const segment of relativeSegments) {
      directory = `${directory}/${segment}`;
      const existing = items.get(directory);
      const nextStatus = inheritedStatus(status);
      items.set(directory, {
        gitStatus:
          existing?.gitStatus === undefined || existing.gitStatus === nextStatus
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
      for (const group of GIT_REVIEW_PRESENTATION_GROUP_ORDER) {
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
    getRepoRelativePath: (treePath: string) => {
      // Prefer file ref: collision display paths are not real repo paths.
      const fileRef = fileRefByTreePath.get(treePath);
      if (fileRef) {
        return fileRef.path;
      }
      for (const group of GIT_REVIEW_PRESENTATION_GROUP_ORDER) {
        const root = groupRootByGroup.get(group);
        if (root === undefined) {
          continue;
        }
        if (treePath === root) {
          return null;
        }
        if (treePath.startsWith(`${root}/`)) {
          return treePath.slice(root.length + 1);
        }
      }
      return null;
    },
    groupCounts,
    groupLabels,
    items: [...items.values()],
    mutation,
    orderedFileRefs,
    visibleGroups,
  };
}

/** Path segment for tree basename; strip separators so labels stay one segment. */
function sanitizeTreeSegment(label: string): string {
  const trimmed = label.trim().replaceAll("/", "∕").replaceAll("\\", "∕");
  return trimmed.length > 0 ? trimmed : "Group";
}
