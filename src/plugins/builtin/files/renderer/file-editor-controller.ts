import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  type EditorSearchOptions,
  type EditorSearchState,
  EMPTY_EDITOR_SEARCH_STATE,
} from "./code-mirror-search-state.ts";
import { FileDocumentLifecycle } from "./file-document-lifecycle.ts";
import { FileEditorPathMutations } from "./file-editor-path-mutations.ts";
import { FileEditorSaveCommands } from "./file-editor-save-commands.ts";
import {
  type FileEditorCommand,
  type FileEditorViewPresentation,
  FileEditorViewSession,
} from "./file-editor-view-session.ts";
import type { FileSaveFeedback } from "./file-save-feedback.ts";
import type { FileSaveOutcome } from "./file-save-outcome.ts";
import { getDocument, updateDocumentContents } from "./files-document-store.ts";
import type {
  FilesDocument,
  FilesDocumentOrigin,
  FilesDocumentPanelSource,
  FileViewMode,
} from "./files-document-types.ts";
import type { FilesWatchHub } from "./files-watch-hub.ts";

/** file 插件中文档与 CodeMirror 生命周期的唯一公开入口。 */
export class FileEditorController {
  readonly #documents: FileDocumentLifecycle;
  readonly #modeHandlers = new Map<string, (mode: FileViewMode) => void>();
  readonly #pathMutations: FileEditorPathMutations;
  readonly #pendingModes = new Map<string, FileViewMode>();
  readonly #saveCommands: FileEditorSaveCommands;
  readonly #viewSessions = new Map<string, FileEditorViewSession>();

  constructor(context: RendererPluginContext, watchHub: FilesWatchHub) {
    this.#documents = new FileDocumentLifecycle({
      context,
      onDocumentsChanged: () => this.#syncViews(),
      onShowDiff: (documentId, panelId) => {
        this.#showDiff(documentId, panelId);
      },
      watchHub,
    });
    this.#pathMutations = new FileEditorPathMutations({
      documents: this.#documents,
      onRemoveDocuments: (documentIds) => {
        for (const documentId of documentIds) {
          this.#disposeDocumentViews(documentId);
        }
      },
    });
    this.#saveCommands = new FileEditorSaveCommands(context, this.#documents);
  }

  async initialize(): Promise<void> {
    await this.#documents.initialize();
  }

  documentId(source: FilesDocumentPanelSource): string {
    return this.#documents.documentId(source);
  }

  createUntitledDocument(input: {
    contents: string;
    origin?: FilesDocumentOrigin;
  }): FilesDocument {
    return this.#documents.createUntitledDocument(input);
  }

  acquirePanel(panelId: string, source: FilesDocumentPanelSource): () => void {
    return this.#documents.acquirePanel(panelId, source);
  }

  closePanel(input: {
    hasOtherOpenInstance: boolean;
    panelId: string;
    source: FilesDocumentPanelSource;
  }): void {
    this.#modeHandlers.delete(input.panelId);
    this.#pendingModes.delete(input.panelId);
    this.#documents.closePanel(input);
  }

  discardDocument(documentId: string): void {
    const document = getDocument(documentId);
    if (document) {
      this.#disposeDocumentViews(document.id);
    }
    this.#documents.discardDocument(documentId);
  }

  moveDiskDocumentSource(root: string, oldPath: string, newPath: string): void {
    this.#pathMutations.move(root, oldPath, newPath);
  }

  removeDiskDocumentForPath(root: string, path: string): void {
    this.#pathMutations.remove(root, path);
  }

  registerPanelModeHandler(
    panelId: string,
    handler: (mode: FileViewMode) => void
  ): () => void {
    this.#modeHandlers.set(panelId, handler);
    const pendingMode = this.#pendingModes.get(panelId);
    if (pendingMode) {
      this.#pendingModes.delete(panelId);
      handler(pendingMode);
    }
    return () => {
      if (this.#modeHandlers.get(panelId) === handler) {
        this.#modeHandlers.delete(panelId);
      }
    };
  }

  attachView(input: {
    documentId: string;
    editorSessionId: string;
    parent: HTMLElement;
    presentation: FileEditorViewPresentation;
  }): void {
    const document = getDocument(input.documentId);
    if (!document) {
      return;
    }
    let session = this.#viewSessions.get(input.editorSessionId);
    if (session && getDocument(session.documentId)?.id !== document.id) {
      session.dispose();
      this.#viewSessions.delete(input.editorSessionId);
      session = undefined;
    }
    if (session) {
      session.updatePresentation(input.presentation);
    } else {
      session = new FileEditorViewSession({
        documentId: input.documentId,
        editorSessionId: input.editorSessionId,
        onChange: (documentId, contents) => {
          const latest = getDocument(documentId);
          if (latest && !latest.readOnly) {
            updateDocumentContents(latest.id, contents);
          }
        },
        presentation: input.presentation,
      });
      this.#viewSessions.set(input.editorSessionId, session);
    }
    session.mount(input.parent, document);
  }

  updateViewPresentation(
    editorSessionId: string,
    presentation: FileEditorViewPresentation
  ): void {
    this.#viewSessions.get(editorSessionId)?.updatePresentation(presentation);
  }

  detachView(editorSessionId: string): void {
    this.#viewSessions.get(editorSessionId)?.detach();
  }

  applySearchQuery(
    editorSessionId: string,
    search: string,
    replace: string,
    options: EditorSearchOptions,
    navigate = false
  ): EditorSearchState {
    return (
      this.#viewSessions
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
      this.#viewSessions.get(editorSessionId)?.clearSearch(replace, options) ??
      EMPTY_EDITOR_SEARCH_STATE
    );
  }

  navigateSearch(
    editorSessionId: string,
    direction: "next" | "previous"
  ): EditorSearchState {
    return (
      this.#viewSessions.get(editorSessionId)?.navigateSearch(direction) ??
      EMPTY_EDITOR_SEARCH_STATE
    );
  }

  replaceSearch(editorSessionId: string, all: boolean): EditorSearchState {
    return (
      this.#viewSessions.get(editorSessionId)?.replaceSearch(all) ??
      EMPTY_EDITOR_SEARCH_STATE
    );
  }

  selectAllMatches(editorSessionId: string): EditorSearchState {
    return (
      this.#viewSessions.get(editorSessionId)?.selectAllMatches() ??
      EMPTY_EDITOR_SEARCH_STATE
    );
  }

  async executeEditorCommand(
    documentId: string,
    editorSessionId: string,
    command: FileEditorCommand
  ): Promise<void> {
    const session = this.#viewSessions.get(editorSessionId);
    const document = getDocument(documentId);
    if (
      !(session && document) ||
      getDocument(session.documentId)?.id !== document.id
    ) {
      return;
    }
    await session.execute(command);
  }

  async savePanel(
    panelId: string | null,
    feedback: FileSaveFeedback = "all"
  ): Promise<FileSaveOutcome> {
    return await this.#saveCommands.savePanel(panelId, feedback);
  }

  async saveDocument(
    documentId: string,
    panelId?: string,
    feedback: FileSaveFeedback = "all"
  ): Promise<FileSaveOutcome> {
    return await this.#saveCommands.saveDocument(documentId, panelId, feedback);
  }

  dispose(options: { clearDocuments?: boolean } = {}): void {
    this.#documents.dispose(options);
    for (const session of this.#viewSessions.values()) {
      session.dispose();
    }
    this.#viewSessions.clear();
    this.#modeHandlers.clear();
    this.#pendingModes.clear();
  }

  #syncViews(): void {
    for (const [sessionId, session] of this.#viewSessions) {
      const document = getDocument(session.documentId);
      if (document) {
        session.syncDocument(document);
      } else {
        session.dispose();
        this.#viewSessions.delete(sessionId);
      }
    }
  }

  #showDiff(documentId: string, preferredPanelId?: string): void {
    if (preferredPanelId) {
      const preferred = this.#modeHandlers.get(preferredPanelId);
      if (preferred) {
        preferred("diff");
        return;
      }
      this.#pendingModes.set(preferredPanelId, "diff");
      return;
    }
    for (const [panelId, handler] of this.#modeHandlers) {
      if (
        getDocument(this.#documents.getPanelDocumentId(panelId) ?? "")?.id ===
        getDocument(documentId)?.id
      ) {
        handler("diff");
        return;
      }
    }
  }

  #disposeDocumentViews(documentId: string): void {
    for (const [sessionId, session] of this.#viewSessions) {
      if (
        getDocument(session.documentId)?.id === documentId ||
        session.documentId === documentId
      ) {
        session.dispose();
        this.#viewSessions.delete(sessionId);
      }
    }
  }
}
