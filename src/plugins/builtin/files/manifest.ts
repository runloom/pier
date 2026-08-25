import type { PluginManifest } from "@shared/contracts/plugin.ts";
import {
  FILES_FILE_PANEL_ID,
  FILES_GROUP_VIEW_CONTENT_ID,
  FILES_PLUGIN_ID,
  FILES_PROJECT_STATUS_ITEM_ID,
  FILES_SEARCH_PANEL_ID,
} from "./command-ids.ts";
import { FILES_PLUGIN_COMMANDS } from "./manifest-commands.ts";
import {
  FILES_AUTO_SAVE_SETTING_KEY,
  FILES_EDITOR_DEFAULT_EOL_SETTING_KEY,
  FILES_EDITOR_DEFAULT_LANGUAGE_SETTING_KEY,
  FILES_EDITOR_DEFAULT_LANGUAGE_VALUES,
  FILES_EDITOR_LSP_ENABLED_SETTING_KEY,
  FILES_EDITOR_MINIMAP_SETTING_KEY,
  FILES_EDITOR_TAB_SIZE_SETTING_KEY,
  FILES_EDITOR_TAB_SIZE_VALUES,
  FILES_EDITOR_WORD_WRAP_SETTING_KEY,
  FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_SETTING_KEY,
  FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_VALUES,
  FILES_TREE_AUTO_REVEAL_EXCLUDE_SETTING_KEY,
  FILES_TREE_AUTO_REVEAL_SETTING_KEY,
  FILES_TREE_AUTO_REVEAL_VALUES,
  FILES_TREE_COMPACT_FOLDERS_SETTING_KEY,
  FILES_TREE_DEFAULT_AUTO_REVEAL_EXCLUDE_PATTERNS,
  FILES_TREE_DEFAULT_EXCLUDE_PATTERNS,
  FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY,
  FILES_TREE_SHOW_EXCLUDED_SETTING_KEY,
  FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY,
} from "./settings.ts";

export * from "./command-ids.ts";

export const FILES_PLUGIN_MANIFEST = {
  apiVersion: 1,
  commands: FILES_PLUGIN_COMMANDS,
  configuration: {
    properties: {
      [FILES_AUTO_SAVE_SETTING_KEY]: {
        default: false,
        description:
          "Automatically save dirty files one second after the last edit. Conflicts with external changes still go through the overwrite/compare dialog.",
        order: 10,
        type: "boolean",
      },
      [FILES_EDITOR_MINIMAP_SETTING_KEY]: {
        default: true,
        description:
          "Show a minimap overview on the right side of the source editor.",
        order: 15,
        type: "boolean",
      },
      [FILES_EDITOR_WORD_WRAP_SETTING_KEY]: {
        default: false,
        description: "Wrap long lines in the source editor.",
        order: 16,
        type: "boolean",
      },
      [FILES_EDITOR_TAB_SIZE_SETTING_KEY]: {
        default: FILES_EDITOR_TAB_SIZE_VALUES[0],
        description:
          "Number of spaces used for a tab character in the source editor.",
        enum: [...FILES_EDITOR_TAB_SIZE_VALUES],
        enumDescriptions: ["2 spaces", "4 spaces", "8 spaces"],
        order: 17,
        type: "string",
      },
      [FILES_EDITOR_DEFAULT_EOL_SETTING_KEY]: {
        default: "auto",
        description: "Line ending used when creating new files.",
        enum: ["auto", "lf", "crlf"],
        enumDescriptions: ["Auto", "LF", "CRLF"],
        type: "string",
      },
      [FILES_EDITOR_DEFAULT_LANGUAGE_SETTING_KEY]: {
        default: "auto",
        description:
          "Syntax language used for extensionless or unrecognized files.",
        enum: [...FILES_EDITOR_DEFAULT_LANGUAGE_VALUES],
        // Keep in lockstep with FILES_EDITOR_DEFAULT_LANGUAGE_VALUES (same length).
        enumDescriptions: [
          "Auto",
          "Plain Text",
          "Markdown",
          "JavaScript",
          "TypeScript",
          "JSON",
          "CSS",
          "HTML",
          "XML",
          "YAML",
          "Python",
          "Shell",
          "C/C++",
          "C#",
          "Dart",
          "Dockerfile",
          "Elixir",
          "Go",
          "GraphQL",
          "Java",
          "Kotlin",
          "Lua",
          "PHP",
          "R",
          "Ruby",
          "Rust",
          "Scala",
          "SQL",
          "Astro",
          "Svelte",
          "SVG",
          "Swift",
          "Terraform",
          "TOML",
          "Vue",
          "Zig",
        ],
        order: 19,
        type: "string",
      },
      [FILES_EDITOR_LSP_ENABLED_SETTING_KEY]: {
        default: true,
        description:
          "Show diagnostics, completions, and go to definition when workspace language services are enabled.",
        order: 20,
        type: "boolean",
      },
      [FILES_TREE_SHOW_EXCLUDED_SETTING_KEY]: {
        default: false,
        description: "Show paths matched by the file tree exclusion patterns.",
        order: 20,
        type: "boolean",
      },
      [FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY]: {
        default: FILES_TREE_DEFAULT_EXCLUDE_PATTERNS,
        description:
          "Glob patterns excluded from the file tree when excluded files are not shown. Enter one pattern per line.",
        multiline: true,
        order: 21,
        type: "string",
      },
      [FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY]: {
        default: false,
        description:
          "Show files and folders matched by Git ignore rules. Separate from the exclusion patterns.",
        order: 30,
        type: "boolean",
      },
      [FILES_TREE_COMPACT_FOLDERS_SETTING_KEY]: {
        default: true,
        description:
          "Merge single-child folder chains into one row in the file tree (like VS Code Compact Folders).",
        order: 31,
        type: "boolean",
      },
      [FILES_TREE_AUTO_REVEAL_SETTING_KEY]: {
        default: "on",
        description:
          "When you switch tabs, automatically locate the active file in the project file tree. Open File, Go to Definition, and breadcrumb jumps still locate. Use Reveal Active File in File Tree anytime.",
        enum: [...FILES_TREE_AUTO_REVEAL_VALUES],
        enumDescriptions: [
          "Select and scroll into view when needed",
          "Select only, do not scroll",
          "Do not track tab changes",
        ],
        order: 32,
        type: "string",
      },
      [FILES_TREE_AUTO_REVEAL_EXCLUDE_SETTING_KEY]: {
        default: FILES_TREE_DEFAULT_AUTO_REVEAL_EXCLUDE_PATTERNS,
        description:
          "Glob patterns skipped on tab auto-locate. Open File, Go to Definition, and Reveal Active File still locate. One pattern per line.",
        multiline: true,
        order: 33,
        type: "string",
      },
      // Markdown preview band (after tree) so height/font controls stay grouped.
      [FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_SETTING_KEY]: {
        default: "none",
        description:
          "Whether fenced code blocks and Mermaid diagrams use a max height with inner scroll in Markdown preview. Full height expands with the page.",
        enum: [...FILES_MARKDOWN_BLOCK_HEIGHT_LIMIT_VALUES],
        enumDescriptions: [
          "Full height (no max height)",
          "Limit height (scroll inside the block)",
        ],
        order: 40,
        type: "string",
      },
    },
  },
  workbenchWidgets: [],
  dataProjections: [],
  settingsPages: [],
  groupContent: [
    {
      id: FILES_GROUP_VIEW_CONTENT_ID,
      title: "Files Group View",
    },
  ],
  engines: { pier: ">=0.1.0" },
  id: FILES_PLUGIN_ID,
  localization: {
    defaultLocale: "en",
    files: {
      en: "locales/en.json",
      ja: "locales/ja.json",
      ko: "locales/ko.json",
      "zh-CN": "locales/zh-CN.json",
    },
    locales: ["en", "ja", "ko", "zh-CN"],
  },
  name: "Files",
  panels: [
    {
      component: FILES_FILE_PANEL_ID,
      id: FILES_FILE_PANEL_ID,
      permissions: ["file:read", "file:write"],
      title: "File",
    },
    {
      component: FILES_SEARCH_PANEL_ID,
      id: FILES_SEARCH_PANEL_ID,
      permissions: ["file:read", "panel:open"],
      title: "Search in Files",
    },
  ],
  permissions: [
    "command:register",
    "panel:register",
    "panel:open",
    "file:read",
    "file:write",
    // 画布项目信任门：读状态 + 记录首次预览的信任决定。
    "preferences:read",
    "preferences:write",
    "git:read",
    "comments:read",
    "comments:write",
    "terminal:read",
    "external:open",
  ],
  publisher: "Pier",
  source: { kind: "builtin" },
  terminalStatusItems: [
    {
      alignment: "right",
      id: FILES_PROJECT_STATUS_ITEM_ID,
      order: 9,
      overflowPriority: 40,
      permissions: ["panel:open", "file:read"],
      title: "Project",
    },
  ],
  version: "1.0.0",
} satisfies PluginManifest;
