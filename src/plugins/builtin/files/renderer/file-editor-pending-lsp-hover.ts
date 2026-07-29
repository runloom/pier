import type { FileEditorLspHoverResult } from "./file-editor-adapter-types.ts";

export interface FileEditorPendingLspHoverIntent {
  complete(result: FileEditorLspHoverResult): void;
}

export class FileEditorPendingLspHover {
  readonly #pendingByEditorSession = new Map<
    string,
    FileEditorPendingLspHoverIntent & { documentId: string }
  >();

  set(
    editorSessionId: string,
    documentId: string,
    complete: (result: FileEditorLspHoverResult) => void = () => undefined
  ): void {
    this.#pendingByEditorSession.set(editorSessionId, { complete, documentId });
  }

  take(
    editorSessionId: string,
    documentId: string
  ): FileEditorPendingLspHoverIntent | null {
    const pending = this.#pendingByEditorSession.get(editorSessionId);
    if (pending?.documentId !== documentId) {
      return null;
    }
    this.#pendingByEditorSession.delete(editorSessionId);
    return pending;
  }

  clear(): void {
    this.#pendingByEditorSession.clear();
  }
}
