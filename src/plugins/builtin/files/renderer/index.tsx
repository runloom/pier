import type {
  RendererPluginAction,
  RendererPluginContext,
  RendererPluginModule,
} from "@plugins/api/renderer.ts";
import { FileText, FolderSearch, FolderTree } from "lucide-react";
import {
  FILES_FILE_PANEL_ID,
  FILES_PLUGIN_ID,
  FILES_SAVE_AS_COMMAND_ID,
  FILES_SAVE_COMMAND_ID,
  FILES_SEARCH_PANEL_ID,
  FILES_TREE_COLLAPSE_FOLDERS_COMMAND_ID,
  FILES_TREE_EXPAND_ALL_COMMAND_ID,
  FILES_TREE_SEARCH_COMMAND_ID,
} from "../manifest.ts";
import {
  abortFilesDraftSuspend,
  commitFilesDraftSuspend,
  flushFilesDraftWrites,
  hydrateFilesDraftRecordFromBackend,
  persistFilesDraftRecord,
  prepareFilesDraftSuspend,
  releaseFilesDraftSuspendAfterDispose,
  removeFilesDraftRecord,
} from "./document/drafts.ts";
import {
  ensureDiskDocument,
  getDocument,
  getDocumentForPanelSource,
  restoreUntitledDocumentFromPanelSource,
} from "./document/store.ts";
import { parseFilesDocumentPanelSource } from "./document/types.ts";
import { createFilesEditorActions } from "./editor/actions.ts";
import { FileEditorController } from "./editor/controller.ts";
import { registerFilesLspNavigationDeps } from "./lsp/navigation.ts";
import { markdownCodeHighlighter } from "./markdown/code-highlighter.ts";
import { createFilesMarkdownPreviewActions } from "./markdown/preview-actions.ts";
import { markdownRuntime } from "./markdown/runtime.ts";
import { FilesMutationSuspendedError } from "./mutation/gate.ts";
import { registerFilesTerminalOpenUrlHandler } from "./open-url/handler.ts";
import { createFilePanel as createFilesFilePanel } from "./panel/index.tsx";
import { hasOtherOpenFilesSourceInstance } from "./panel/instance-utils.ts";
import { clearFilesNavHistory } from "./panel/nav-history.ts";
import { filesPanelTabChrome } from "./panel/tab.ts";
import { createFilesPanelTransferRegistration } from "./panel/transfer-registration.ts";
import { readFilesPanelViewMode } from "./panel/transfer-state.ts";
import { createFilesOpenDirectoryAction } from "./project/open-directory-action.ts";
import { registerFilesProjectStatusItem } from "./project/status-item.tsx";
import { createSaveAllAction } from "./save/all-action.ts";
import {
  createSearchContentsAction,
  createSearchInFolderAction,
} from "./search/actions.ts";
import { createFilesContentSearchPanel } from "./search/panel.tsx";
import { createFilesQuickOpenAction } from "./search/quick-open.ts";
import {
  parseTreeBackgroundMetadata,
  parseTreeMetadata,
} from "./tree/action-utils.ts";
import { createFilesTreeActions } from "./tree/actions.ts";
import { registerFilesDiskOpenTreeReveal } from "./tree/open-disk-reveal.ts";
import { filePanelProjectRoot } from "./tree/preferences.ts";
import {
  clearFileTreeSidebarCache,
  collapseFilesTreeFolders,
  expandFilesTreeKnownFolders,
  openFilesTreeSearch,
} from "./tree/registry.ts";
import { createRevealActiveFileInTreeAction } from "./tree/reveal-active-action.ts";
import { clearFilesTreeStore } from "./tree/store.ts";
import { clearFilesTreeWatchers } from "./tree/watch.ts";
import { FilesWatchHub } from "./watch-hub.ts";

function withFilesMutationGate(
  action: RendererPluginAction,
  controller: FileEditorController
): RendererPluginAction {
  return {
    ...action,
    handler: async (invocation) => {
      try {
        await controller.runMutation(() => action.handler(invocation));
      } catch (error) {
        if (!(error instanceof FilesMutationSuspendedError)) {
          throw error;
        }
      }
    },
  };
}

function createSaveAction(
  context: RendererPluginContext,
  controller: FileEditorController
): RendererPluginAction {
  const t = (key: string, fallback?: string) =>
    context.i18n.t(key, undefined, fallback);
  return {
    category: "file",
    handler: async () => {
      // 只有 files 面板处于 active 时 keybinding scope 才会 resolve 到这里；
      // 其它 panel active 时 activeInstanceId 可能为 null，静默 no-op。
      const panelId = context.panels.getActiveInstanceId(FILES_FILE_PANEL_ID);
      await controller.savePanel(panelId);
    },
    id: FILES_SAVE_COMMAND_ID,
    metadata: { group: "5_save", sortOrder: 1 },
    // 快捷键 Cmd+S 主路径；不进命令面板（文件类仅保留转到文件 / 打开目录）。
    surfaces: [],
    title: () => t("filePanel.save", "Save"),
  };
}

function createSaveAsAction(
  context: RendererPluginContext,
  controller: FileEditorController
): RendererPluginAction {
  const t = (key: string, fallback?: string) =>
    context.i18n.t(key, undefined, fallback);
  return {
    category: "file",
    handler: async () => {
      await controller.saveAsPanel(
        context.panels.getActiveInstanceId(FILES_FILE_PANEL_ID)
      );
    },
    id: FILES_SAVE_AS_COMMAND_ID,
    metadata: { group: "5_save", sortOrder: 2 },
    // 快捷键路径；不进命令面板。
    surfaces: [],
    title: () => t("filePanel.saveAs", "Save As…"),
  };
}

function createTreeSearchAction(
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

function createTreeExpandAllAction(
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
    metadata: { group: "2_view", sortOrder: 1 },
    // Context menu only — no default keybinding, no command palette.
    surfaces: ["files/tree-item", "files/tree-background"],
    title: () => t("filePanel.tree.expandAll", "Expand Folders"),
  };
}

function createTreeCollapseFoldersAction(
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
    metadata: { group: "2_view", sortOrder: 2 },
    // Context menu only — no default keybinding, no command palette.
    surfaces: ["files/tree-item", "files/tree-background"],
    title: () => t("filePanel.tree.collapseAll", "Collapse Folders"),
  };
}

function registerDirtyCloseGuard(
  context: RendererPluginContext,
  controller: FileEditorController
): () => void {
  return context.panels.registerCloseGuard(
    FILES_FILE_PANEL_ID,
    async (input) => {
      const source = parseFilesDocumentPanelSource(input.params);
      if (!source) {
        return true;
      }
      const document = getDocumentForPanelSource(source);
      if (
        !(
          document &&
          (document.dirty || document.needsSaveAs || document.durabilityUnknown)
        )
      ) {
        return true;
      }
      if (
        hasOtherOpenFilesSourceInstance({
          context,
          ...(input.closingPanelIds
            ? { closingPanelIds: input.closingPanelIds }
            : {}),
          panelId: input.panelId,
          source,
        })
      ) {
        return true;
      }
      // VS Code 语义:标题点名文件、问「要不要保存」;主按钮 = 保存,
      // 「不保存」是普通次按钮(非破坏性红色),Esc/取消 = 保持打开。
      const choice = await context.dialogs.choice({
        altLabel: context.i18n.t(
          "filePanel.saveOnClose.dontSaveLabel",
          undefined,
          "Don't Save"
        ),
        body: context.i18n.t(
          "filePanel.saveOnClose.body",
          undefined,
          "Your changes will be lost if you don't save them."
        ),
        cancelLabel: context.i18n.t(
          "filePanel.saveOnClose.cancelLabel",
          undefined,
          "Cancel"
        ),
        confirmLabel: context.i18n.t(
          "filePanel.saveOnClose.saveLabel",
          undefined,
          "Save"
        ),
        intent: "default",
        title: context.i18n.t(
          "filePanel.saveOnClose.title",
          { name: document.name },
          'Do you want to save the changes made to "{{name}}"?'
        ),
      });
      if (choice === "cancel") {
        return false;
      }
      if (choice === "alt") {
        // 不保存 = 丢弃本次会话:移除文档与 hot-exit 草稿,重开时从磁盘新读。
        controller.discardDocument(document.id);
        return true;
      }
      try {
        await controller.runMutation(() =>
          controller.settleDocument(document.id, input.panelId, "failure")
        );
      } catch (error) {
        if (error instanceof FilesMutationSuspendedError) {
          return false;
        }
        throw error;
      }
      const latest = getDocumentForPanelSource(source);
      // 保存失败(冲突取消/IO 错误)时保持面板打开。
      return latest
        ? !(latest.dirty || latest.needsSaveAs || latest.durabilityUnknown)
        : true;
    }
  );
}

export const filesRendererPlugin: RendererPluginModule = {
  activate: (context) => {
    const t = (key: string, fallback?: string) =>
      context.i18n.t(key, undefined, fallback);
    const watchHub = new FilesWatchHub(context.files);
    const editorController = new FileEditorController(context, watchHub);
    editorController.initialize().catch((error: unknown) => {
      console.error("[files] draft backend initialization failed:", error);
    });
    const disposers = [
      context.lifecycle.beforeSuspend({
        abort: async (_reason, { signal }) => {
          try {
            await abortFilesDraftSuspend(signal);
          } finally {
            editorController.resumeMutations();
            editorController.setEditingSuspended(false);
          }
        },
        commit: async (_reason, { signal }) => {
          await commitFilesDraftSuspend(signal);
        },
        prepare: async ({ signal }) => {
          editorController.setEditingSuspended(true);
          try {
            await editorController.suspendMutations(signal);
            await prepareFilesDraftSuspend(signal);
          } catch (error) {
            editorController.resumeMutations();
            editorController.setEditingSuspended(false);
            throw error;
          }
        },
      }),
      context.panels.register({
        component: createFilesFilePanel(context, editorController, watchHub),
        icon: FileText,
        id: FILES_FILE_PANEL_ID,
        kind: "web",
        resolveTab: ({ params }) => filesPanelTabChrome(params),
        title: () => t("filePanel.title", "File"),
        transfer: (() => {
          const transfer = editorController.createTransferSupport();
          return createFilesPanelTransferRegistration({
            captureViewSnapshot: (input) =>
              transfer.captureViewSnapshot(input.documentId),
            discardDocument: (documentId) =>
              editorController.discardDocument(documentId),
            ensureDiskDocument,
            flushFilesDraftWrites,
            getDocument,
            getDocumentForPanelSource,
            getPanelSource: (panelId) =>
              editorController.getPanelSource(panelId),
            hydrateDraftKey: hydrateFilesDraftRecordFromBackend,
            persistFilesDraftRecord,
            readFilesPanelViewMode,
            removeFilesDraftRecord,
            restoreUntitledDocumentFromPanelSource,
            resumeTransferMutations: (scope) =>
              transfer.resumeTransferMutations(scope),
            suspendTransferMutations: (scope, signal) =>
              transfer.suspendTransferMutations(scope, signal),
          });
        })(),
      }),
      context.panels.register({
        component: createFilesContentSearchPanel(context, editorController),
        icon: FolderSearch,
        id: FILES_SEARCH_PANEL_ID,
        kind: "web",
        title: () => t("filePanel.contentSearch.title", "Search in Files"),
      }),
      registerDirtyCloseGuard(context, editorController),
      context.actions.register(
        withFilesMutationGate(
          createSaveAction(context, editorController),
          editorController
        )
      ),
      context.actions.register(
        withFilesMutationGate(
          createSaveAsAction(context, editorController),
          editorController
        )
      ),
      context.actions.register(
        withFilesMutationGate(
          createSaveAllAction(context, editorController),
          editorController
        )
      ),
      context.actions.register(createFilesQuickOpenAction(context)),
      context.actions.register(createFilesOpenDirectoryAction(context)),
      context.actions.register(createSearchContentsAction(context)),
      context.actions.register(createSearchInFolderAction(context)),
      context.actions.register(
        withFilesMutationGate(createTreeSearchAction(context), editorController)
      ),
      context.actions.register(createRevealActiveFileInTreeAction(context)),
      context.actions.register(createTreeExpandAllAction(context)),
      context.actions.register(createTreeCollapseFoldersAction(context)),
      ...createFilesTreeActions(context, editorController).map((action) =>
        context.actions.register(
          withFilesMutationGate(action, editorController)
        )
      ),
      ...createFilesEditorActions(context, editorController).map((action) =>
        context.actions.register(
          withFilesMutationGate(action, editorController)
        )
      ),
      ...createFilesMarkdownPreviewActions(context).map((action) =>
        context.actions.register(action)
      ),
      registerFilesProjectStatusItem(context),
      registerFilesTerminalOpenUrlHandler(context, editorController),
      registerFilesLspNavigationDeps({
        context,
        controller: editorController,
      }),
      // Git review / host openInEditor → project tree reveal (explicit center).
      registerFilesDiskOpenTreeReveal(context),
    ];

    return () => {
      for (const dispose of disposers.toReversed()) {
        dispose();
      }
      clearFilesTreeWatchers();
      editorController.dispose({ clearDocuments: true });
      releaseFilesDraftSuspendAfterDispose();
      watchHub.dispose();
      clearFilesTreeStore();
      clearFilesNavHistory();
      clearFileTreeSidebarCache();
      // 释放 markdown 单例 worker，避免插件重载时孤儿 Worker 累积。
      markdownRuntime.dispose();
      markdownCodeHighlighter.dispose();
    };
  },
  // 设置页(插件行/插件导航项)读取此图标;module 自描述,宿主不再按 id 特判。
  icon: FolderTree,
  id: FILES_PLUGIN_ID,
};
