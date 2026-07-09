import type {
  RendererPluginAction,
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { z } from "zod";
import {
  FILES_EDITOR_COPY_COMMAND_ID,
  FILES_EDITOR_CUT_COMMAND_ID,
  FILES_EDITOR_PASTE_COMMAND_ID,
  FILES_EDITOR_SELECT_ALL_COMMAND_ID,
} from "../manifest.ts";
import type { FileEditorController } from "./file-editor-controller.ts";
import { createFilesTranslate, type FilesTranslate } from "./files-i18n.ts";

// 编辑器右键基础编辑操作由 editorSessionId 定位具体 view,再用 documentId
// 防串线;其余载荷(path/ranges/source)由 copyPathWithRange 等 action 自行解析。
const editorDocumentMetadataSchema = z.object({
  documentId: z.string().min(1),
  editorSessionId: z.string().min(1),
});

function resolveEditorTarget(
  invocation: RendererPluginActionInvocation | undefined
): { documentId: string; editorSessionId: string } | null {
  const parsed = editorDocumentMetadataSchema.safeParse(invocation?.metadata);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

function editorAction(action: {
  handler: RendererPluginAction["handler"];
  id: string;
  sortOrder: number;
  title: () => string;
}): RendererPluginAction {
  return {
    category: "file",
    handler: action.handler,
    id: action.id,
    metadata: { group: "0_edit", sortOrder: action.sortOrder },
    surfaces: ["files/editor"],
    title: action.title,
  };
}

export function createFilesEditorActions(
  context: RendererPluginContext,
  controller: FileEditorController
): RendererPluginAction[] {
  const t: FilesTranslate = createFilesTranslate(context);
  const reportError = (error: unknown, fallback: string) => {
    context.notifications.error(
      error instanceof Error ? error.message : fallback
    );
  };

  return [
    editorAction({
      id: FILES_EDITOR_CUT_COMMAND_ID,
      sortOrder: 1,
      title: () => t("filePanel.editor.action.cut", "Cut"),
      handler: async (invocation) => {
        const target = resolveEditorTarget(invocation);
        if (!target) {
          return;
        }
        try {
          await controller.executeEditorCommand(
            target.documentId,
            target.editorSessionId,
            "cut"
          );
        } catch (error) {
          reportError(
            error,
            t("filePanel.editor.clipboardFailed", "Clipboard unavailable")
          );
        }
      },
    }),
    editorAction({
      id: FILES_EDITOR_COPY_COMMAND_ID,
      sortOrder: 2,
      title: () => t("filePanel.editor.action.copy", "Copy"),
      handler: async (invocation) => {
        const target = resolveEditorTarget(invocation);
        if (!target) {
          return;
        }
        try {
          await controller.executeEditorCommand(
            target.documentId,
            target.editorSessionId,
            "copy"
          );
        } catch (error) {
          reportError(
            error,
            t("filePanel.editor.clipboardFailed", "Clipboard unavailable")
          );
        }
      },
    }),
    editorAction({
      id: FILES_EDITOR_PASTE_COMMAND_ID,
      sortOrder: 3,
      title: () => t("filePanel.editor.action.paste", "Paste"),
      handler: async (invocation) => {
        const target = resolveEditorTarget(invocation);
        if (!target) {
          return;
        }
        try {
          await controller.executeEditorCommand(
            target.documentId,
            target.editorSessionId,
            "paste"
          );
        } catch (error) {
          reportError(
            error,
            t("filePanel.editor.clipboardFailed", "Clipboard unavailable")
          );
        }
      },
    }),
    editorAction({
      id: FILES_EDITOR_SELECT_ALL_COMMAND_ID,
      sortOrder: 4,
      title: () => t("filePanel.editor.action.selectAll", "Select All"),
      handler: async (invocation) => {
        const target = resolveEditorTarget(invocation);
        if (!target) {
          return;
        }
        await controller.executeEditorCommand(
          target.documentId,
          target.editorSessionId,
          "selectAll"
        );
      },
    }),
  ];
}
