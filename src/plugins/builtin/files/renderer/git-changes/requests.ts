import type { EditorView } from "@codemirror/view";

export type FileChangeRequest =
  | {
      kind: "current" | "next" | "previous" | "close";
      keyboard?: boolean;
    }
  | { kind: "line"; line: number; keyboard?: boolean }
  | { kind: "range"; id: string; keyboard?: boolean };
const listeners = new Map<string, (request: FileChangeRequest) => void>();
const editors = new Map<string, EditorView>();
export function requestFileChange(
  sessionId: string,
  request: FileChangeRequest
): void {
  listeners.get(sessionId)?.(request);
}
export function registerFileChangeRequests(
  sessionId: string,
  listener: (request: FileChangeRequest) => void
): () => void {
  listeners.set(sessionId, listener);
  return () => {
    if (listeners.get(sessionId) === listener) listeners.delete(sessionId);
  };
}
export function registerFileChangeEditor(
  sessionId: string,
  view: EditorView
): () => void {
  editors.set(sessionId, view);
  return () => {
    if (editors.get(sessionId) === view) editors.delete(sessionId);
  };
}
export function getFileChangeEditor(sessionId: string): EditorView | undefined {
  return editors.get(sessionId);
}
