import type { PluginManifest } from "@shared/contracts/plugin.ts";
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
  FILES_TREE_COMPACT_FOLDERS_SETTING_KEY,
  FILES_TREE_DEFAULT_EXCLUDE_PATTERNS,
  FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY,
  FILES_TREE_SHOW_EXCLUDED_SETTING_KEY,
  FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY,
} from "./settings.ts";

export const FILES_PLUGIN_ID = "pier.files";
export const FILES_FILE_PANEL_ID = "pier.files.filePanel";
export const FILES_GROUP_VIEW_CONTENT_ID = "pier.files.groupView";
export const FILES_NEW_FILE_COMMAND_ID = "pier.files.newFile";
export const FILES_NEW_FOLDER_COMMAND_ID = "pier.files.newFolder";
export const FILES_RENAME_COMMAND_ID = "pier.files.rename";
export const FILES_DELETE_COMMAND_ID = "pier.files.delete";
export const FILES_COPY_PATH_COMMAND_ID = "pier.files.copyPath";
export const FILES_COPY_RELATIVE_PATH_COMMAND_ID =
  "pier.files.copyRelativePath";
export const FILES_COPY_PATH_WITH_RANGE_COMMAND_ID =
  "pier.files.copyPathWithRange";
export const FILES_SAVE_COMMAND_ID = "pier.files.save";
export const FILES_SAVE_AS_COMMAND_ID = "pier.files.saveAs";
export const FILES_SAVE_ALL_COMMAND_ID = "pier.files.saveAll";
export const FILES_REVEAL_COMMAND_ID = "pier.files.revealInFinder";
export const FILES_DUPLICATE_COMMAND_ID = "pier.files.duplicate";
export const FILES_TREE_SEARCH_COMMAND_ID = "pier.files.treeSearch";
export const FILES_TREE_COLLAPSE_FOLDERS_COMMAND_ID =
  "pier.files.tree.collapseFolders";
export const FILES_TREE_EXPAND_ALL_COMMAND_ID = "pier.files.tree.expandAll";
export const FILES_QUICK_OPEN_COMMAND_ID = "pier.files.quickOpen";
export const FILES_OPEN_DIRECTORY_COMMAND_ID = "pier.files.openDirectory";
export const FILES_SEARCH_CONTENTS_COMMAND_ID = "pier.files.searchContents";
export const FILES_SEARCH_IN_FOLDER_COMMAND_ID = "pier.files.searchInFolder";
export const FILES_SEARCH_PANEL_ID = "pier.files.searchPanel";

export const FILES_EDITOR_CUT_COMMAND_ID = "pier.files.editor.cut";
export const FILES_EDITOR_COPY_COMMAND_ID = "pier.files.editor.copy";
export const FILES_EDITOR_PASTE_COMMAND_ID = "pier.files.editor.paste";
export const FILES_EDITOR_SELECT_ALL_COMMAND_ID = "pier.files.editor.selectAll";
export const FILES_EDITOR_GO_TO_LINE_COMMAND_ID = "pier.files.editor.goToLine";
export const FILES_EDITOR_SHOW_HOVER_COMMAND_ID = "pier.files.editor.showHover";

export const FILES_MARKDOWN_MEASURE_COMFORTABLE_COMMAND_ID =
  "pier.files.markdown.measureComfortable";
export const FILES_MARKDOWN_MEASURE_WIDE_COMMAND_ID =
  "pier.files.markdown.measureWide";
export const FILES_MARKDOWN_APPEARANCE_AUTO_COMMAND_ID =
  "pier.files.markdown.appearanceAuto";
export const FILES_MARKDOWN_APPEARANCE_LIGHT_COMMAND_ID =
  "pier.files.markdown.appearanceLight";
export const FILES_MARKDOWN_APPEARANCE_DARK_COMMAND_ID =
  "pier.files.markdown.appearanceDark";

export const FILES_PROJECT_STATUS_ITEM_ID = "pier.files.project";
export const FILES_PLUGIN_MANIFEST = {
  apiVersion: 1,
  commands: [
    {
      category: "file",
      id: FILES_NEW_FILE_COMMAND_ID,
      permissions: ["file:read", "file:write", "panel:open"],
      title: "New File...",
    },
    {
      category: "file",
      id: FILES_NEW_FOLDER_COMMAND_ID,
      permissions: ["file:read", "file:write", "panel:open"],
      title: "New Folder...",
    },
    {
      category: "file",
      id: FILES_RENAME_COMMAND_ID,
      permissions: ["file:read", "file:write"],
      title: "Rename...",
    },
    {
      category: "file",
      id: FILES_DELETE_COMMAND_ID,
      permissions: ["file:write"],
      title: "Delete",
    },
    {
      category: "file",
      id: FILES_COPY_PATH_COMMAND_ID,
      permissions: [],
      title: "Copy Path",
    },
    {
      category: "file",
      id: FILES_COPY_RELATIVE_PATH_COMMAND_ID,
      permissions: [],
      title: "Copy Relative Path",
    },
    {
      category: "file",
      id: FILES_COPY_PATH_WITH_RANGE_COMMAND_ID,
      permissions: [],
      title: "Copy Path and Selected Lines",
    },
    {
      category: "file",
      id: FILES_SAVE_COMMAND_ID,
      permissions: ["file:write"],
      title: "Save",
    },
    {
      category: "file",
      id: FILES_SAVE_AS_COMMAND_ID,
      permissions: ["file:write"],
      title: "Save As...",
    },
    {
      category: "file",
      id: FILES_SAVE_ALL_COMMAND_ID,
      permissions: ["file:write"],
      title: "Save All",
    },
    {
      category: "file",
      id: FILES_REVEAL_COMMAND_ID,
      permissions: ["file:read"],
      title: "Reveal in Finder",
    },
    {
      category: "file",
      id: FILES_DUPLICATE_COMMAND_ID,
      permissions: ["file:read", "file:write"],
      title: "Duplicate",
    },
    {
      category: "file",
      id: FILES_TREE_SEARCH_COMMAND_ID,
      permissions: [],
      title: "Find in File Tree",
    },
    {
      category: "file",
      id: FILES_TREE_EXPAND_ALL_COMMAND_ID,
      permissions: [],
      title: "Expand Folders",
    },
    {
      category: "file",
      id: FILES_TREE_COLLAPSE_FOLDERS_COMMAND_ID,
      permissions: [],
      title: "Collapse Folders",
    },
    {
      category: "file",
      id: FILES_QUICK_OPEN_COMMAND_ID,
      permissions: ["file:read", "panel:open"],
      title: "Go to File",
    },
    {
      category: "file",
      id: FILES_OPEN_DIRECTORY_COMMAND_ID,
      permissions: ["file:read", "panel:open"],
      title: "Open Directory",
    },
    {
      category: "file",
      id: FILES_SEARCH_CONTENTS_COMMAND_ID,
      permissions: ["file:read", "panel:open"],
      title: "Search in Files",
    },
    {
      category: "file",
      id: FILES_SEARCH_IN_FOLDER_COMMAND_ID,
      permissions: ["file:read", "panel:open"],
      title: "Find in Folder…",
    },

    {
      category: "file",
      id: FILES_EDITOR_CUT_COMMAND_ID,
      permissions: [],
      title: "Cut",
    },
    {
      category: "file",
      id: FILES_EDITOR_COPY_COMMAND_ID,
      permissions: [],
      title: "Copy",
    },
    {
      category: "file",
      id: FILES_EDITOR_PASTE_COMMAND_ID,
      permissions: [],
      title: "Paste",
    },
    {
      category: "file",
      id: FILES_EDITOR_SELECT_ALL_COMMAND_ID,
      permissions: [],
      title: "Select All",
    },
    {
      category: "file",
      id: FILES_EDITOR_GO_TO_LINE_COMMAND_ID,
      permissions: [],
      title: "Go to Line…",
    },
    {
      category: "file",
      id: FILES_EDITOR_SHOW_HOVER_COMMAND_ID,
      permissions: [],
      title: "Show Symbol Information",
    },
    {
      category: "file",
      id: FILES_MARKDOWN_MEASURE_COMFORTABLE_COMMAND_ID,
      permissions: [],
      title: "Comfortable reading",
    },
    {
      category: "file",
      id: FILES_MARKDOWN_MEASURE_WIDE_COMMAND_ID,
      permissions: [],
      title: "Wide reading",
    },
    {
      category: "file",
      id: FILES_MARKDOWN_APPEARANCE_AUTO_COMMAND_ID,
      permissions: [],
      title: "Match app appearance",
    },
    {
      category: "file",
      id: FILES_MARKDOWN_APPEARANCE_LIGHT_COMMAND_ID,
      permissions: [],
      title: "Light reading",
    },
    {
      category: "file",
      id: FILES_MARKDOWN_APPEARANCE_DARK_COMMAND_ID,
      permissions: [],
      title: "Dark reading",
    },
  ],
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
          "Go",
          "Java",
          "Kotlin",
          "Ruby",
          "Rust",
          "SQL",
          "Swift",
          "TOML",
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
        default: true,
        description:
          "Show files and folders matched by Git ignore rules. This is separate from the file tree exclusion patterns.",
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
    },
  },
  workbenchWidgets: [],
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
      "zh-CN": "locales/zh-CN.json",
    },
    locales: ["en", "zh-CN"],
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
    "git:read",
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
