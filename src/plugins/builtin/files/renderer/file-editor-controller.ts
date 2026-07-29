import type {
  RendererPluginContext,
  RendererPluginFilesFacade,
} from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { FileDocumentLifecycle } from "./file-document-lifecycle.ts";
import { FileEditorControllerViewFacade } from "./file-editor-controller-view-commands.ts";
import { showFileEditorDiffMode } from "./file-editor-mode-handlers.ts";
import { moveEditorPath } from "./file-editor-move-path.ts";
import { FileEditorPathMutations } from "./file-editor-path-mutations.ts";
import { FileEditorSaveCommands } from "./file-editor-save-commands.ts";
import { FileEditorSaveCoordinator } from "./file-editor-save-coordinator.ts";
import { createFileEditorSessionId } from "./file-editor-session-id.ts";
import { createFileEditorTransferSupport } from "./file-editor-transfer-support.ts";
import { attachFileEditorView } from "./file-editor-view-attach.ts";
import { FileEditorViewPreferences } from "./file-editor-view-prefs.ts";
import type { FileEditorViewPresentation } from "./file-editor-view-session.ts";
import {
  type FilePathMutationGuard,
  FilePathMutationGuardCoordinator,
} from "./file-path-mutation-guard.ts";
import type { FileSaveFeedback } from "./file-save-feedback.ts";
import type {
  FileDocumentSettleResult,
  FileSaveOutcome,
} from "./file-save-outcome.ts";
import { getDocument, normalizeDocumentEol } from "./files-document-store.ts";
import type {
  FilesDocument,
  FilesDocumentOrigin,
  FilesDocumentPanelSource,
  FileViewMode,
} from "./files-document-types.ts";
import { FilesEditorGitGutterController } from "./files-editor-git-gutter-controller.ts";
import { FilesMutationGate } from "./files-mutation-gate.ts";
import { FilesMutationSuspendCoordinator } from "./files-mutation-suspend-coordinator.ts";
import { preserveDocumentsAsUntitledAndRebind } from "./files-preserve-as-untitled.ts";
import type { FilesWatchHub } from "./files-watch-hub.ts";

export type { FileEditorNavigationResult } from "./file-editor-controller-view-commands.ts";

/** Documents + CodeMirror lifecycle for the files plugin. */
export class FileEditorController extends FileEditorControllerViewFacade {
  readonly #context: RendererPluginContext;
  readonly #documents: FileDocumentLifecycle;
  readonly #gitGutter: FilesEditorGitGutterController;
  readonly #modeHandlers = new Map<string, (mode: FileViewMode) => void>();
  readonly #mutationGate = new FilesMutationGate();
  readonly #mutationSuspend = new FilesMutationSuspendCoordinator(
    this.#mutationGate
  );
  readonly #pathMutationGuards: FilePathMutationGuardCoordinator;
  readonly #pathMutations: FileEditorPathMutations;
  readonly #pendingModes = new Map<string, FileViewMode>();
  readonly #saveCoordinator: FileEditorSaveCoordinator;
  #editingSuspended = false;
  readonly #preferences: FileEditorViewPreferences;
  readonly readDocument: RendererPluginFilesFacade["readDocument"];

  constructor(context: RendererPluginContext, watchHub: FilesWatchHub) {
    super();
    this.#context = context;
    this.readDocument = (request) => this.#context.files.readDocument(request);
    this.#gitGutter = new FilesEditorGitGutterController(context);
    this.#pathMutationGuards = new FilePathMutationGuardCoordinator({
      context,
      isEditingSuspended: () => this.#editingSuspended,
      sessions: () => this.views.values(),
    });
    this.#documents = new FileDocumentLifecycle({
      context,
      onDocumentsChanged: () => {
        this.views.syncDocuments();
        this.viewCommands.consumePendingLocations();
      },
      onShowDiff: (documentId, panelId) => {
        showFileEditorDiffMode({
          documentId,
          getPanelDocumentId: (id) => this.#documents.getPanelDocumentId(id),
          modeHandlers: this.#modeHandlers,
          pendingModes: this.#pendingModes,
          ...(panelId ? { preferredPanelId: panelId } : {}),
        });
      },
      watchHub,
    });
    this.#pathMutations = new FileEditorPathMutations({
      documents: this.#documents,
      onRemoveDocuments: (documentIds) => {
        for (const documentId of documentIds) {
          this.viewCommands.disposeDocument(documentId);
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
    this.#preferences = new FileEditorViewPreferences(context, this.views);
  }

  protected override getPanelDocumentIdForViewCommands(
    panelId: string
  ): string | null {
    return this.#documents.getPanelDocumentId(panelId);
  }
  async initialize(): Promise<void> {
    await this.#documents.initialize();
  }
  async runMutation<T>(
    operation: () => Promise<T> | T,
    scope?: { documentId?: string; panelId?: string }
  ): Promise<T> {
    return await this.#mutationSuspend.run(operation, scope);
  }
  async suspendMutations(signal: AbortSignal): Promise<void> {
    await this.#mutationSuspend.suspend({ kind: "all" }, signal);
    try {
      await this.#documents.prepareSuspend(signal);
    } catch (error) {
      this.#mutationSuspend.resume({ kind: "all" });
      throw error;
    }
  }

  resumeMutations(): void {
    this.#documents.resumeAfterSuspend();
    this.#mutationSuspend.resume({ kind: "all" });
  }

  createTransferSupport() {
    return createFileEditorTransferSupport({
      mutationSuspend: this.#mutationSuspend,
      views: this.views,
    });
  }

  documentId(source: FilesDocumentPanelSource): string {
    return this.#documents.documentId(source);
  }

  documentIdForPanel(panelId: string): string | null {
    return this.#documents.getPanelDocumentId(panelId);
  }

  createUntitledDocument(input: {
    contents: string;
    origin?: FilesDocumentOrigin;
  }): FilesDocument {
    return this.#documents.createUntitledDocument(input);
  }

  acquirePanel(panelId: string, source: FilesDocumentPanelSource): () => void {
    const previousDocumentId = this.#documents.getPanelDocumentId(panelId);
    const documentId = this.documentId(source);
    this.viewCommands.prepareDocumentReplacement(
      createFileEditorSessionId(panelId),
      previousDocumentId,
      documentId
    );
    const release = this.#documents.acquirePanel(panelId, source);
    const document = getDocument(documentId);
    if (document) {
      this.#pathMutationGuards.syncDocument(document);
    }
    return release;
  }

  getPanelSource(panelId: string): FilesDocumentPanelSource | null {
    return this.#documents.getPanelSource(panelId);
  }

  closePanel(input: {
    hasOtherOpenInstance: boolean;
    panelId: string;
    source: FilesDocumentPanelSource;
  }): void {
    const documentId =
      this.#documents.getPanelDocumentId(input.panelId) ??
      this.documentId(input.source);
    this.viewCommands.clearOwnerDocument(
      createFileEditorSessionId(input.panelId),
      documentId
    );
    this.#modeHandlers.delete(input.panelId);
    this.#pendingModes.delete(input.panelId);
    this.#documents.closePanel(input);
  }

  discardDocument(documentId: string): void {
    const document = getDocument(documentId);
    if (document) {
      this.viewCommands.disposeDocument(document.id);
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
    await moveEditorPath({
      beginMove: (moveRoot, from, to) =>
        this.#pathMutationGuards.beginMove(moveRoot, from, to),
      context: this.#context,
      moveDiskDocumentSource: (moveRoot, from, to, affected) =>
        this.moveDiskDocumentSource(moveRoot, from, to, affected),
      newPath,
      oldPath,
      prepare: (documents) => this.#pathMutations.prepare(documents),
      root,
    });
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

  showSourceMode(panelId: string): void {
    const handler = this.#modeHandlers.get(panelId);
    if (handler) {
      handler("source");
      this.#pendingModes.delete(panelId);
      return;
    }
    this.#pendingModes.set(panelId, "source");
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
    panelContext?: PanelContext;
    parent: HTMLElement;
    presentation: FileEditorViewPresentation;
  }): void {
    this.viewCommands.prepareDocumentReplacement(
      input.editorSessionId,
      this.views.getSession(input.editorSessionId)?.documentId,
      input.documentId
    );
    attachFileEditorView({
      documentId: input.documentId,
      editorPrefs: this.#preferences.editorPrefs,
      editorSessionId: input.editorSessionId,
      gitGutter: this.#gitGutter,
      minimapEnabled: this.#preferences.minimapEnabled,
      ...(input.panelContext ? { panelContext: input.panelContext } : {}),
      parent: input.parent,
      pathMutationGuards: this.#pathMutationGuards,
      viewCommands: this.viewCommands,
      presentation: input.presentation,
      views: this.views,
    });
  }

  detachView(editorSessionId: string, parent?: HTMLElement): void {
    const detached = this.views.detach(editorSessionId, parent);
    if (detached) {
      this.#gitGutter.detach(editorSessionId);
    }
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
      title: this.#context.i18n.t(
        "files.draftProtection.failed",
        undefined,
        "Unable to auto-save draft"
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
    this.#mutationSuspend.resumeAll();
    this.#preferences.dispose();
    this.#gitGutter.dispose();
    this.#documents.dispose(options);
    this.views.dispose();
    this.#modeHandlers.clear();
    this.#saveCoordinator.dispose();
    this.#pendingModes.clear();
    this.viewCommands.clear();
    this.#pathMutationGuards.dispose();
  }
}
