export const FILES_AUTO_SAVE_SETTING_KEY = "pier.files.autoSave";
export const FILES_EDITOR_MINIMAP_SETTING_KEY = "pier.files.editor.minimap";
export const FILES_AUTO_SAVE_DELAY_MS = 1000;
export const FILES_TREE_SHOW_EXCLUDED_SETTING_KEY =
  "pier.files.tree.showExcludedFiles";
export const FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY =
  "pier.files.tree.excludePatterns";
export const FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY =
  "pier.files.tree.showGitIgnoredFiles";
export const FILES_TREE_COMPACT_FOLDERS_SETTING_KEY =
  "pier.files.tree.compactFolders";
/** Active-file auto-reveal: on | select | off (VS Code explorer.autoReveal analogue). */
export const FILES_TREE_AUTO_REVEAL_SETTING_KEY = "pier.files.tree.autoReveal";
export const FILES_TREE_AUTO_REVEAL_VALUES = ["on", "select", "off"] as const;
export type FilesTreeAutoRevealMode =
  (typeof FILES_TREE_AUTO_REVEAL_VALUES)[number];
/**
 * Multiline globs: active-file auto-reveal skips matching paths.
 * Explicit reveal (breadcrumb / command) ignores this list.
 */
export const FILES_TREE_AUTO_REVEAL_EXCLUDE_SETTING_KEY =
  "pier.files.tree.autoRevealExcludePatterns";
export const FILES_TREE_DEFAULT_AUTO_REVEAL_EXCLUDE_PATTERNS = [
  "**/node_modules",
  "**/bower_components",
].join("\n");

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
  "csharp",
  "go",
  "java",
  "kotlin",
  "ruby",
  "rust",
  "sql",
  "svelte",
  "svg",
  "swift",
  "toml",
  "vue",
] as const;
export type FilesEditorDefaultLanguage =
  (typeof FILES_EDITOR_DEFAULT_LANGUAGE_VALUES)[number];
export const FILES_EDITOR_DEFAULT_EOL_SETTING_KEY =
  "pier.files.editor.defaultEol";
export const FILES_EDITOR_LSP_ENABLED_SETTING_KEY =
  "pier.files.editor.lspEnabled";

/** Markdown preview: max height for fenced code and mermaid diagrams. */
export const FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_SETTING_KEY =
  "pier.files.markdown.blockHeightLimit";
export const FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_VALUES = [
  "none",
  "capped",
] as const;
export type FilesMarkdownBlockHeightLimit =
  (typeof FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_VALUES)[number];

/** Markdown preview body font mode: app UI vs custom family stack. */
export const FILES_MARKDOWN_READING_FONT_SETTING_KEY =
  "pier.files.markdown.readingFont";
export const FILES_MARKDOWN_READING_FONT_VALUES = ["ui", "custom"] as const;
export type FilesMarkdownReadingFont =
  (typeof FILES_MARKDOWN_READING_FONT_VALUES)[number];

/**
 * Primary custom font name(s) when reading font mode is `custom`.
 * Same interaction model as Appearance UI/mono font: user types primary
 * family names; preview merges a document serif fallback chain.
 */
export const FILES_MARKDOWN_READING_FONT_FAMILY_SETTING_KEY =
  "pier.files.markdown.readingFontFamily";
/** Default primary for custom mode (Appearance-style single family name). */
export const FILES_MARKDOWN_READING_FONT_FAMILY_DEFAULT = "Noto Serif SC";

/** Fallback chain after the user's primary custom font(s). */
export const FILES_MARKDOWN_READING_FONT_FAMILY_FALLBACK = [
  "Noto Serif SC",
  "Noto Serif CJK SC",
  "Source Han Serif SC",
  "Songti SC",
  "STSong",
  "SimSun",
  "Noto Serif",
  "Georgia",
  "Times New Roman",
  "serif",
] as const;
