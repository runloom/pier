import type { GitReviewGroup } from "@shared/contracts/git/review.ts";
import { useCallback, useEffect, useRef } from "react";
import type { GitReviewTreeModel } from "../tree.tsx";

export interface ReviewTreeSelectionKey {
  readonly group?: GitReviewGroup;
  readonly kind: "directory" | "file";
  readonly repoPath?: string;
  readonly treePath: string;
}

export function captureReviewTreeSelectionKeys(
  treeModel: GitReviewTreeModel,
  selectedPaths: readonly string[]
): ReviewTreeSelectionKey[] {
  return selectedPaths.map((treePath) => {
    const fileRef = treeModel.getFileRefForTreePath(treePath);
    if (fileRef) {
      return {
        group: fileRef.group,
        kind: "file",
        repoPath: fileRef.path,
        treePath,
      };
    }
    const group = treeModel.getGroupForTreePath(treePath);
    return {
      kind: "directory",
      treePath,
      ...(group === undefined ? {} : { group }),
    };
  });
}

export function commitReviewTreeSelectionRestore(
  selectedPathsRef: { current: readonly string[] },
  treeApi: {
    replaceSelectedPaths: (paths: readonly string[]) => void;
  } | null,
  restored: readonly string[]
): void {
  selectedPathsRef.current = restored;
  treeApi?.replaceSelectedPaths(restored);
}

export function restoreReviewTreeSelectionPaths(
  treeModel: GitReviewTreeModel,
  keys: readonly ReviewTreeSelectionKey[]
): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const path = resolveRestoredTreePath(treeModel, key);
    if (path == null || seen.has(path)) {
      continue;
    }
    seen.add(path);
    next.push(path);
  }
  return next;
}

function resolveRestoredTreePath(
  treeModel: GitReviewTreeModel,
  key: ReviewTreeSelectionKey
): string | null {
  if (key.kind === "file" && key.repoPath != null) {
    for (const item of treeModel.items) {
      if (item.kind !== "file") {
        continue;
      }
      const ref = treeModel.getFileRefForTreePath(item.path);
      if (
        ref &&
        ref.path === key.repoPath &&
        (key.group === undefined || ref.group === key.group)
      ) {
        return item.path;
      }
    }
    for (const item of treeModel.items) {
      if (item.kind !== "file") {
        continue;
      }
      const ref = treeModel.getFileRefForTreePath(item.path);
      if (ref?.path === key.repoPath) {
        return item.path;
      }
    }
    return null;
  }
  if (treeModel.items.some((item) => item.path === key.treePath)) {
    return key.treePath;
  }
  return null;
}

export function useReviewTreeSelectionRebind(
  treeModel: GitReviewTreeModel,
  treeApiRef: {
    readonly current: {
      replaceSelectedPaths: (paths: readonly string[]) => void;
    } | null;
  }
): {
  readonly selectedPathsRef: { current: readonly string[] };
  readonly handleSelectPaths: (paths: string[]) => void;
} {
  const selectedPathsRef = useRef<readonly string[]>([]);
  const keysRef = useRef<ReviewTreeSelectionKey[]>([]);
  const handleSelectPaths = useCallback(
    (paths: string[]) => {
      selectedPathsRef.current = paths;
      keysRef.current = captureReviewTreeSelectionKeys(treeModel, paths);
    },
    [treeModel]
  );
  useEffect(() => {
    const restored = restoreReviewTreeSelectionPaths(
      treeModel,
      keysRef.current
    );
    commitReviewTreeSelectionRestore(
      selectedPathsRef,
      treeApiRef.current,
      restored
    );
  }, [treeApiRef, treeModel]);
  return { handleSelectPaths, selectedPathsRef };
}
