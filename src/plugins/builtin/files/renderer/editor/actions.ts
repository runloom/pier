import type {
  RendererPluginAction,
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { z } from "zod";
import {
  FILES_EDITOR_ADD_CURSOR_ABOVE_COMMAND_ID,
  FILES_EDITOR_ADD_CURSOR_BELOW_COMMAND_ID,
  FILES_EDITOR_COPY_COMMAND_ID,
  FILES_EDITOR_CUT_COMMAND_ID,
  FILES_EDITOR_GO_TO_LINE_COMMAND_ID,
  FILES_EDITOR_PASTE_COMMAND_ID,
  FILES_EDITOR_SELECT_ALL_COMMAND_ID,
  FILES_EDITOR_SELECT_ALL_OCCURRENCES_COMMAND_ID,
  FILES_EDITOR_SELECT_NEXT_OCCURRENCE_COMMAND_ID,
  FILES_EDITOR_SHOW_HOVER_COMMAND_ID,
  FILES_EDITOR_TOGGLE_WORD_WRAP_COMMAND_ID,
  FILES_FILE_PANEL_ID,
} from "../../manifest.ts";
import { FILES_EDITOR_WORD_WRAP_SETTING_KEY } from "../../settings.ts";
import { createFilesTranslate, type FilesTranslate } from "../i18n.ts";
import type { FileEditorController } from "./controller.ts";
import { createFileEditorSessionId } from "./session-id.ts";
import {
  addEditorCursorAbove,
  addEditorCursorBelow,
  selectAllEditorOccurrences,
  selectNextEditorOccurrence,
} from "./view-operations.ts";

// 编辑器右键基础编辑操作由 editorSessionId 定位具体 view,再用 documentId
// 防串线;其余载荷(path/ranges/source)由 copyPathWithRange 等 action 自行解析。
const editorDocumentMetadataSchema = z.object({
  documentId: z.string().min(1),
  editorSessionId: z.string().min(1),
});

export interface FilesEditorLocation {
  column?: number;
  line: number;
}

export function parseFilesEditorLocation(
  raw: string
): FilesEditorLocation | null {
  const trimmed = raw.trim();
  if (!/^\d+(?:\s*[:，,]\s*\d+)?$/.test(trimmed)) {
    return null;
  }
  const [linePart, columnPart] = trimmed.split(/[:，,]/);
  const line = Number(linePart);
  const column = columnPart === undefined ? undefined : Number(columnPart);
  if (
    !Number.isInteger(line) ||
    line < 1 ||
    (column !== undefined && (!Number.isInteger(column) || column < 1))
  ) {
    return null;
  }
  return column === undefined ? { line } : { column, line };
}

function resolveEditorTarget(
  invocation: RendererPluginActionInvocation | undefined
): { documentId: string; editorSessionId: string } | null {
  const parsed = editorDocumentMetadataSchema.safeParse(invocation?.metadata);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

function resolveActiveEditorSession(
  invocation: RendererPluginActionInvocation | undefined,
  context: RendererPluginContext
): string | null {
  const fromInvocation = resolveEditorTarget(invocation);
  if (fromInvocation) {
    return fromInvocation.editorSessionId;
  }
  const panelId = context.panels.getActiveInstanceId(FILES_FILE_PANEL_ID);
  return panelId ? createFileEditorSessionId(panelId) : null;
}

function viewCommandAction(action: {
  command: Parameters<FileEditorController["runViewCommand"]>[1];
  context: RendererPluginContext;
  controller: FileEditorController;
  id: string;
  sortOrder: number;
  title: () => string;
}): RendererPluginAction {
  return {
    category: "file",
    handler: async (invocation) => {
      const editorSessionId = resolveActiveEditorSession(
        invocation,
        action.context
      );
      if (!editorSessionId) {
        return;
      }
      action.controller.runViewCommand(editorSessionId, action.command);
    },
    id: action.id,
    metadata: { group: "1_navigation", sortOrder: action.sortOrder },
    surfaces: ["command-palette", "files/editor"],
    title: action.title,
  };
}

function editorAction(action: {
  displayChord?: string;
  handler: RendererPluginAction["handler"];
  id: string;
  sortOrder: number;
  title: () => string;
}): RendererPluginAction {
  return {
    category: "file",
    handler: action.handler,
    id: action.id,
    metadata: {
      group: "0_edit",
      sortOrder: action.sortOrder,
      ...(action.displayChord ? { displayChord: action.displayChord } : {}),
    },
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
      displayChord: "Mod+KeyX",
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
      displayChord: "Mod+KeyC",
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
      displayChord: "Mod+KeyV",
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
      displayChord: "Mod+KeyA",
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

    {
      category: "file" as const,
      handler: async () => {
        const panelId = context.panels.getActiveInstanceId(FILES_FILE_PANEL_ID);
        if (!panelId) {
          return;
        }
        const documentId = controller.documentIdForPanel(panelId);
        if (!documentId) {
          return;
        }
        const editorSessionId = createFileEditorSessionId(panelId);
        const current = controller.currentLineForSession(editorSessionId);
        const value = await context.dialogs.prompt({
          body: t(
            "filePanel.editor.goToLine.body",
            "Enter a line number, or line:column."
          ),
          confirmLabel: t("filePanel.editor.goToLine.confirm", "Go"),
          initialValue: current ? String(current) : "1",
          intent: "default",
          placeholder: "12:3",
          title: t("filePanel.editor.goToLine.title", "Go to Line"),
          validate: (raw) =>
            parseFilesEditorLocation(raw)
              ? null
              : t(
                  "filePanel.editor.goToLine.invalid",
                  "Use a line number, or line:column."
                ),
        });
        if (value === null) {
          return;
        }
        const location = parseFilesEditorLocation(value);
        if (!location) {
          return;
        }
        controller.showSourceMode(panelId);
        const result = controller.goToLineResult(
          editorSessionId,
          documentId,
          location.line,
          location.column
        );
        if (result === "rejected") {
          context.notifications.error(
            t(
              "filePanel.editor.goToLine.failed",
              "Unable to jump to that line."
            )
          );
        }
      },
      id: FILES_EDITOR_GO_TO_LINE_COMMAND_ID,
      metadata: { group: "1_navigation", sortOrder: 1 },
      surfaces: ["command-palette", "files/editor"],
      title: () => t("filePanel.editor.goToLine.title", "Go to Line…"),
    },
    {
      category: "file" as const,
      handler: async (invocation) => {
        let target = resolveEditorTarget(invocation);
        if (!target) {
          const panelId =
            context.panels.getActiveInstanceId(FILES_FILE_PANEL_ID);
          const documentId = panelId
            ? controller.documentIdForPanel(panelId)
            : null;
          if (!(panelId && documentId)) {
            context.notifications.error(
              t(
                "filePanel.editor.showHover.noActiveFile",
                "Open a file in the editor first."
              )
            );
            return;
          }
          controller.showSourceMode(panelId);
          target = {
            documentId,
            editorSessionId: createFileEditorSessionId(panelId),
          };
        }
        const reportUnavailable = (): void => {
          context.notifications.error(
            t(
              "filePanel.editor.showHover.unavailable",
              "Symbol information is unavailable here."
            )
          );
        };
        const result = await controller.showLspHover(
          target.editorSessionId,
          target.documentId,
          (deferredResult) => {
            if (deferredResult === "unavailable") {
              reportUnavailable();
            }
          }
        );
        if (result === "unavailable") {
          reportUnavailable();
        }
      },
      id: FILES_EDITOR_SHOW_HOVER_COMMAND_ID,
      metadata: { group: "1_navigation", sortOrder: 2 },
      surfaces: ["command-palette", "files/editor"],
      title: () =>
        t("filePanel.editor.showHover.title", "Show Symbol Information"),
    },
    viewCommandAction({
      command: selectNextEditorOccurrence,
      context,
      controller,
      id: FILES_EDITOR_SELECT_NEXT_OCCURRENCE_COMMAND_ID,
      sortOrder: 3,
      title: () =>
        t(
          "filePanel.editor.action.selectNextOccurrence",
          "Select Next Occurrence"
        ),
    }),
    viewCommandAction({
      command: selectAllEditorOccurrences,
      context,
      controller,
      id: FILES_EDITOR_SELECT_ALL_OCCURRENCES_COMMAND_ID,
      sortOrder: 4,
      title: () =>
        t(
          "filePanel.editor.action.selectAllOccurrences",
          "Select All Occurrences"
        ),
    }),
    viewCommandAction({
      command: addEditorCursorAbove,
      context,
      controller,
      id: FILES_EDITOR_ADD_CURSOR_ABOVE_COMMAND_ID,
      sortOrder: 5,
      title: () =>
        t("filePanel.editor.action.addCursorAbove", "Add Cursor Above"),
    }),
    viewCommandAction({
      command: addEditorCursorBelow,
      context,
      controller,
      id: FILES_EDITOR_ADD_CURSOR_BELOW_COMMAND_ID,
      sortOrder: 6,
      title: () =>
        t("filePanel.editor.action.addCursorBelow", "Add Cursor Below"),
    }),
  ];
}

/**
 * 视图切换类编辑器 action（全局配置写入，不走文档 mutation gate）。
 *
 * wordWrap 切换写回 `pier.files.editor.wordWrap` 全局配置，经
 * {@link bindFilesEditorPrefs} 联动所有打开的编辑器；不碰文档内容，
 * 因此不能套 withFilesMutationGate（有 in-flight save/mutation 时会被挂起）。
 */
export function createFilesEditorPrefsActions(
  context: RendererPluginContext
): RendererPluginAction[] {
  const t: FilesTranslate = createFilesTranslate(context);
  return [
    {
      category: "file" as const,
      handler: async () => {
        const next =
          context.configuration.get<boolean>(
            FILES_EDITOR_WORD_WRAP_SETTING_KEY
          ) !== true;
        await context.configuration.set(
          FILES_EDITOR_WORD_WRAP_SETTING_KEY,
          next
        );
      },
      id: FILES_EDITOR_TOGGLE_WORD_WRAP_COMMAND_ID,
      metadata: { group: "2_view", sortOrder: 1 },
      surfaces: ["command-palette", "files/editor"],
      title: () =>
        context.configuration.get<boolean>(
          FILES_EDITOR_WORD_WRAP_SETTING_KEY
        ) === true
          ? t("filePanel.editor.action.wordWrap.on", "Word Wrap: On")
          : t("filePanel.editor.action.wordWrap.off", "Word Wrap: Off"),
    },
  ];
}
