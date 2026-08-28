import type {
  RendererPluginAction,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { panelContextSchema } from "@shared/contracts/panel.ts";
import {
  FILES_FILE_PANEL_ID,
  FILES_TREE_COLLAPSE_FOLDERS_COMMAND_ID,
  FILES_TREE_EXPAND_ALL_COMMAND_ID,
  FILES_TREE_SEARCH_COMMAND_ID,
  FILES_TREE_TOGGLE_COMMAND_ID,
} from "../../manifest.ts";
import {
  parseTreeBackgroundMetadata,
  parseTreeMetadata,
} from "./action-utils.ts";
import { filePanelProjectRoot, toggleProjectFileTree } from "./preferences.ts";
import {
  collapseFilesTreeFolders,
  expandFilesTreeKnownFolders,
  openFilesTreeSearch,
} from "./registry.ts";

function activeFilesPanelRoot(context: RendererPluginContext): string | null {
  // Prefer dockview instance params.context (matches panel chrome identity).
  // Fall back to active descriptor context when params are missing.
  const activePanelId = context.panels.getActiveInstanceId(FILES_FILE_PANEL_ID);
  if (activePanelId) {
    const instance = context.panels
      .listInstances(FILES_FILE_PANEL_ID)
      .find((entry) => entry.id === activePanelId);
    const params = instance?.params;
    if (params && typeof params === "object" && "context" in params) {
      const parsed = panelContextSchema.safeParse(params.context);
      if (parsed.success) {
        const fromParams = filePanelProjectRoot(parsed.data);
        if (fromParams) {
          return fromParams;
        }
      }
    }
  }
  return filePanelProjectRoot(context.panels.getActiveContext());
}

function resolveTreeActionTarget(
  context: RendererPluginContext,
  invocation: Parameters<RendererPluginAction["handler"]>[0]
): { instanceId?: string; path?: string; root: string } | null {
  const treeItem = parseTreeMetadata(invocation);
  const treeBackground = parseTreeBackgroundMetadata(invocation);
  const root =
    treeItem?.root ??
    treeBackground?.root ??
    filePanelProjectRoot(context.panels.getActiveContext());
  if (!root) {
    return null;
  }
  // Directory row: scope Expand/Collapse All to that folder subtree.
  // File row: use parent directory; background: whole tree (no path).
  let path: string | undefined;
  if (treeItem?.kind === "directory") {
    path = treeItem.path;
  } else if (treeItem?.kind === "file") {
    const slash = treeItem.path.lastIndexOf("/");
    path = slash < 0 ? undefined : treeItem.path.slice(0, slash);
  }
  const treeId = treeItem?.treeId ?? treeBackground?.treeId;
  if (treeId) {
    return { instanceId: treeId, ...(path ? { path } : {}), root };
  }
  const activePanelId = context.panels.getActiveInstanceId(FILES_FILE_PANEL_ID);
  if (activePanelId) {
    return { instanceId: activePanelId, ...(path ? { path } : {}), root };
  }
  return { ...(path ? { path } : {}), root };
}

export function createTreeSearchAction(
  context: RendererPluginContext
): RendererPluginAction {
  const t = (key: string, fallback?: string) =>
    context.i18n.t(key, undefined, fallback);
  return {
    category: "file",
    handler: async () => {
      // 从当前活动 panel 的上下文解析项目根;命令面板只能定位当前活动
      // files panel 所在 group,缺 active panel/group 时静默 no-op。
      const root = filePanelProjectRoot(context.panels.getActiveContext());
      const activePanelId =
        context.panels.getActiveInstanceId(FILES_FILE_PANEL_ID);
      if (!(root && activePanelId)) {
        return;
      }
      const groupId = context.panels
        .listInstances(FILES_FILE_PANEL_ID)
        .find((instance) => instance.id === activePanelId)?.groupId;
      if (!groupId) {
        return;
      }
      openFilesTreeSearch({ instanceId: groupId, root });
      return await Promise.resolve();
    },
    id: FILES_TREE_SEARCH_COMMAND_ID,
    metadata: { group: "2_view", sortOrder: 1 },
    // 树内快捷键 / 控件触发；不进命令面板。
    surfaces: [],
    title: () => t("filePanel.tree.action.search", "Find in File Tree"),
  };
}

export function createTreeToggleAction(
  context: RendererPluginContext
): RendererPluginAction {
  const t = (key: string, fallback?: string) =>
    context.i18n.t(key, undefined, fallback);
  return {
    category: "file",
    handler: async () => {
      if (!toggleProjectFileTree(activeFilesPanelRoot(context))) {
        context.notifications.info(
          t("filePanel.tree.toggleUnavailable", "Open a project folder first.")
        );
      }
      return await Promise.resolve();
    },
    id: FILES_TREE_TOGGLE_COMMAND_ID,
    metadata: {
      group: "2_view",
      shortcutSourceId: "pier.view.toggleSideTree",
      sortOrder: 0,
    },
    // Invoked from global pier.view.toggleSideTree (including terminals).
    surfaces: [],
    title: () => t("filePanel.tree.toggle", "Toggle File Tree"),
  };
}

export function createTreeExpandAllAction(
  context: RendererPluginContext
): RendererPluginAction {
  const t = (key: string, fallback?: string) =>
    context.i18n.t(key, undefined, fallback);
  return {
    category: "file",
    handler: async (invocation) => {
      const target = resolveTreeActionTarget(context, invocation);
      if (!target) {
        return;
      }
      expandFilesTreeKnownFolders(target);
      return await Promise.resolve();
    },
    id: FILES_TREE_EXPAND_ALL_COMMAND_ID,
    metadata: {
      group: "2_view",
      // 文件行不显示展开/折叠（落到父目录语义不清晰）；空白与目录保留。
      menuHidden: (invocation) =>
        parseTreeMetadata(invocation)?.kind === "file",
      sortOrder: 1,
    },
    // Context menu only — no default keybinding, no command palette.
    surfaces: ["files/tree-item", "files/tree-background"],
    title: () => t("filePanel.tree.expandAll", "Expand Folders"),
  };
}

export function createTreeCollapseFoldersAction(
  context: RendererPluginContext
): RendererPluginAction {
  const t = (key: string, fallback?: string) =>
    context.i18n.t(key, undefined, fallback);
  return {
    category: "file",
    handler: async (invocation) => {
      // Prefer tree menu metadata; fall back to active panel.
      const target = resolveTreeActionTarget(context, invocation);
      if (!target) {
        return;
      }
      collapseFilesTreeFolders(target);
      return await Promise.resolve();
    },
    id: FILES_TREE_COLLAPSE_FOLDERS_COMMAND_ID,
    metadata: {
      group: "2_view",
      menuHidden: (invocation) =>
        parseTreeMetadata(invocation)?.kind === "file",
      sortOrder: 2,
    },
    // Context menu only — no default keybinding, no command palette.
    surfaces: ["files/tree-item", "files/tree-background"],
    title: () => t("filePanel.tree.collapseAll", "Collapse Folders"),
  };
}
