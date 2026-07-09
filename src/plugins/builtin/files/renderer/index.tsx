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
  FILES_SAVE_COMMAND_ID,
  FILES_TREE_SEARCH_COMMAND_ID,
} from "../manifest.ts";
import { clearCodeMirrorDocumentState } from "./code-mirror-editor.tsx";
import { createFilePanel as createFilesFilePanel } from "./file-panel.tsx";
import { createFileFilePanelInstanceId } from "./file-panel-id.ts";
import {
  type FileConflictChoice,
  saveDiskDocument,
} from "./file-panel-save.ts";
import { triggerFilePanelSave } from "./file-panel-save-registry.ts";
import { createFilesTreeActions } from "./file-tree-actions.ts";
import { filePanelProjectRoot } from "./file-tree-preferences.ts";
import {
  clearFilesDocumentStore,
  configureFilesDraftBackend,
  createUntitledMarkdownDocument,
  getDocumentForPanelSource,
  removeDocument,
} from "./files-document-store.ts";
import { parseFilesDocumentPanelSource } from "./files-document-types.ts";
import { createFilesEditorActions } from "./files-editor-actions.ts";
import { clearFilesEditorViews } from "./files-editor-view-registry.ts";
import { clearFilesNavHistory } from "./files-nav-history.ts";
import { hasOtherOpenFilesSourceInstance } from "./files-panel-instance-utils.ts";
import {
  clearFileTreeSidebarCache,
  openFilesTreeSearch,
} from "./files-tree-registry.ts";
import { clearFilesTreeStore } from "./files-tree-store.ts";
import { clearFilesTreeWatchers } from "./files-tree-watch.ts";

function createOpenSelectionAsMarkdownAction(
  context: RendererPluginContext
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
            "No terminal selection to open."
          )
        );
        return;
      }

      const result = await context.terminal.readSelectionText(sourcePanelId);
      if (result.kind !== "ok" || result.text.trim().length === 0) {
        context.notifications.info(
          t(
            "files.notifications.noTerminalSelection",
            "No terminal selection to open."
          )
        );
        return;
      }

      const document = createUntitledMarkdownDocument({
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
          // 顶掉,否则 localStorage 草稿会随 panel 关闭一并 remove。
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
      t("files.actions.openSelectionAsMarkdown.title", "Markdown Preview"),
  };
}

function createSaveAction(
  context: RendererPluginContext
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
      await triggerFilePanelSave(panelId);
    },
    id: FILES_SAVE_COMMAND_ID,
    metadata: { group: "5_save", sortOrder: 1 },
    // command-palette 里能查到,但主要触发方式是 Cmd+S。
    surfaces: ["command-palette"],
    title: () => t("filePanel.save", "Save"),
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

async function resolveFileSaveConflict(
  context: RendererPluginContext
): Promise<FileConflictChoice> {
  const choice = await context.dialogs.choice({
    altLabel: context.i18n.t(
      "filePanel.conflict.compareLabel",
      undefined,
      "Compare"
    ),
    body: context.i18n.t(
      "filePanel.conflict.body",
      undefined,
      "The file has been modified outside Pier. Overwrite it anyway?"
    ),
    cancelLabel: context.i18n.t(
      "filePanel.conflict.cancelLabel",
      undefined,
      "Cancel"
    ),
    confirmLabel: context.i18n.t(
      "filePanel.conflict.confirmLabel",
      undefined,
      "Overwrite"
    ),
    intent: "destructive",
    size: "sm",
    title: context.i18n.t(
      "filePanel.conflict.title",
      undefined,
      "File changed on disk"
    ),
  });
  if (choice === "confirm") {
    return "overwrite";
  }
  if (choice === "alt") {
    return "compare";
  }
  return "cancel";
}

function registerDirtyCloseGuard(context: RendererPluginContext): () => void {
  return context.panels.registerCloseGuard(
    FILES_FILE_PANEL_ID,
    async (input) => {
      const source = parseFilesDocumentPanelSource(input.params);
      if (!source) {
        return true;
      }
      const document = getDocumentForPanelSource(source);
      if (!document?.dirty) {
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
        size: "sm",
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
        removeDocument(document.id);
        return true;
      }
      // 保存:untitled 文档无处可存(容量契约),按取消处理保护数据。
      if (document.source.kind !== "disk") {
        return false;
      }
      const panelSave = triggerFilePanelSave(input.panelId);
      if (panelSave) {
        await panelSave;
      } else {
        await saveDiskDocument({
          documentId: document.id,
          files: context.files,
          resolveConflict: () => resolveFileSaveConflict(context),
          t: (key, fallback) => context.i18n.t(key, undefined, fallback),
        });
      }
      const latest = getDocumentForPanelSource(source);
      // 保存失败(冲突取消/IO 错误)时保持面板打开。
      return latest ? !latest.dirty : true;
    }
  );
}

export const filesRendererPlugin: RendererPluginModule = {
  activate: (context) => {
    const t = (key: string, fallback?: string) =>
      context.i18n.t(key, undefined, fallback);
    // hot-exit 草稿切到 userData 后端(main file-drafts-service);
    // 失败(测试/降权环境)静默退回 localStorage 行为。
    configureFilesDraftBackend(context.files.drafts).catch(() => undefined);
    const disposers = [
      context.panels.register({
        component: createFilesFilePanel(context),
        icon: FileText,
        id: FILES_FILE_PANEL_ID,
        kind: "web",
        title: () => t("filePanel.title", "File"),
      }),
      registerDirtyCloseGuard(context),
      context.actions.register(createOpenSelectionAsMarkdownAction(context)),
      context.actions.register(createSaveAction(context)),
      context.actions.register(createTreeSearchAction(context)),
      ...createFilesTreeActions(context).map((action) =>
        context.actions.register(action)
      ),
      ...createFilesEditorActions(context).map((action) =>
        context.actions.register(action)
      ),
    ];

    return () => {
      clearFilesDocumentStore();
      clearFilesTreeStore();
      clearFilesTreeWatchers();
      clearFilesNavHistory();
      clearFilesEditorViews();
      clearCodeMirrorDocumentState();
      for (const dispose of disposers.toReversed()) {
        dispose();
      }
      clearFileTreeSidebarCache();
    };
  },
  // 设置页(插件行/插件导航项)读取此图标;module 自描述,宿主不再按 id 特判。
  icon: FolderTree,
  id: FILES_PLUGIN_ID,
};
