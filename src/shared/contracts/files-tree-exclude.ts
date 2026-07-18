/**
 * Default exclude patterns for the Files tree + main-process path query walk.
 *
 * Kept in `@shared/contracts` so both the plugin (renderer) and the main-process
 * walker consume the identical list without cross-layer imports. Design:
 * docs/superpowers/specs/2026-07-17-files-path-query-and-quick-open-design.md §4.2
 */
export const FILES_TREE_DEFAULT_EXCLUDE_PATTERNS = [
  "**/.git",
  "**/.hg",
  "**/.svn",
  "**/CVS",
  "**/.DS_Store",
  "**/Thumbs.db",
].join("\n");
