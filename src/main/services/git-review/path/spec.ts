export function createGitReviewExactPathspecs(
  paths: readonly string[]
): string[] {
  const pathspecs: string[] = [];
  for (const path of paths) {
    const escaped = escapeGitReviewGlobLiteral(path);
    // An escape forces Git's wildcard matcher: a plain literal also matches
    // descendants, whereas this pattern matches only the complete pathname.
    const exact = escaped.startsWith("\\") ? escaped : `\\${escaped}`;
    pathspecs.push(`:(top,glob)${exact}`);
  }
  return pathspecs;
}

function escapeGitReviewGlobLiteral(path: string): string {
  return path
    .replaceAll("\\", "\\\\")
    .replaceAll("*", "\\*")
    .replaceAll("?", "\\?")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}
