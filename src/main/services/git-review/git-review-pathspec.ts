export function createGitReviewExactPathspecs(
  paths: readonly string[]
): string[] {
  if (hasGitReviewExactPathspecConflict(paths)) {
    throw new Error("Git Review 精确 pathspec 存在同目录分量前缀冲突");
  }
  const pathspecs: string[] = [];
  for (const path of paths) {
    const escaped = escapeGitReviewGlobLiteral(path);
    pathspecs.push(`:(top,glob)${escaped}*`);
    pathspecs.push(`:(top,exclude,glob)${escaped}?*`);
  }
  return pathspecs;
}

export function hasGitReviewExactPathspecConflict(
  paths: readonly string[]
): boolean {
  return paths.some((path, index) =>
    paths.some(
      (candidate, candidateIndex) =>
        candidateIndex !== index &&
        candidate.startsWith(path) &&
        !candidate.slice(path.length).includes("/")
    )
  );
}

function escapeGitReviewGlobLiteral(path: string): string {
  return path
    .replaceAll("\\", "\\\\")
    .replaceAll("*", "\\*")
    .replaceAll("?", "\\?")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}
