/**
 * Commands: open content search panel and tree "Find in Folder".
 */
import type {
  RendererPluginAction,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import {
  FILES_SEARCH_CONTENTS_COMMAND_ID,
  FILES_SEARCH_IN_FOLDER_COMMAND_ID,
  FILES_SEARCH_PANEL_ID,
} from "../manifest.ts";
import {
  parseTreeBackgroundMetadata,
  parseTreeMetadata,
} from "./file-tree-action-utils.ts";
import { filePanelProjectRoot } from "./file-tree-preferences.ts";
import {
  conditionsFromPanelParams,
  conditionsToPanelParams,
  DEFAULT_CONTENT_SEARCH_CONDITIONS,
  type FilesContentSearchConditions,
} from "./files-content-search-params.ts";
import { createFilesTranslate } from "./files-i18n.ts";

function resolvePanelContext(
  context: RendererPluginContext
): PanelContext | null {
  return context.panels.getActiveContext();
}

let openGeneration = 0;

function existingSearchPanelParams(
  context: RendererPluginContext
): unknown | null {
  const instance = context.panels
    .listInstances(FILES_SEARCH_PANEL_ID)
    .find((entry) => entry.id === FILES_SEARCH_PANEL_ID);
  return instance?.params ?? null;
}

function openSearchPanel(input: {
  context: RendererPluginContext;
  panelContext: PanelContext | null;
  query?: string;
  root: string;
  /**
   * Find-in-folder: set/clear scope while preserving query/toggles when the
   * panel is already open. `undefined` with scopeOnly clears scope.
   */
  scopeDir?: string;
  scopeOnly?: boolean;
}): void {
  const t = createFilesTranslate(input.context);
  openGeneration += 1;

  const existingParams = existingSearchPanelParams(input.context);
  const previous =
    existingParams === null
      ? null
      : conditionsFromPanelParams(existingParams, input.root);

  let conditions: FilesContentSearchConditions;
  if (previous && !input.scopeOnly && input.query === undefined) {
    // Cmd+Shift+F / Search in Files while panel is live: focus only, keep UI state.
    conditions = { ...previous, root: input.root };
  } else if (previous && input.scopeOnly) {
    // Find in Folder: keep query/options, apply new scope (or clear).
    conditions = {
      ...previous,
      root: input.root,
      scopeDir: input.scopeDir,
    };
  } else {
    conditions = {
      ...DEFAULT_CONTENT_SEARCH_CONDITIONS,
      query: input.query ?? "",
      root: input.root,
      scopeDir: input.scopeDir,
    };
  }

  const params = {
    ...conditionsToPanelParams(conditions),
    openGeneration,
  };

  input.context.panels.openInstance({
    componentId: FILES_SEARCH_PANEL_ID,
    ...(input.panelContext ? { context: input.panelContext } : {}),
    instanceId: FILES_SEARCH_PANEL_ID,
    params,
    title: t("filePanel.contentSearch.title", "Search in Files"),
  });
}

export function createSearchContentsAction(
  context: RendererPluginContext
): RendererPluginAction {
  const t = createFilesTranslate(context);
  return {
    category: "file",
    handler: async () => {
      const panelContext = resolvePanelContext(context);
      const root = filePanelProjectRoot(panelContext);
      if (!root) {
        context.notifications.info(
          t(
            "filePanel.contentSearch.noProject",
            "Open a project to search file contents."
          )
        );
        return;
      }
      openSearchPanel({ context, panelContext, root });
    },
    id: FILES_SEARCH_CONTENTS_COMMAND_ID,
    metadata: { group: "2_view", sortOrder: 2 },
    // 快捷键主路径；不进命令面板（文件类仅保留转到文件 / 打开目录）。
    surfaces: [],
    title: () => t("filePanel.contentSearch.command", "Search in Files"),
  };
}

export function createSearchInFolderAction(
  context: RendererPluginContext
): RendererPluginAction {
  const t = createFilesTranslate(context);
  return {
    category: "file",
    handler: async (invocation) => {
      const treeItem = parseTreeMetadata(invocation);
      const background = parseTreeBackgroundMetadata(invocation);
      const panelContext = resolvePanelContext(context);

      if (treeItem?.kind === "directory") {
        openSearchPanel({
          context,
          panelContext,
          root: treeItem.root,
          scopeDir: treeItem.path,
          scopeOnly: true,
        });
        return;
      }
      if (background) {
        openSearchPanel({
          context,
          panelContext,
          root: background.root,
          scopeOnly: true,
        });
        return;
      }
      if (treeItem?.kind === "file") {
        const slash = treeItem.path.lastIndexOf("/");
        const parent = slash >= 0 ? treeItem.path.slice(0, slash) : undefined;
        openSearchPanel({
          context,
          panelContext,
          root: treeItem.root,
          ...(parent ? { scopeDir: parent } : {}),
          scopeOnly: true,
        });
        return;
      }

      const root = filePanelProjectRoot(panelContext);
      if (!root) {
        context.notifications.info(
          t(
            "filePanel.contentSearch.noProject",
            "Open a project to search file contents."
          )
        );
        return;
      }
      openSearchPanel({ context, panelContext, root });
    },
    id: FILES_SEARCH_IN_FOLDER_COMMAND_ID,
    metadata: { group: "2_view", sortOrder: 3 },
    surfaces: ["files/tree-item", "files/tree-background"],
    title: () => t("filePanel.contentSearch.findInFolder", "Find in Folder…"),
  };
}
