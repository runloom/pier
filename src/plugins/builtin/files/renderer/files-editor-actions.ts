import type {
  RendererPluginAction,
  RendererPluginActionInvocation,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import { EditorView } from "codemirror";
import { z } from "zod";
import {
  FILES_EDITOR_COPY_COMMAND_ID,
  FILES_EDITOR_CUT_COMMAND_ID,
  FILES_EDITOR_PASTE_COMMAND_ID,
  FILES_EDITOR_SELECT_ALL_COMMAND_ID,
} from "../manifest.ts";
import { getFilesEditorView } from "./files-editor-view-registry.ts";
import { createFilesTranslate, type FilesTranslate } from "./files-i18n.ts";

// 编辑器右键基础编辑操作由 editorSessionId 定位具体 view,再用 documentId
// 防串线;其余载荷(path/ranges/source)由 copyPathWithRange 等 action 自行解析。
const editorDocumentMetadataSchema = z.object({
  documentId: z.string().min(1),
  editorSessionId: z.string().min(1),
});

function resolveEditorView(
  invocation: RendererPluginActionInvocation | undefined
): EditorView | null {
  const parsed = editorDocumentMetadataSchema.safeParse(invocation?.metadata);
  if (!parsed.success) {
    return null;
  }
  return getFilesEditorView({
    documentId: parsed.data.documentId,
    editorSessionId: parsed.data.editorSessionId,
  });
}

/** 选区文本;全部为空选区时按 VS Code 语义取各光标所在整行(含换行)。 */
function selectionText(view: EditorView): {
  text: string;
  usedLineFallback: boolean;
} {
  const { state } = view;
  const hasSelection = state.selection.ranges.some((range) => !range.empty);
  if (hasSelection) {
    return {
      text: state.selection.ranges
        .filter((range) => !range.empty)
        .map((range) => state.sliceDoc(range.from, range.to))
        .join("\n"),
      usedLineFallback: false,
    };
  }
  const line = state.doc.lineAt(state.selection.main.head);
  return {
    text: `${line.text}\n`,
    usedLineFallback: true,
  };
}

function isEditable(view: EditorView): boolean {
  return view.state.facet(EditorView.editable);
}

async function copyFromView(view: EditorView): Promise<{
  usedLineFallback: boolean;
}> {
  const { text, usedLineFallback } = selectionText(view);
  await navigator.clipboard.writeText(text);
  return { usedLineFallback };
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
  context: RendererPluginContext
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
        const view = resolveEditorView(invocation);
        if (!(view && isEditable(view))) {
          return;
        }
        try {
          const { usedLineFallback } = await copyFromView(view);
          const { state } = view;
          if (usedLineFallback) {
            const line = state.doc.lineAt(state.selection.main.head);
            // 整行剪切:连同行尾换行删除(最后一行删到行首前的换行)。
            const from = line.from;
            const to = Math.min(line.to + 1, state.doc.length);
            view.dispatch({ changes: { from, to } });
          } else {
            view.dispatch(state.replaceSelection(""));
          }
          view.focus();
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
        const view = resolveEditorView(invocation);
        if (!view) {
          return;
        }
        try {
          await copyFromView(view);
          view.focus();
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
        const view = resolveEditorView(invocation);
        if (!(view && isEditable(view))) {
          return;
        }
        try {
          const text = await navigator.clipboard.readText();
          if (text.length === 0) {
            return;
          }
          view.dispatch(view.state.replaceSelection(text));
          view.focus();
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
        const view = resolveEditorView(invocation);
        if (!view) {
          return;
        }
        view.dispatch({
          selection: { anchor: 0, head: view.state.doc.length },
        });
        view.focus();
        return await Promise.resolve();
      },
    }),
  ];
}
