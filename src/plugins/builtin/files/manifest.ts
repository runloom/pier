import type { PluginManifest } from "@shared/contracts/plugin.ts";
import {
  FILES_AUTO_SAVE_SETTING_KEY,
  FILES_EDITOR_MINIMAP_SETTING_KEY,
  FILES_TREE_DEFAULT_EXCLUDE_PATTERNS,
  FILES_TREE_EXCLUDE_PATTERNS_SETTING_KEY,
  FILES_TREE_SHOW_EXCLUDED_SETTING_KEY,
  FILES_TREE_SHOW_GIT_IGNORED_SETTING_KEY,
} from "./settings.ts";

export const FILES_PLUGIN_ID = "pier.files";
export const FILES_FILE_PANEL_ID = "pier.files.filePanel";
export const FILES_GROUP_VIEW_CONTENT_ID = "pier.files.groupView";
export const FILES_OPEN_SELECTION_AS_MARKDOWN_COMMAND_ID =
  "pier.files.openSelectionAsMarkdown";
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
export const FILES_EDITOR_CUT_COMMAND_ID = "pier.files.editor.cut";
export const FILES_EDITOR_COPY_COMMAND_ID = "pier.files.editor.copy";
export const FILES_EDITOR_PASTE_COMMAND_ID = "pier.files.editor.paste";
export const FILES_EDITOR_SELECT_ALL_COMMAND_ID = "pier.files.editor.selectAll";

export const FILES_PROJECT_STATUS_ITEM_ID = "pier.files.project";
export const FILES_PLUGIN_MANIFEST = {
  apiVersion: 1,
  commands: [
    {
      category: "file",
      id: FILES_OPEN_SELECTION_AS_MARKDOWN_COMMAND_ID,
      permissions: ["terminal:read", "panel:open"],
      title: "Markdown Preview",
    },
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
      title: "Copy Path with Range",
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
      permissions: ["panel:open", "file:read"],
      title: "Project",
    },
  ],
  version: "1.0.0",
} satisfies PluginManifest;
