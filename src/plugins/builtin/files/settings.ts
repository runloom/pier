export const FILES_AUTO_SAVE_SETTING_KEY = "pier.files.autoSave";
export const FILES_EDITOR_MINIMAP_SETTING_KEY = "pier.files.editor.minimap";
export const FILES_AUTO_SAVE_DELAY_MS = 1000;
export const FILES_TREE_SHOW_EXCLUDED_SETTING_KEY =
  "pier.files.tree.showExcludedFiles";
export const FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY =
  "pier.files.tree.excludePatterns";
export const FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY =
  "pier.files.tree.showGitIgnoredFiles";

export { FILES_TREE_DEFAULT_EXCLUDE_PATTERNS } from "@shared/contracts/file/tree-exclude.ts";

export const FILES_EDITOR_WORD_WRAP_SETTING_KEY = "pier.files.editor.wordWrap";
export const FILES_EDITOR_TAB_SIZE_SETTING_KEY = "pier.files.editor.tabSize";
export const FILES_EDITOR_TAB_SIZE_VALUES = ["2", "4", "8"] as const;
export const FILES_EDITOR_DEFAULT_LANGUAGE_SETTING_KEY =
  "pier.files.editor.defaultLanguage";
export const FILES_EDITOR_DEFAULT_LANGUAGE_VALUES = [
  "auto",
  "text",
  "markdown",
  "javascript",
  "typescript",
  "json",
  "css",
  "html",
  "xml",
  "yaml",
  "python",
  "shell",
  "cpp",
  "go",
  "java",
  "kotlin",
  "ruby",
  "rust",
  "sql",
  "swift",
  "toml",
] as const;
export type FilesEditorDefaultLanguage =
  (typeof FILES_EDITOR_DEFAULT_LANGUAGE_VALUES)[number];
export const FILES_EDITOR_DEFAULT_EOL_SETTING_KEY =
  "pier.files.editor.defaultEol";
export const FILES_EDITOR_LSP_ENABLED_SETTING_KEY =
  "pier.files.editor.lspEnabled";
