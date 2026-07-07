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
} from "../manifest.ts";
import { createFilePanel as createFilesFilePanel } from "./file-panel.tsx";
import {
  clearFilesDocumentStore,
  createUntitledMarkdownDocument,
} from "./files-document-store.ts";
import { clearFilesTreeStore } from "./files-tree-store.ts";

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

      context.panels.openInstance({
        componentId: FILES_FILE_PANEL_ID,
        ...(invocation?.sourcePanelContext
          ? { context: invocation.sourcePanelContext }
          : {}),
        instanceId: document.id,
        params: {
          source: {
            id: document.source.id,
            kind: "untitled",
            name: document.name,
          },
        },
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

export const filesRendererPlugin: RendererPluginModule = {
  activate: (context) => {
    const t = (key: string, fallback?: string) =>
      context.i18n.t(key, undefined, fallback);
    const disposers = [
      context.panels.register({
        component: createFilesFilePanel(context),
        icon: FileText,
        id: FILES_FILE_PANEL_ID,
        kind: "web",
        title: () => t("filePanel.title", "File"),
      }),
      context.actions.register(createOpenSelectionAsMarkdownAction(context)),
    ];

    return () => {
      clearFilesDocumentStore();
      clearFilesTreeStore();
      for (const dispose of disposers.toReversed()) {
        dispose();
      }
    };
  },
  // 设置页(插件行/插件导航项)读取此图标;module 自描述,宿主不再按 id 特判。
  icon: FolderTree,
  id: FILES_PLUGIN_ID,
};
