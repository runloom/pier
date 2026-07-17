export const FILES_AUTO_SAVE_SETTING_KEY = "pier.files.autoSave";
export const FILES_EDITOR_MINIMAP_SETTING_KEY = "pier.files.editor.minimap";
export const FILES_AUTO_SAVE_DELAY_MS = 1000;
export const FILES_TREE_SHOW_EXCLUDED_SETTING_KEY =
  "pier.files.tree.showExcludedFiles";
export const FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY =
  "pier.files.tree.excludePatterns";
export const FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY =
  "pier.files.tree.showGitIgnoredFiles";

export const FILES_TREE_DEFAULT_EXCLUDE_PATTERNS = [
  "**/.git",
  "**/.hg",
  "**/.svn",
  "**/CVS",
  "**/.DS_Store",
  "**/Thumbs.db",
].join("\n");
