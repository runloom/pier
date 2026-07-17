import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  EditorSearchOptions,
  EditorSearchState,
} from "./code-mirror-search-state.ts";
import { FileDocumentLifecycle } from "./file-document-lifecycle.ts";
import { FileEditorPathMutations } from "./file-editor-path-mutations.ts";
import { FileEditorSaveCommands } from "./file-editor-save-commands.ts";
import { FileEditorSaveCoordinator } from "./file-editor-save-coordinator.ts";
import { FileEditorViewCoordinator } from "./file-editor-view-coordinator.ts";
import type {
  FileEditorCommand,
  FileEditorViewPresentation,
} from "./file-editor-view-session.ts";
import {
  type FilePathMutationGuard,
  FilePathMutationGuardCoordinator,
} from "./file-path-mutation-guard.ts";
import type { FileSaveFeedback } from "./file-save-feedback.ts";
import type {
  FileDocumentSettleResult,
  FileSaveOutcome,
} from "./file-save-outcome.ts";
import { isSamePathOrDescendant } from "./files-document-paths.ts";
import { getDocument, normalizeDocumentEol } from "./files-document-store.ts";
import type {
  FilesDocument,
  FilesDocumentOrigin,
  FilesDocumentPanelSource,
  FileViewMode,
} from "./files-document-types.ts";
import { FilesEditorGitGutterController } from "./files-editor-git-gutter-controller.ts";
import { FilesMutationGate } from "./files-mutation-gate.ts";
import { moveFilesNavPath } from "./files-nav-history.ts";
import { preserveDocumentsAsUntitledAndRebind } from "./files-preserve-as-untitled.ts";
import type { FilesWatchHub } from "./files-watch-hub.ts";

export type { FilePathMutationGuard } from "./file-path-mutation-guard.ts";
export type { FileDocumentSettleResult } from "./file-save-outcome.ts";

/** file 插件中文档与 CodeMirror 生命周期的唯一公开入口。 */
export class FileEditorController {
  readonly #context: RendererPluginContext;
  readonly #documents: FileDocumentLifecycle;
  readonly #gitGutter: FilesEditorGitGutterController;
  readonly #modeHandlers = new Map<string, (mode: FileViewMode) => void>();
  readonly #mutationGate = new FilesMutationGate();
  readonly #pathMutationGuards: FilePathMutationGuardCoordinator;
  readonly #pathMutations: FileEditorPathMutations;
  readonly #pendingModes = new Map<string, FileViewMode>();
  readonly #saveCoordinator: FileEditorSaveCoordinator;
  readonly #views = new FileEditorViewCoordinator();
  #editingSuspended = false;

  constructor(context: RendererPluginContext, watchHub: FilesWatchHub) {
    this.#context = context;
    this.#gitGutter = new FilesEditorGitGutterController(context);
    this.#pathMutationGuards = new FilePathMutationGuardCoordinator({
      context,
      isEditingSuspended: () => this.#editingSuspended,
      sessions: () => this.#views.values(),
    });
    this.#documents = new FileDocumentLifecycle({
      context,
      onDocumentsChanged: () => this.#views.syncDocuments(),
      onShowDiff: (documentId, panelId) => {
        this.#showDiff(documentId, panelId);
      },
      watchHub,
    });
    this.#pathMutations = new FileEditorPathMutations({
      documents: this.#documents,
      onRemoveDocuments: (documentIds) => {
        for (const documentId of documentIds) {
          this.#views.disposeDocument(documentId);
        }
      },
      onPreserveAsUntitled: async (documents) =>
        await preserveDocumentsAsUntitledAndRebind({
          context: this.#context,
          documents,
        }),
    });
    const saveCommands = new FileEditorSaveCommands(context, this.#documents);
    this.#saveCoordinator = new FileEditorSaveCoordinator({
      confirmDurability: async (documentId, feedback) =>
        await this.confirmDocumentDurability(documentId, feedback),
      getPanelDocumentId: (panelId) =>
        this.#documents.getPanelDocumentId(panelId),
      saveCommands,
    });
  }

  async initialize(): Promise<void> {
    await this.#documents.initialize();
  }

  async runMutation<T>(operation: () => Promise<T> | T): Promise<T> {
    return await this.#mutationGate.run(operation);
  }

  async suspendMutations(signal: AbortSignal): Promise<void> {
    await this.#mutationGate.suspend(signal);
    try {
      await this.#documents.prepareSuspend(signal);
    } catch (error) {
      this.#mutationGate.resume();
      throw error;
    }
  }

  resumeMutations(): void {
    this.#documents.resumeAfterSuspend();
    this.#mutationGate.resume();
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
    const release = this.#documents.acquirePanel(panelId, source);
    const document = getDocument(this.documentId(source));
    if (document) {
      this.#pathMutationGuards.syncDocument(document);
    }
    return release;
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
      this.#views.disposeDocument(document.id);
    }
    this.#documents.discardDocument(documentId);
  }

  async moveDiskDocumentSource(
    root: string,
    oldPath: string,
    newPath: string,
    affectedDocuments?: readonly FilesDocument[]
  ): Promise<void> {
    await this.#pathMutations.move(root, oldPath, newPath, affectedDocuments);
    await this.#documents.reconcileMovedPath(root, newPath);
  }

  async movePath(
    root: string,
    oldPath: string,
    newPath: string
  ): Promise<void> {
    const guard = await this.#pathMutationGuards.beginMove(
      root,
      oldPath,
      newPath
    );
    try {
      const affected = guard.currentDocuments();
      const protectedTarget = affected.find(
        (document) =>
          document.source.kind === "disk" &&
          document.source.root === root &&
          isSamePathOrDescendant(document.source.path, newPath) &&
          (document.dirty || document.durabilityUnknown || document.needsSaveAs)
      );
      if (protectedTarget) {
        throw new Error("The move target has protected unsaved changes");
      }
      this.#pathMutations.prepare(affected);
      await this.#context.files.move({
        newPath,
        path: oldPath,
        root,
      });
      await this.moveDiskDocumentSource(
        root,
        oldPath,
        newPath,
        guard.currentDocuments()
      );
      moveFilesNavPath(root, oldPath, newPath);
    } finally {
      guard.release();
    }
  }

  removeDiskDocumentForPath(root: string, path: string): void {
    this.#pathMutations.remove(root, path);
  }

  removeDocumentsAfterPathMutation(documents: readonly FilesDocument[]): void {
    this.#pathMutations.removeAffected(documents);
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

  registerPanelSaveAsHandler(
    panelId: string,
    handler: (feedback: FileSaveFeedback) => Promise<FileSaveOutcome>
  ): () => void {
    return this.#saveCoordinator.registerHandler(panelId, handler);
  }

  recordPanelSaveAsDocument(panelId: string, documentId: string): void {
    this.#saveCoordinator.recordPanelDocument(panelId, documentId);
  }

  takePanelSaveAsDocument(panelId: string): string | null {
    return this.#saveCoordinator.takePanelDocument(panelId);
  }

  setEditingSuspended(suspended: boolean): void {
    this.#editingSuspended = suspended;
    this.#pathMutationGuards.syncSessions();
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
    this.#pathMutationGuards.syncDocument(document);
    this.#views.attach({
      document,
      editorSessionId: input.editorSessionId,
      parent: input.parent,
      presentation: input.presentation,
    });
    const session = this.#views.getSession(input.editorSessionId);
    if (session) {
      this.#gitGutter.attach(input.editorSessionId, document, session);
    }
    this.#pathMutationGuards.syncSessions();
  }

  updateViewPresentation(
    editorSessionId: string,
    presentation: FileEditorViewPresentation
  ): void {
    this.#views.updatePresentation(editorSessionId, presentation);
  }

  detachView(editorSessionId: string): void {
    this.#gitGutter.detach(editorSessionId);
    this.#views.detach(editorSessionId);
  }

  applySearchQuery(
    editorSessionId: string,
    search: string,
    replace: string,
    options: EditorSearchOptions,
    navigate = false
  ): EditorSearchState {
    return this.#views.applySearchQuery(
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
    return this.#views.clearSearch(editorSessionId, replace, options);
  }

  navigateSearch(
    editorSessionId: string,
    direction: "next" | "previous"
  ): EditorSearchState {
    return this.#views.navigateSearch(editorSessionId, direction);
  }

  replaceSearch(editorSessionId: string, all: boolean): EditorSearchState {
    return this.#views.replaceSearch(editorSessionId, all);
  }

  selectAllMatches(editorSessionId: string): EditorSearchState {
    return this.#views.selectAllMatches(editorSessionId);
  }

  async executeEditorCommand(
    documentId: string,
    editorSessionId: string,
    command: FileEditorCommand
  ): Promise<void> {
    await this.#views.execute(documentId, editorSessionId, command);
  }

  async savePanel(
    panelId: string | null,
    feedback: FileSaveFeedback = "all"
  ): Promise<FileSaveOutcome> {
    return await this.#saveCoordinator.savePanel(panelId, feedback);
  }

  async saveDocument(
    documentId: string,
    panelId?: string,
    feedback: FileSaveFeedback = "all"
  ): Promise<FileSaveOutcome> {
    const outcome = await this.#saveCoordinator.saveDocument(
      documentId,
      panelId,
      feedback
    );
    if (outcome === "saved") {
      this.#gitGutter.refreshByDocument(documentId);
    }
    return outcome;
  }

  async saveAsPanel(
    panelId: string | null,
    feedback: FileSaveFeedback = "all"
  ): Promise<FileSaveOutcome> {
    return await this.#saveCoordinator.saveAsPanel(panelId, feedback);
  }

  async settleDocument(
    documentId: string,
    panelId?: string,
    feedback: FileSaveFeedback = "all"
  ): Promise<FileDocumentSettleResult> {
    const result = await this.#saveCoordinator.settleDocument(
      documentId,
      panelId,
      feedback
    );
    if (result.outcome === "saved") {
      this.#gitGutter.refreshByDocument(documentId);
    }
    return result;
  }

  async confirmDocumentDurability(
    documentId: string,
    feedback: FileSaveFeedback = "all"
  ): Promise<boolean> {
    return await this.#documents.confirmDocumentDurability(
      documentId,
      feedback
    );
  }

  normalizeDocumentEol(documentId: string, eol: "crlf" | "lf"): void {
    normalizeDocumentEol(documentId, eol);
  }

  async showDraftProtectionError(message: string): Promise<void> {
    await this.#context.dialogs.alert({
      body: message,
      size: "default",
      title: this.#context.i18n.t(
        "files.draftProtection.failed",
        undefined,
        "Draft protection failed"
      ),
    });
  }

  async beginPathMutation(
    root: string,
    paths: readonly string[]
  ): Promise<FilePathMutationGuard> {
    return await this.#pathMutationGuards.begin(root, paths);
  }

  async documentsForPathMutation(
    root: string,
    paths: readonly string[]
  ): Promise<FilesDocument[]> {
    return await this.#pathMutationGuards.documentsFor(root, paths);
  }

  async preserveDocumentsAsUntitled(
    documents: readonly FilesDocument[]
  ): Promise<FilesDocument[]> {
    return await this.#pathMutations.preserveAsUntitled(documents);
  }

  clearGitGutter(editorSessionId: string): void {
    this.#gitGutter.clearSession(editorSessionId);
  }

  refreshGitGutterByDocument(documentId: string): void {
    this.#gitGutter.refreshByDocument(documentId);
  }

  dispose(options: { clearDocuments?: boolean } = {}): void {
    this.#gitGutter.dispose();
    this.#documents.dispose(options);
    this.#views.dispose();
    this.#modeHandlers.clear();
    this.#saveCoordinator.dispose();
    this.#pendingModes.clear();
    this.#pathMutationGuards.dispose();
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
}
