import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileWatchEvent } from "@shared/contracts/file-watch.ts";
import {
  FILES_AUTO_SAVE_DELAY_MS,
  FILES_AUTO_SAVE_SETTING_KEY,
} from "../settings.ts";
import { FileDocumentLoader } from "./file-document-loader.ts";
import { FileDocumentPanelRegistry } from "./file-document-panel-registry.ts";
import { FileDocumentSaver } from "./file-document-saver.ts";
import type { FileSaveOutcome } from "./file-save-outcome.ts";
import { diskDocumentId } from "./files-document-paths.ts";
import {
  clearFilesDocumentStore,
  configureFilesDraftBackend,
  createUntitledMarkdownDocument,
  ensureDiskDocument,
  getDocument,
  getDocumentForPanelSource,
  listOpenDiskDocuments,
  markDocumentDiskConflict,
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
import type { FilesWatchHub } from "./files-watch-hub.ts";

export class FileDocumentLifecycle {
  readonly #context: RendererPluginContext;
  readonly #lastContents = new Map<string, string>();
  readonly #loader: FileDocumentLoader;
  readonly #onDocumentsChanged: () => void;
  readonly #panels: FileDocumentPanelRegistry;
  readonly #saver: FileDocumentSaver;
  readonly #saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  #autoSaveEnabled: boolean;
  #configurationDispose: (() => void) | null;
  #disposed = false;
  #initialized = false;
  #storeDispose: (() => void) | null;

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
    if (this.#initialized) {
      return;
    }
    this.#initialized = true;
    await configureFilesDraftBackend(this.#context.files.drafts);
  }

  documentId(source: FilesDocumentPanelSource): string {
    return source.kind === "untitled"
      ? source.id
      : diskDocumentId(source.root, source.path);
  }

  ensureDocument(source: FilesDocumentPanelSource): FilesDocument | null {
    if (source.kind === "untitled") {
      return (
        getDocument(source.id) ?? restoreUntitledDocumentFromPanelSource(source)
      );
    }
    const document = ensureDiskDocument({
      path: source.path,
      root: source.root,
    });
    this.#loader.start(document.id, false);
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
    if (document && !document.dirty) {
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

  preparePathMutation(documentId: string): void {
    this.#loader.invalidate(documentId);
    this.#saver.invalidate(documentId);
    markDocumentSaveIdle(documentId);
    this.#clearSaveTimer(documentId);
    this.#lastContents.delete(documentId);
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
      clearFilesDocumentStore();
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
    const paths = new Set(event.changes.map((change) => change.path));
    const acquired = this.#panels.documentIdsForRoot(event.root);
    for (const document of listOpenDiskDocuments()) {
      if (
        document.source.kind !== "disk" ||
        !acquired.has(document.id) ||
        !(paths.has(document.source.path) || paths.has("."))
      ) {
        continue;
      }
      if (document.dirty) {
        markDocumentDiskConflict(document.id);
      } else {
        this.#loader.start(document.id, true);
      }
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
