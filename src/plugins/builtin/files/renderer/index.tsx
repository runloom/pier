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
import {
  createFilesEditorActions,
  createFilesEditorPrefsActions,
} from "./editor/actions.ts";
import { FileEditorController } from "./editor/controller.ts";
import { registerFilesLspNavigationDeps } from "./lsp/navigation.ts";
import { markdownCodeHighlighter } from "./markdown/code-highlighter.ts";
import { migrateLegacyMarkdownReadingFontToDocumentFont } from "./markdown/migrate-doc-font.ts";
import { createFilesMarkdownPreviewActions } from "./markdown/preview-actions.ts";
import {
  bindMarkdownCodeWrapFromConfiguration,
  bindMarkdownSettingsFromConfiguration,
} from "./markdown/preview-preferences.ts";
import { markdownRuntime } from "./markdown/runtime.ts";
import { FilesMutationSuspendedError } from "./mutation/gate.ts";
import { registerFilesTerminalOpenUrlHandler } from "./open-url/handler.ts";
import { createFilePanel as createFilesFilePanel } from "./panel/index.tsx";
import { hasOtherOpenFilesSourceInstance } from "./panel/instance-utils.ts";
import { filesPanelTabChrome } from "./panel/tab.ts";
import { createFilesPanelTransferRegistration } from "./panel/transfer-registration.ts";
import { readFilesPanelViewMode } from "./panel/transfer-state.ts";
import { createFilesOpenDirectoryAction } from "./project/open-directory-action.ts";
import { registerFilesProjectDirectoryReveal } from "./project/open-directory-reveal.ts";
import { registerFilesProjectStatusItem } from "./project/status-item.tsx";
import { createSaveAllAction } from "./save/all-action.ts";
import {
  createSearchContentsAction,
  createSearchInFolderAction,
} from "./search/actions.ts";
import { createFilesSearchResultActions } from "./search/context-actions.ts";
import { createFilesContentSearchPanel } from "./search/panel.tsx";
import { createFilesQuickOpenAction } from "./search/quick-open.ts";
import { createFilesTreeActions } from "./tree/actions.ts";
import { registerFilesDiskOpenLineReveal } from "./tree/open-disk-line.ts";
import { registerFilesDiskOpenPreviewPrefer } from "./tree/open-disk-preview.ts";
import { registerFilesDiskOpenTreeReveal } from "./tree/open-disk-reveal.ts";
import { clearFileTreeSidebarCache } from "./tree/registry.ts";
import { createRevealActiveFileInTreeAction } from "./tree/reveal-active-action.ts";
import { clearFilesTreeStore } from "./tree/store.ts";
import {
  createTreeCollapseFoldersAction,
  createTreeExpandAllAction,
  createTreeSearchAction,
  createTreeToggleAction,
} from "./tree/view-actions.ts";
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
      ...createFilesSearchResultActions(context, editorController).map(
        (action) => context.actions.register(action)
      ),
      context.actions.register(
        withFilesMutationGate(createTreeSearchAction(context), editorController)
      ),
      context.actions.register(createRevealActiveFileInTreeAction(context)),
      context.actions.register(createTreeToggleAction(context)),
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
      ...createFilesEditorPrefsActions(context).map((action) =>
        context.actions.register(action)
      ),
      ...createFilesMarkdownPreviewActions(context).map((action) =>
        context.actions.register(action)
      ),
      bindMarkdownSettingsFromConfiguration(context.configuration),
      bindMarkdownCodeWrapFromConfiguration(context.configuration),
      (() => {
        migrateLegacyMarkdownReadingFontToDocumentFont(context.configuration);
        return () => undefined;
      })(),
      registerFilesProjectStatusItem(context),
      registerFilesTerminalOpenUrlHandler(context, editorController),
      registerFilesLspNavigationDeps({
        context,
        controller: editorController,
      }),
      // Git review / host openInEditor → project tree reveal (explicit center).
      registerFilesDiskOpenTreeReveal(context),
      registerFilesProjectDirectoryReveal(context),
      // openInEditor({ line }) → goToLine after the disk tab opens.
      registerFilesDiskOpenLineReveal(editorController, context),
      // Comment jump / preferPreview → seed preview mode.
      registerFilesDiskOpenPreviewPrefer(),
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
