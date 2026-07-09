import type { EditorView } from "codemirror";

/**
 * 活跃 CodeMirror 视图注册表(editorSessionId → view)。
 * 编辑器右键的 剪切/复制/粘贴/全选 action 在 context-menu handler 里没有
 * 组件引用,经此拿到 view 执行编辑操作(镜像 file-panel-save-registry 模式)。
 *
 * 同一个 document 可以在多个 group/panel 中同时打开,所以 documentId 只能
 * 标识数据,不能标识当前 UI 实例。注册表必须以 editorSessionId 定位具体视图,
 * 再用 documentId 做防串线校验。
 */
interface FilesEditorViewRegistration {
  documentId: string;
  view: EditorView;
}

const viewsByEditorSessionId = new Map<string, FilesEditorViewRegistration>();

export function registerFilesEditorView(input: {
  documentId: string;
  editorSessionId: string;
  view: EditorView;
}): () => void {
  viewsByEditorSessionId.set(input.editorSessionId, {
    documentId: input.documentId,
    view: input.view,
  });
  return () => {
    if (
      viewsByEditorSessionId.get(input.editorSessionId)?.view === input.view
    ) {
      viewsByEditorSessionId.delete(input.editorSessionId);
    }
  };
}

export function getFilesEditorView(input: {
  documentId: string;
  editorSessionId: string;
}): EditorView | null {
  const registration = viewsByEditorSessionId.get(input.editorSessionId);
  if (!registration || registration.documentId !== input.documentId) {
    return null;
  }
  return registration.view;
}

export function clearFilesEditorViews(documentId?: string): void {
  if (!documentId) {
    viewsByEditorSessionId.clear();
    return;
  }
  for (const [editorSessionId, registration] of viewsByEditorSessionId) {
    if (registration.documentId === documentId) {
      viewsByEditorSessionId.delete(editorSessionId);
    }
  }
}
