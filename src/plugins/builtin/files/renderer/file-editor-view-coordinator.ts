import {
  type EditorSearchOptions,
  type EditorSearchState,
  EMPTY_EDITOR_SEARCH_STATE,
} from "./code-mirror-search-state.ts";
import {
  type FileEditorCommand,
  type FileEditorViewPresentation,
  FileEditorViewSession,
} from "./file-editor-view-session.ts";
import { getDocument, updateDocumentContents } from "./files-document-store.ts";
import type { FilesDocument } from "./files-document-types.ts";

/** 管理 CodeMirror 视图实例，文档状态仍由 files-document-store 唯一持有。 */
export class FileEditorViewCoordinator {
  readonly #sessions = new Map<string, FileEditorViewSession>();

  values(): Iterable<FileEditorViewSession> {
    return this.#sessions.values();
  }

  getSession(editorSessionId: string): FileEditorViewSession | undefined {
    return this.#sessions.get(editorSessionId);
  }

  attach(input: {
    document: FilesDocument;
    editorSessionId: string;
    minimapEnabled: boolean;
    parent: HTMLElement;
    presentation: FileEditorViewPresentation;
  }): void {
    let session = this.#sessions.get(input.editorSessionId);
    if (session && getDocument(session.documentId)?.id !== input.document.id) {
      session.dispose();
      this.#sessions.delete(input.editorSessionId);
      session = undefined;
    }
    if (session) {
      session.updatePresentation(input.presentation);
      session.setMinimapEnabled(input.minimapEnabled);
    } else {
      session = new FileEditorViewSession({
        documentId: input.document.id,
        editorSessionId: input.editorSessionId,
        minimapEnabled: input.minimapEnabled,
        onChange: (documentId, contents) => {
          const latest = getDocument(documentId);
          if (latest && !latest.readOnly) {
            updateDocumentContents(latest.id, contents);
          }
        },
        presentation: input.presentation,
      });
      this.#sessions.set(input.editorSessionId, session);
    }
    session.mount(input.parent, input.document);
  }

  updatePresentation(
    editorSessionId: string,
    presentation: FileEditorViewPresentation
  ): void {
    this.#sessions.get(editorSessionId)?.updatePresentation(presentation);
  }

  detach(editorSessionId: string): void {
    this.#sessions.get(editorSessionId)?.detach();
  }

  applySearchQuery(
    editorSessionId: string,
    search: string,
    replace: string,
    options: EditorSearchOptions,
    navigate: boolean
  ): EditorSearchState {
    return (
      this.#sessions
        .get(editorSessionId)
        ?.applySearchQuery(search, replace, options, navigate) ??
      EMPTY_EDITOR_SEARCH_STATE
    );
  }

  clearSearch(
    editorSessionId: string,
    replace: string,
    options: EditorSearchOptions
  ): EditorSearchState {
    return (
      this.#sessions.get(editorSessionId)?.clearSearch(replace, options) ??
      EMPTY_EDITOR_SEARCH_STATE
    );
  }

  navigateSearch(
    editorSessionId: string,
    direction: "next" | "previous"
  ): EditorSearchState {
    return (
      this.#sessions.get(editorSessionId)?.navigateSearch(direction) ??
      EMPTY_EDITOR_SEARCH_STATE
    );
  }

  replaceSearch(editorSessionId: string, all: boolean): EditorSearchState {
    return (
      this.#sessions.get(editorSessionId)?.replaceSearch(all) ??
      EMPTY_EDITOR_SEARCH_STATE
    );
  }

  selectAllMatches(editorSessionId: string): EditorSearchState {
    return (
      this.#sessions.get(editorSessionId)?.selectAllMatches() ??
      EMPTY_EDITOR_SEARCH_STATE
    );
  }

  async execute(
    documentId: string,
    editorSessionId: string,
    command: FileEditorCommand
  ): Promise<void> {
    const session = this.#sessions.get(editorSessionId);
    const document = getDocument(documentId);
    if (
      !(session && document) ||
      getDocument(session.documentId)?.id !== document.id
    ) {
      return;
    }
    await session.execute(command);
  }

  syncDocuments(): void {
    for (const [sessionId, session] of this.#sessions) {
      const document = getDocument(session.documentId);
      if (document) {
        session.syncDocument(document);
      } else {
        session.dispose();
        this.#sessions.delete(sessionId);
      }
    }
  }

  disposeDocument(documentId: string): void {
    for (const [sessionId, session] of this.#sessions) {
      if (
        getDocument(session.documentId)?.id === documentId ||
        session.documentId === documentId
      ) {
        session.dispose();
        this.#sessions.delete(sessionId);
      }
    }
  }

  dispose(): void {
    for (const session of this.#sessions.values()) {
      session.dispose();
    }
    this.#sessions.clear();
  }
}
