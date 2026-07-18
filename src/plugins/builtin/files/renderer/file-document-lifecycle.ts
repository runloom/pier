import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileWatchEvent } from "@shared/contracts/file-watch.ts";
import {
  FILES_AUTO_SAVE_DELAY_MS,
  FILES_AUTO_SAVE_SETTING_KEY,
} from "../settings.ts";
import { FileDocumentLoader } from "./file-document-loader.ts";
import { FileDocumentPanelRegistry } from "./file-document-panel-registry.ts";
import { FileDocumentSaver } from "./file-document-saver.ts";
import type { FileSaveFeedback } from "./file-save-feedback.ts";
import type { FileSaveOutcome } from "./file-save-outcome.ts";
import {
  diskDocumentId,
  isSamePathOrDescendant,
} from "./files-document-paths.ts";
import {
  claimLegacyDraftForPanelSource,
  clearFilesDocumentStore,
  configureFilesDraftBackend,
  createUntitledMarkdownDocument,
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
} from "./files-document-store.ts";
import type {
  FilesDocument,
  FilesDocumentOrigin,
  FilesDocumentPanelSource,
} from "./files-document-types.ts";
import { FilesDraftRecoveryReporter } from "./files-draft-recovery-reporter.ts";
import type { FilesWatchHub } from "./files-watch-hub.ts";

export class FileDocumentLifecycle {
  readonly #context: RendererPluginContext;
  readonly #lastContents = new Map<string, string>();
  readonly #legacyClaims = new Map<string, Promise<void>>();
  readonly #loader: FileDocumentLoader;
  readonly #onDocumentsChanged: () => void;
  readonly #panels: FileDocumentPanelRegistry;
  readonly #draftRecoveryReporter = new FilesDraftRecoveryReporter();
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
          this.#clearAllSaveTimers();
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
      : diskDocumentId(source.root, source.path);
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
      path: source.path,
      root: source.root,
    });
    this.#loader.start(document.id, false);
    this.#claimLegacySource(source);
    return document;
  }

  createUntitledDocument(input: {
    contents: string;
    origin?: FilesDocumentOrigin;
  }): FilesDocument {
    return createUntitledMarkdownDocument(input);
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

  discardDocument(documentId: string): void {
    const document = getDocument(documentId);
    if (!document) {
      return;
    }
    this.#loader.invalidate(document.id);
    this.#saver.invalidate(document.id);
    this.#clearSaveTimer(document.id);
    this.#lastContents.delete(document.id);
    removeDocument(document.id);
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
    this.#clearSaveTimer(documentId);
    this.#lastContents.delete(documentId);
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
    this.#clearAllSaveTimers();
    try {
      await Promise.all([
        this.#loader.waitForIdle(signal),
        this.#saver.waitForIdle(signal),
      ]);
    } catch (error) {
      this.#suspending = false;
      this.#scheduleAllDirtyDocuments();
      throw error;
    }
  }

  resumeAfterSuspend(): void {
    this.#suspending = false;
    if (this.#reloadAfterSuspend) {
      this.#reloadAfterSuspend = false;
      for (const documentId of this.#panels.documentIds()) {
        this.#loader.start(documentId, true);
      }
    }
    this.#scheduleAllDirtyDocuments();
  }

  async #showDurabilityError(message: string): Promise<void> {
    await this.#context.dialogs.alert({
      body: message,
      size: "default",
      title: this.#context.i18n.t(
        "filePanel.durability.confirmFailed",
        undefined,
        "Unable to confirm that the file was saved"
      ),
    });
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
    this.#clearAllSaveTimers();
    this.#panels.dispose();
    this.#loader.dispose();
    this.#saver.dispose();
    if (options.clearDocuments) {
      clearFilesDocumentStore({ persisted: false });
    }
  }

  #handleDocumentStoreChange(): void {
    for (const documentId of this.#panels.documentIds()) {
      const document = getDocument(documentId);
      if (!document) {
        continue;
      }
      const previousContents = this.#lastContents.get(document.id);
      this.#lastContents.set(document.id, document.currentContents);
      if (!document.dirty) {
        this.#clearSaveTimer(document.id);
      } else if (previousContents !== document.currentContents) {
        this.#scheduleAutoSave(document);
      }
    }
  }

  #scheduleAllDirtyDocuments(): void {
    for (const documentId of this.#panels.documentIds()) {
      const document = getDocument(documentId);
      if (document?.dirty) {
        this.#scheduleAutoSave(document);
      }
    }
  }

  #scheduleAutoSave(document: FilesDocument): void {
    this.#clearSaveTimer(document.id);
    if (
      this.#suspending ||
      !(this.#autoSaveEnabled && document.dirty) ||
      document.source.kind !== "disk" ||
      document.saveState === "saving"
    ) {
      return;
    }
    const timer = setTimeout(() => {
      this.#saveTimers.delete(document.id);
      this.saveDocument(
        document.id,
        this.#panelIdForDocument(document.id) ?? undefined
      ).catch(() => undefined);
    }, FILES_AUTO_SAVE_DELAY_MS);
    this.#saveTimers.set(document.id, timer);
  }

  #handleFileWatch(event: FileWatchEvent): void {
    if (this.#suspending) {
      this.#reloadAfterSuspend = true;
      return;
    }
    const paths = event.changes.map((change) => change.path);
    const acquired = this.#panels.documentIdsForRoot(event.root);
    for (const document of listOpenDiskDocuments()) {
      if (document.source.kind !== "disk" || !acquired.has(document.id)) {
        continue;
      }
      const locatorPath = document.source.path;
      const affected = paths.some(
        (path) =>
          path === "." ||
          isSamePathOrDescendant(locatorPath, path) ||
          (document.canonicalPath !== null &&
            isSamePathOrDescendant(document.canonicalPath, path))
      );
      if (!affected) {
        continue;
      }
      this.#loader.start(document.id, true);
    }
  }

  #clearSaveTimer(documentId: string): void {
    const timer = this.#saveTimers.get(documentId);
    if (timer) {
      clearTimeout(timer);
      this.#saveTimers.delete(documentId);
    }
  }

  #panelIdForDocument(documentId: string): string | null {
    return this.#panels.panelIdForDocument(documentId);
  }

  #clearAllSaveTimers(): void {
    for (const timer of this.#saveTimers.values()) {
      clearTimeout(timer);
    }
    this.#saveTimers.clear();
  }
}
