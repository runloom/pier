import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileWatchEvent } from "@shared/contracts/file/watch.ts";
import { FILES_AUTO_SAVE_SETTING_KEY } from "../../settings.ts";
import { showFileDurabilityError } from "../panel/dialog-feedback.ts";
import type { FileSaveFeedback } from "../save/feedback.ts";
import type { FileSaveOutcome } from "../save/outcome.ts";
import type { FilesWatchHub } from "../watch-hub.ts";
import { reloadDiskDocument } from "./disk-reload.ts";
import { FilesDraftRecoveryReporter } from "./draft-recovery-reporter.ts";
import {
  clearAllDocumentAutoSaveTimers,
  clearDocumentAutoSaveTimer,
  handleDocumentStoreChangeForLiveSync,
  handleFileWatchForLiveSync,
  scheduleAllDirtyDocumentsForLiveSync,
  scheduleDocumentAutoSave,
} from "./live-sync.ts";
import { FileDocumentLoader } from "./loader.ts";
import { OpenDocumentReconciler } from "./open-reconcile.ts";
import { FileDocumentPanelRegistry } from "./panel-registry.ts";
import { isSamePathOrDescendant } from "./paths.ts";
import { FileDocumentSaver } from "./saver.ts";
import {
  claimLegacyDraftForPanelSource,
  clearFilesDocumentStore,
  configureFilesDraftBackend,
  createUntitledDocument as createUntitledStoreDocument,
  dismissDocumentDiskConflict,
  ensureDiskDocument,
  getDocument,
  getDocumentForPanelSource,
  listOpenDiskDocuments,
  markDocumentDiskConflict,
  markDocumentDurabilityConfirmed,
  markDocumentDurabilityError,
  markDocumentPathReconciled,
  markDocumentSaveIdle,
  removeDocument,
  restoreUntitledDocumentFromPanelSource,
  subscribeFilesDocumentStore,
} from "./store.ts";
import {
  type FilesDocument,
  type FilesDocumentPanelSource,
  resolveDiskDocumentId,
} from "./types.ts";

export class FileDocumentLifecycle {
  readonly #context: RendererPluginContext;
  readonly #lastContents = new Map<string, string>();
  readonly #lastDirty = new Map<string, boolean>();
  readonly #legacyClaims = new Map<string, Promise<void>>();
  readonly #loader: FileDocumentLoader;
  readonly #onDocumentsChanged: () => void;
  readonly #panels: FileDocumentPanelRegistry;
  readonly #draftRecoveryReporter = new FilesDraftRecoveryReporter();
  readonly #reconciler: OpenDocumentReconciler;
  readonly #saver: FileDocumentSaver;
  readonly #saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  #autoSaveEnabled: boolean;
  #configurationDispose: (() => void) | null;
  #disposed = false;
  #initialization: Promise<readonly string[]> | null = null;
  #initializationReloadsStarted = false;
  #reloadAfterSuspend = false;
  #storeDispose: (() => void) | null;
  #suspending = false;

  constructor(input: {
    context: RendererPluginContext;
    onDocumentsChanged: () => void;
    onShowDiff: (documentId: string, panelId?: string) => void;
    watchHub: FilesWatchHub;
  }) {
    this.#context = input.context;
    this.#onDocumentsChanged = input.onDocumentsChanged;
    this.#loader = new FileDocumentLoader(input.context);
    this.#saver = new FileDocumentSaver({
      context: input.context,
      onShowDiff: input.onShowDiff,
    });
    this.#panels = new FileDocumentPanelRegistry({
      onFileWatch: (event) => this.#handleFileWatch(event),
      watchHub: input.watchHub,
    });
    this.#reconciler = new OpenDocumentReconciler({
      context: input.context,
      getDocumentIds: () => this.#panels.documentIds(),
      loader: this.#loader,
    });
    this.#reconciler.start();
    this.#autoSaveEnabled =
      input.context.configuration.get<boolean>(FILES_AUTO_SAVE_SETTING_KEY) ===
      true;
    this.#configurationDispose = input.context.configuration.onDidChange(
      (event) => {
        if (!event.affectsConfiguration(FILES_AUTO_SAVE_SETTING_KEY)) {
          return;
        }
        this.#autoSaveEnabled =
          input.context.configuration.get<boolean>(
            FILES_AUTO_SAVE_SETTING_KEY
          ) === true;
        if (this.#autoSaveEnabled) {
          this.#scheduleAllDirtyDocuments();
        } else {
          clearAllDocumentAutoSaveTimers(this.#saveTimers);
        }
      }
    );
    this.#storeDispose = subscribeFilesDocumentStore(() => {
      this.#handleDocumentStoreChange();
      this.#onDocumentsChanged();
    });
  }
  async initialize(): Promise<void> {
    if (!this.#initialization) {
      this.#initialization = configureFilesDraftBackend(
        this.#context.files.drafts
      )
        .then((documentIds) => {
          this.#draftRecoveryReporter
            .reportAvailable(this.#context)
            .catch((error: unknown) =>
              this.#draftRecoveryReporter.report(this.#context, error)
            );
          return documentIds;
        })
        .catch(async (error: unknown) => {
          await this.#draftRecoveryReporter.report(this.#context, error);
          throw error;
        });
    }
    const initialization = this.#initialization;
    let hydratedDocumentIds: readonly string[];
    try {
      hydratedDocumentIds = await initialization;
    } catch (error) {
      if (this.#initialization === initialization) {
        this.#initialization = null;
      }
      throw error;
    }
    if (!this.#initializationReloadsStarted) {
      this.#initializationReloadsStarted = true;
      for (const documentId of hydratedDocumentIds) {
        const document = getDocument(documentId);
        if (
          document?.source.kind === "disk" &&
          this.#panels.documentIds().has(document.id)
        ) {
          this.#loader.start(document.id, true);
        }
      }
    }
  }
  documentId(source: FilesDocumentPanelSource): string {
    return source.kind === "untitled"
      ? source.id
      : resolveDiskDocumentId(source);
  }
  ensureDocument(source: FilesDocumentPanelSource): FilesDocument | null {
    if (source.kind === "untitled") {
      const document =
        getDocument(source.id) ??
        restoreUntitledDocumentFromPanelSource(source);
      if (!document) {
        this.#claimLegacySource(source);
      }
      return document;
    }
    const document = ensureDiskDocument({
      ...(source.documentId ? { documentId: source.documentId } : {}),
      path: source.path,
      root: source.root,
    });
    this.#loader.start(document.id, false);
    this.#claimLegacySource(source);
    return document;
  }
  createUntitledDocument(
    input: Parameters<typeof createUntitledStoreDocument>[0]
  ): FilesDocument {
    return createUntitledStoreDocument(input);
  }
  acquirePanel(panelId: string, source: FilesDocumentPanelSource): () => void {
    const document = this.ensureDocument(source);
    const release = this.#panels.acquire({
      documentId: document?.id ?? this.documentId(source),
      panelId,
      source,
    });
    if (document) {
      this.#lastContents.set(document.id, document.currentContents);
      this.#lastDirty.set(document.id, document.dirty);
      this.#scheduleAutoSave(document);
    }
    return release;
  }
  closePanel(input: {
    hasOtherOpenInstance: boolean;
    source: FilesDocumentPanelSource;
  }): void {
    if (input.hasOtherOpenInstance) {
      return;
    }
    const document = getDocumentForPanelSource(input.source);
    if (
      document &&
      !(document.dirty || document.needsSaveAs || document.durabilityUnknown)
    ) {
      this.discardDocument(document.id);
    }
  }
  getPanelDocumentId(panelId: string): string | null {
    return this.#panels.documentId(panelId);
  }
  getPanelSource(panelId: string): FilesDocumentPanelSource | null {
    return this.#panels.source(panelId);
  }

  discardDocument(documentId: string): void {
    const document = getDocument(documentId);
    if (!document) {
      return;
    }
    this.#loader.invalidate(document.id);
    this.#saver.invalidate(document.id);
    clearDocumentAutoSaveTimer(this.#saveTimers, document.id);
    this.#lastContents.delete(document.id);
    this.#lastDirty.delete(document.id);
    removeDocument(document.id);
  }

  async reloadDocumentFromDisk(
    documentId: string,
    options: { forceAdopt?: boolean } = {}
  ): Promise<void> {
    await reloadDiskDocument({
      context: this.#context,
      documentId,
      forceAdopt: options.forceAdopt === true,
      loader: this.#loader,
      unavailable: this.#disposed || this.#suspending,
    });
  }

  dismissDocumentDiskConflict(documentId: string): void {
    dismissDocumentDiskConflict(documentId);
  }

  #claimLegacySource(source: FilesDocumentPanelSource): void {
    const claimId = this.documentId(source);
    if (this.#legacyClaims.has(claimId)) {
      return;
    }
    const claim = this.initialize()
      .then(async () => {
        await claimLegacyDraftForPanelSource(source);
      })
      .catch(async (error: unknown) => {
        await this.#draftRecoveryReporter.report(this.#context, error);
      })
      .finally(() => {
        this.#legacyClaims.delete(claimId);
      });
    this.#legacyClaims.set(claimId, claim);
  }

  preparePathMutation(documentId: string): void {
    this.#loader.invalidate(documentId);
    this.#saver.invalidate(documentId);
    markDocumentSaveIdle(documentId);
    clearDocumentAutoSaveTimer(this.#saveTimers, documentId);
    this.#lastContents.delete(documentId);
    this.#lastDirty.delete(documentId);
  }
  async reconcileMovedPath(root: string, path: string): Promise<void> {
    const documents = listOpenDiskDocuments().filter(
      (document) =>
        document.source.kind === "disk" &&
        document.source.root === root &&
        isSamePathOrDescendant(document.source.path, path)
    );
    const results = await Promise.allSettled(
      documents.map(async (document) => {
        if (document.source.kind !== "disk") {
          return;
        }
        const result = await this.#context.files.readDocument({
          path: document.source.path,
          root: document.source.root,
        });
        markDocumentPathReconciled(document.id, result);
      })
    );
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "Moved files could not be reconciled with their new paths"
      );
    }
  }
  async savePanel(panelId: string | null): Promise<FileSaveOutcome> {
    if (!panelId) {
      return "noop";
    }
    const documentId = this.getPanelDocumentId(panelId);
    return documentId ? await this.saveDocument(documentId, panelId) : "noop";
  }
  async saveDocument(
    documentId: string,
    panelId?: string
  ): Promise<FileSaveOutcome> {
    const outcome = await this.#saver.save(documentId, panelId);
    const latest = getDocument(documentId);
    if (outcome === "saved" && latest?.dirty) {
      this.#scheduleAutoSave(latest);
    }
    return outcome;
  }

  async confirmDocumentDurability(
    documentId: string,
    feedback: FileSaveFeedback = "all"
  ): Promise<boolean> {
    const document = getDocument(documentId);
    if (
      document?.source.kind !== "disk" ||
      !document.durabilityUnknown ||
      !document.revision
    ) {
      return false;
    }
    const expectedRevision = document.revision;
    let result: Awaited<
      ReturnType<RendererPluginContext["files"]["confirmDurability"]>
    >;
    try {
      result = await this.#context.files.confirmDurability({
        expectedRevision,
        path: document.source.path,
        root: document.source.root,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      markDocumentDurabilityError(document.id, message);
      if (feedback !== "none") {
        await this.#showDurabilityError(message);
      }
      return false;
    }
    const latest = getDocument(document.id);
    if (!latest || latest.revision !== expectedRevision) {
      return false;
    }
    if (result.kind === "confirmed") {
      markDocumentDurabilityConfirmed(document.id, result.revision);
      const confirmed = getDocument(document.id);
      if (confirmed?.dirty) {
        this.#scheduleAutoSave(confirmed);
      }
      return true;
    }
    const message =
      result.kind === "revision-mismatch"
        ? this.#context.i18n.t(
            "filePanel.durability.revisionMismatch",
            undefined,
            "The file changed again after it was written. Please check it."
          )
        : result.message;
    markDocumentDurabilityError(document.id, message);
    if (result.kind === "revision-mismatch") {
      markDocumentDiskConflict(document.id);
    }
    if (feedback !== "none") {
      await this.#showDurabilityError(message);
    }
    return false;
  }

  async prepareSuspend(signal: AbortSignal): Promise<void> {
    this.#suspending = true;
    this.#reconciler.stop();
    clearAllDocumentAutoSaveTimers(this.#saveTimers);
    try {
      await Promise.all([
        this.#loader.waitForIdle(signal),
        this.#saver.waitForIdle(signal),
      ]);
    } catch (error) {
      this.#suspending = false;
      this.#reconciler.start();
      this.#scheduleAllDirtyDocuments();
      throw error;
    }
  }

  resumeAfterSuspend(): void {
    this.#suspending = false;
    this.#reconciler.start();
    if (this.#reloadAfterSuspend) {
      this.#reloadAfterSuspend = false;
      for (const documentId of this.#panels.documentIds()) {
        this.#loader.start(documentId, true);
      }
    } else {
      this.#reconciler.reconcileSoon();
    }
    this.#scheduleAllDirtyDocuments();
  }

  async #showDurabilityError(message: string): Promise<void> {
    await showFileDurabilityError(this.#context, message);
  }

  dispose(options: { clearDocuments?: boolean } = {}): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#configurationDispose?.();
    this.#configurationDispose = null;
    this.#storeDispose?.();
    this.#storeDispose = null;
    clearAllDocumentAutoSaveTimers(this.#saveTimers);
    this.#reconciler.dispose();
    this.#panels.dispose();
    this.#loader.dispose();
    this.#saver.dispose();
    if (options.clearDocuments) {
      clearFilesDocumentStore({ persisted: false });
    }
  }

  #handleDocumentStoreChange(): void {
    handleDocumentStoreChangeForLiveSync({
      autoSaveEnabled: this.#autoSaveEnabled,
      lastContents: this.#lastContents,
      lastDirty: this.#lastDirty,
      loader: this.#loader,
      panelDocumentIds: this.#panels.documentIds(),
      panelIdForDocument: (documentId) =>
        this.#panels.panelIdForDocument(documentId),
      saveDocument: (documentId, panelId) =>
        this.saveDocument(documentId, panelId),
      saveTimers: this.#saveTimers,
      suspending: this.#suspending,
    });
  }

  #scheduleAllDirtyDocuments(): void {
    scheduleAllDirtyDocumentsForLiveSync({
      autoSaveEnabled: this.#autoSaveEnabled,
      panelDocumentIds: this.#panels.documentIds(),
      panelIdForDocument: (documentId) =>
        this.#panels.panelIdForDocument(documentId),
      saveDocument: (documentId, panelId) =>
        this.saveDocument(documentId, panelId),
      saveTimers: this.#saveTimers,
      suspending: this.#suspending,
    });
  }

  #scheduleAutoSave(document: FilesDocument): void {
    scheduleDocumentAutoSave({
      autoSaveEnabled: this.#autoSaveEnabled,
      document,
      panelId: this.#panels.panelIdForDocument(document.id),
      saveDocument: (documentId, panelId) =>
        this.saveDocument(documentId, panelId),
      saveTimers: this.#saveTimers,
      suspending: this.#suspending,
    });
  }

  #handleFileWatch(event: FileWatchEvent): void {
    handleFileWatchForLiveSync({
      event,
      loader: this.#loader,
      markReloadAfterSuspend: () => {
        this.#reloadAfterSuspend = true;
      },
      panels: this.#panels,
      suspending: this.#suspending,
    });
  }
}
