import type {
  RendererPluginAction,
  RendererPluginContext,
  RendererPluginModule,
} from "@plugins/api/renderer.ts";
import { FileText, FolderTree } from "lucide-react";
import {
  FILES_FILE_PANEL_ID,
  FILES_OPEN_SELECTION_AS_MARKDOWN_COMMAND_ID,
  FILES_PLUGIN_ID,
  FILES_SAVE_AS_COMMAND_ID,
  FILES_SAVE_COMMAND_ID,
  FILES_TREE_SEARCH_COMMAND_ID,
} from "../manifest.ts";
import { FileEditorController } from "./file-editor-controller.ts";
import { createFilePanel as createFilesFilePanel } from "./file-panel.tsx";
import { createFileFilePanelInstanceId } from "./file-panel-id.ts";
import { createSaveAllAction } from "./file-save-all-action.ts";
import { createFilesTreeActions } from "./file-tree-actions.ts";
import { filePanelProjectRoot } from "./file-tree-preferences.ts";
import {
  abortFilesDraftSuspend,
  commitFilesDraftSuspend,
  flushFilesDraftWrites,
  hydrateFilesDraftRecordFromBackend,
  persistFilesDraftRecord,
  prepareFilesDraftSuspend,
  releaseFilesDraftSuspendAfterDispose,
  removeFilesDraftRecord,
} from "./files-document-drafts.ts";
import {
  ensureDiskDocument,
  getDocument,
  getDocumentForPanelSource,
  restoreUntitledDocumentFromPanelSource,
} from "./files-document-store.ts";
import { parseFilesDocumentPanelSource } from "./files-document-types.ts";
import { createFilesEditorActions } from "./files-editor-actions.ts";
import { FilesMutationSuspendedError } from "./files-mutation-gate.ts";
import { clearFilesNavHistory } from "./files-nav-history.ts";
import { hasOtherOpenFilesSourceInstance } from "./files-panel-instance-utils.ts";
import { filesPanelTabChrome } from "./files-panel-tab.ts";
import { createFilesPanelTransferRegistration } from "./files-panel-transfer.ts";
import { readFilesPanelViewMode } from "./files-panel-transfer-state.ts";
import { registerFilesProjectStatusItem } from "./files-project-status-item.tsx";
import { createFilesQuickOpenAction } from "./files-quick-open.ts";
import { registerFilesTerminalOpenUrlHandler } from "./files-terminal-open-url-handler.ts";
import {
  clearFileTreeSidebarCache,
  openFilesTreeSearch,
} from "./files-tree-registry.ts";
import { clearFilesTreeStore } from "./files-tree-store.ts";
import { clearFilesTreeWatchers } from "./files-tree-watch.ts";
import { FilesWatchHub } from "./files-watch-hub.ts";

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

function createOpenSelectionAsMarkdownAction(
  context: RendererPluginContext,
  controller: FileEditorController
): RendererPluginAction {
  const t = (key: string, fallback?: string) =>
    context.i18n.t(key, undefined, fallback);

  return {
    category: "file",
    handler: async (invocation) => {
      const sourcePanelId = invocation?.sourcePanelId;
      if (!sourcePanelId) {
        context.notifications.info(
          t(
            "files.notifications.noTerminalSelection",
            "Select some text in the terminal first."
          )
        );
        return;
      }

      const result = await context.terminal.readSelectionText(sourcePanelId);
      if (result.kind !== "ok" || result.text.trim().length === 0) {
        context.notifications.info(
          t(
            "files.notifications.noTerminalSelection",
            "Select some text in the terminal first."
          )
        );
        return;
      }

      const document = controller.createUntitledDocument({
        contents: result.text,
        origin: { panelId: sourcePanelId, source: "terminal-selection" },
      });
      if (document.source.kind !== "untitled") {
        return;
      }
      const source = {
        id: document.source.id,
        kind: "untitled" as const,
        name: document.name,
      };

      context.panels.openInstance({
        componentId: FILES_FILE_PANEL_ID,
        ...(invocation?.sourcePanelContext
          ? { context: invocation.sourcePanelContext }
          : {}),
        instanceId: createFileFilePanelInstanceId(source),
        params: {
          // untitled = 用户产生的临时草稿,天然 pinned,不能被 preview 语义
          // 顶掉,否则受保护草稿会随 panel 关闭一并 remove。
          pinned: true,
          source,
        },
        ...(invocation?.sourcePanelGroupId
          ? { targetGroupId: invocation.sourcePanelGroupId }
          : {}),
        title: document.name,
      });
    },
    id: FILES_OPEN_SELECTION_AS_MARKDOWN_COMMAND_ID,
    metadata: { group: "0_edit", sortOrder: 6 },
    surfaces: ["terminal/content"],
    title: () =>
      t("files.actions.openSelectionAsMarkdown.title", "Preview Selected Text"),
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
      // 只有 files 面板处于 active 时 keybinding scope 才会 resolve 到这里,
      // 但 command-palette 也能触发 —— 那种场景下 activeInstanceId 可能为 null
      // (用户在别的 panel 里),此时静默 no-op。
      const panelId = context.panels.getActiveInstanceId(FILES_FILE_PANEL_ID);
      await controller.savePanel(panelId);
    },
    id: FILES_SAVE_COMMAND_ID,
    metadata: { group: "5_save", sortOrder: 1 },
    // command-palette 里能查到,但主要触发方式是 Cmd+S。
    surfaces: ["command-palette"],
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
    surfaces: ["command-palette"],
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
    surfaces: ["command-palette"],
    title: () => t("filePanel.tree.action.search", "Find in File Tree"),
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
        size: "default",
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
      registerDirtyCloseGuard(context, editorController),
      context.actions.register(
        withFilesMutationGate(
          createOpenSelectionAsMarkdownAction(context, editorController),
          editorController
        )
      ),
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
      context.actions.register(
        withFilesMutationGate(createTreeSearchAction(context), editorController)
      ),
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
      registerFilesProjectStatusItem(context),
      registerFilesTerminalOpenUrlHandler(context),
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
    };
  },
  // 设置页(插件行/插件导航项)读取此图标;module 自描述,宿主不再按 id 特判。
  icon: FolderTree,
  id: FILES_PLUGIN_ID,
};
