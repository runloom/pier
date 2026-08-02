import { getDocument } from "../document/store.ts";
import type {
  EditorSearchOptions,
  EditorSearchState,
} from "./cm-search-state.ts";
import { editorOffsetForDocumentLocation } from "./location.ts";
import { FileEditorPendingLspHover } from "./pending-lsp-hover.ts";
import { FileEditorPendingReveals } from "./pending-reveals.ts";
import { parseFileEditorSessionOwnerId } from "./session-id.ts";
import { FileEditorViewCoordinator } from "./view-coordinator.ts";
import type {
  FileEditorCommand,
  FileEditorLspHoverResult,
  FileEditorViewPresentation,
} from "./view-session.ts";

export type FileEditorNavigationResult = "applied" | "queued" | "rejected";

export class FileEditorControllerViewCommands {
  readonly #getPanelDocumentId: (panelId: string) => string | null;
  readonly #pendingLspHover = new FileEditorPendingLspHover();
  readonly #pendingReveals = new FileEditorPendingReveals();
  readonly #views: FileEditorViewCoordinator;

  constructor(input: {
    getPanelDocumentId(panelId: string): string | null;
    views: FileEditorViewCoordinator;
  }) {
    this.#getPanelDocumentId = input.getPanelDocumentId;
    this.#views = input.views;
  }

  applyViewSnapshot(
    editorSessionId: string,
    snapshot: Parameters<FileEditorViewCoordinator["applySnapshot"]>[1]
  ): void {
    this.#views.applySnapshot(editorSessionId, snapshot);
  }

  revealOffset(
    editorSessionId: string,
    offset: number,
    documentId?: string
  ): void {
    this.revealRange(editorSessionId, offset, offset, documentId);
  }

  hasPendingReveal(editorSessionId: string, documentId?: string): boolean {
    return this.#pendingReveals.hasPending(editorSessionId, documentId);
  }

  revealRange(
    editorSessionId: string,
    from: number,
    to: number,
    documentId?: string
  ): boolean {
    const session = this.#views.getSession(editorSessionId);
    const targetDocumentId = documentId ?? session?.documentId;
    if (!targetDocumentId) {
      return false;
    }
    return this.#pendingReveals.revealRange(
      session,
      editorSessionId,
      targetDocumentId,
      from,
      to
    );
  }

  goToLine(
    editorSessionId: string,
    documentId: string,
    line: number,
    column?: number
  ): boolean {
    return (
      this.goToLineResult(editorSessionId, documentId, line, column) ===
      "applied"
    );
  }

  goToLineResult(
    editorSessionId: string,
    documentId: string,
    line: number,
    column?: number
  ): FileEditorNavigationResult {
    const session = this.#views.getSession(editorSessionId);
    if (session && session.documentId !== documentId) {
      this.#pendingReveals.cancel(editorSessionId);
      return "rejected";
    }
    const document = getDocument(documentId);
    if (document?.loadState !== "loaded") {
      this.#pendingReveals.queueLocation(
        editorSessionId,
        documentId,
        line,
        column
      );
      return "queued";
    }
    const offset = editorOffsetForDocumentLocation(document, line, column);
    if (offset === null) {
      this.#pendingReveals.cancel(editorSessionId);
      return "rejected";
    }
    return this.#pendingReveals.revealRange(
      session,
      editorSessionId,
      documentId,
      offset,
      offset
    )
      ? "applied"
      : "queued";
  }

  currentLineForSession(editorSessionId: string): number | null {
    return this.#views.getSession(editorSessionId)?.currentLine() ?? null;
  }

  captureViewportAnchor(editorSessionId: string) {
    return this.#views.captureViewportAnchor(editorSessionId);
  }

  async showLspHover(
    editorSessionId: string,
    documentId: string,
    onDeferredResult?: (result: FileEditorLspHoverResult) => void
  ): Promise<FileEditorLspHoverResult> {
    this.#pendingLspHover.clear();
    this.#views.cancelQueuedLspHovers();
    const session = this.#views.getSession(editorSessionId);
    if (session) {
      if (session.documentId !== documentId) {
        return "unavailable";
      }
      if (session.currentLine() !== null) {
        return await this.#views.showLspHover(editorSessionId);
      }
    }
    const ownerId = parseFileEditorSessionOwnerId(editorSessionId);
    if (
      !(ownerId && getDocument(documentId)) ||
      this.#getPanelDocumentId(ownerId) !== documentId
    ) {
      return "unavailable";
    }
    this.#pendingLspHover.set(editorSessionId, documentId, onDeferredResult);
    return "queued";
  }

  prepareDocumentReplacement(
    editorSessionId: string,
    previousDocumentId: string | null | undefined,
    nextDocumentId: string
  ): void {
    if (previousDocumentId && previousDocumentId !== nextDocumentId) {
      this.#pendingLspHover.take(editorSessionId, previousDocumentId);
      this.#pendingReveals.cancel(editorSessionId);
    }
  }

  clearOwnerDocument(editorSessionId: string, documentId: string): void {
    this.#pendingLspHover.take(editorSessionId, documentId);
    this.#pendingReveals.cancel(editorSessionId);
  }

  #consumePendingLocation(editorSessionId: string, documentId: string): void {
    const session = this.#views.getSession(editorSessionId);
    const document = getDocument(documentId);
    if (!session || document?.loadState !== "loaded") {
      return;
    }
    const pendingLocation = this.#pendingReveals.takeLocation(
      editorSessionId,
      documentId
    );
    if (!pendingLocation) {
      return;
    }
    const offset = editorOffsetForDocumentLocation(
      document,
      pendingLocation.line,
      pendingLocation.column
    );
    if (offset !== null) {
      session.revealRange(offset, offset);
    }
  }

  consumeAttached(editorSessionId: string, documentId: string): void {
    const session = this.#views.getSession(editorSessionId);
    if (!session) {
      return;
    }
    const pendingReveal = this.#pendingReveals.take(
      editorSessionId,
      documentId
    );
    if (pendingReveal) {
      session.revealRange(pendingReveal.from, pendingReveal.to);
    }
    this.#consumePendingLocation(editorSessionId, documentId);
    const pendingHover = this.#pendingLspHover.take(
      editorSessionId,
      documentId
    );
    if (pendingHover) {
      this.#views.showLspHover(editorSessionId).then(
        (result) => pendingHover.complete(result),
        () => pendingHover.complete("unavailable")
      );
    }
  }

  consumePendingLocations(): void {
    for (const session of this.#views.values()) {
      this.#consumePendingLocation(session.editorSessionId, session.documentId);
    }
  }

  disposeDocument(documentId: string): void {
    for (const session of this.#views.values()) {
      if (session.documentId === documentId) {
        this.#pendingLspHover.take(session.editorSessionId, documentId);
      }
    }
    this.#views.disposeDocument(documentId);
  }

  clear(): void {
    this.#pendingLspHover.clear();
    this.#pendingReveals.clear();
  }
}

export abstract class FileEditorControllerViewFacade {
  protected readonly views = new FileEditorViewCoordinator();
  protected readonly viewCommands = new FileEditorControllerViewCommands({
    getPanelDocumentId: (panelId) =>
      this.getPanelDocumentIdForViewCommands(panelId),
    views: this.views,
  });
  protected abstract getPanelDocumentIdForViewCommands(
    panelId: string
  ): string | null;

  applyViewSnapshot(
    editorSessionId: string,
    snapshot: Parameters<FileEditorViewCoordinator["applySnapshot"]>[1]
  ): void {
    this.viewCommands.applyViewSnapshot(editorSessionId, snapshot);
  }

  revealOffset(
    editorSessionId: string,
    offset: number,
    documentId?: string
  ): void {
    this.viewCommands.revealOffset(editorSessionId, offset, documentId);
  }

  revealRange(
    editorSessionId: string,
    from: number,
    to: number,
    documentId?: string
  ): boolean {
    return this.viewCommands.revealRange(editorSessionId, from, to, documentId);
  }

  goToLine(
    editorSessionId: string,
    documentId: string,
    line: number,
    column?: number
  ): boolean {
    return this.viewCommands.goToLine(
      editorSessionId,
      documentId,
      line,
      column
    );
  }

  goToLineResult(
    editorSessionId: string,
    documentId: string,
    line: number,
    column?: number
  ): FileEditorNavigationResult {
    return this.viewCommands.goToLineResult(
      editorSessionId,
      documentId,
      line,
      column
    );
  }

  currentLineForSession(editorSessionId: string): number | null {
    return this.viewCommands.currentLineForSession(editorSessionId);
  }

  captureViewportAnchor(editorSessionId: string) {
    return this.viewCommands.captureViewportAnchor(editorSessionId);
  }

  async showLspHover(
    editorSessionId: string,
    documentId: string,
    onDeferredResult?: (result: FileEditorLspHoverResult) => void
  ): Promise<FileEditorLspHoverResult> {
    return await this.viewCommands.showLspHover(
      editorSessionId,
      documentId,
      onDeferredResult
    );
  }

  updateViewPresentation(
    editorSessionId: string,
    presentation: FileEditorViewPresentation
  ): void {
    this.views.updatePresentation(editorSessionId, presentation);
  }

  applySearchQuery(
    editorSessionId: string,
    search: string,
    replace: string,
    options: EditorSearchOptions,
    navigate = false
  ): EditorSearchState {
    return this.views.applySearchQuery(
      editorSessionId,
      search,
      replace,
      options,
      navigate
    );
  }

  clearSearch(
    editorSessionId: string,
    replace: string,
    options: EditorSearchOptions
  ): EditorSearchState {
    return this.views.clearSearch(editorSessionId, replace, options);
  }

  navigateSearch(
    editorSessionId: string,
    direction: "next" | "previous"
  ): EditorSearchState {
    return this.views.navigateSearch(editorSessionId, direction);
  }

  replaceSearch(editorSessionId: string, all: boolean): EditorSearchState {
    return this.views.replaceSearch(editorSessionId, all);
  }

  selectAllMatches(editorSessionId: string): EditorSearchState {
    return this.views.selectAllMatches(editorSessionId);
  }

  async executeEditorCommand(
    documentId: string,
    editorSessionId: string,
    command: FileEditorCommand
  ): Promise<void> {
    await this.views.execute(documentId, editorSessionId, command);
  }
}
