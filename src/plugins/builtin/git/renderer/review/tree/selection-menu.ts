import type { GitReviewTreeFileRef, GitReviewTreeModel } from "../tree.tsx";

export function isReviewTreeMultiSelection(
  clickedPath: string,
  selectedPaths: readonly string[]
): boolean {
  return selectedPaths.length > 1 && selectedPaths.includes(clickedPath);
}

export function collectReviewTreeSelectionFileRefs(
  treeModel: GitReviewTreeModel,
  selectedPaths: readonly string[]
): GitReviewTreeFileRef[] {
  const seen = new Set<string>();
  const refs: GitReviewTreeFileRef[] = [];
  for (const path of selectedPaths) {
    for (const ref of treeModel.getFileRefsUnderTreePath(path)) {
      const key = `${ref.group}:${ref.path}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      refs.push(ref);
    }
  }
  return refs;
}

export function reviewTreeCopyPaths(
  refs: readonly GitReviewTreeFileRef[]
): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const ref of refs) {
    if (seen.has(ref.path)) {
      continue;
    }
    seen.add(ref.path);
    paths.push(ref.path);
  }
  return paths;
}
