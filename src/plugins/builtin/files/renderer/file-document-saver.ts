import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  fileEditorErrorMessage,
  isFileConflictError,
} from "./file-editor-errors.ts";
import type { FileSaveOutcome } from "./file-save-outcome.ts";
import {
  getDocument,
  markDocumentSaved,
  markDocumentSaveError,
  markDocumentSaveIdle,
  markDocumentSaving,
  setDocumentConflictContents,
} from "./files-document-store.ts";
import type { FilesDocument } from "./files-document-types.ts";

type DiskDocument = FilesDocument & {
  source: Extract<FilesDocument["source"], { kind: "disk" }>;
};

export class FileDocumentSaver {
  readonly #context: RendererPluginContext;
  readonly #documentEpochs = new Map<string, number>();
  readonly #onShowDiff: (documentId: string, panelId?: string) => void;
  readonly #operations = new Map<string, Promise<FileSaveOutcome>>();
  #disposed = false;

  constructor(input: {
    context: RendererPluginContext;
    onShowDiff: (documentId: string, panelId?: string) => void;
  }) {
    this.#context = input.context;
    this.#onShowDiff = input.onShowDiff;
  }

  invalidate(documentId: string): void {
    this.#documentEpochs.set(
      documentId,
      (this.#documentEpochs.get(documentId) ?? 0) + 1
    );
    this.#operations.delete(documentId);
  }

  async save(documentId: string, panelId?: string): Promise<FileSaveOutcome> {
    if (this.#disposed) {
      return "noop";
    }
    const document = getDocument(documentId);
    if (!document) {
      return "noop";
    }
    const existing = this.#operations.get(document.id);
    if (existing) {
      return await existing;
    }
    const operation = this.#perform(document.id, panelId);
    this.#operations.set(document.id, operation);
    try {
      return await operation;
    } finally {
      if (this.#operations.get(document.id) === operation) {
        this.#operations.delete(document.id);
      }
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#operations.clear();
    this.#documentEpochs.clear();
  }

  async #perform(
    documentId: string,
    panelId?: string
  ): Promise<FileSaveOutcome> {
    const document = getDocument(documentId);
    if (!this.#canSave(document)) {
      return "noop";
    }
    const savedContents = document.currentContents;
    const epoch = this.#documentEpochs.get(document.id) ?? 0;
    markDocumentSaving(document.id);
    try {
      const mtimeMs = await this.#write(
        document,
        savedContents,
        epoch,
        panelId
      );
      if (typeof mtimeMs !== "number") {
        return mtimeMs;
      }
      if (!this.#isCurrent(document.id, epoch)) {
        return "noop";
      }
      markDocumentSaved(document.id, savedContents, mtimeMs);
      return "saved";
    } catch (error) {
      if (this.#isCurrent(document.id, epoch)) {
        markDocumentSaveError(
          document.id,
          fileEditorErrorMessage(
            error,
            this.#t(
              "filePanel.errors.save.fallback",
              "Unable to save file contents."
            )
          )
        );
      }
      return "failed";
    } finally {
      if (this.#isCurrent(document.id, epoch)) {
        markDocumentSaveIdle(document.id);
      }
    }
  }

  #canSave(document: FilesDocument | null): document is DiskDocument {
    return Boolean(
      document?.source.kind === "disk" &&
        document.capabilities.includes("save") &&
        document.dirty &&
        !document.readOnly &&
        document.loadState === "loaded"
    );
  }

  async #write(
    document: DiskDocument,
    contents: string,
    epoch: number,
    panelId?: string
  ): Promise<number | "cancelled" | "compare" | "noop"> {
    try {
      const result = await this.#context.files.writeText({
        contents,
        ...(document.baseMtimeMs == null
          ? {}
          : { expectedMtimeMs: document.baseMtimeMs }),
        path: document.source.path,
        root: document.source.root,
      });
      return result.mtimeMs;
    } catch (error) {
      if (!isFileConflictError(error)) {
        throw error;
      }
    }
    if (!this.#isCurrent(document.id, epoch)) {
      return "noop";
    }
    const choice = await this.#resolveConflict();
    if (!this.#isCurrent(document.id, epoch)) {
      return "noop";
    }
    if (choice === "cancel") {
      return "cancelled";
    }
    if (choice === "compare") {
      const diskContents = await this.#context.files.readText({
        path: document.source.path,
        root: document.source.root,
      });
      if (!this.#isCurrent(document.id, epoch)) {
        return "noop";
      }
      setDocumentConflictContents(document.id, diskContents);
      this.#onShowDiff(document.id, panelId);
      return "compare";
    }
    const result = await this.#context.files.writeText({
      contents,
      path: document.source.path,
      root: document.source.root,
    });
    return result.mtimeMs;
  }

  #isCurrent(documentId: string, epoch: number): boolean {
    return Boolean(
      !this.#disposed &&
        getDocument(documentId) &&
        (this.#documentEpochs.get(documentId) ?? 0) === epoch
    );
  }

  async #resolveConflict(): Promise<"cancel" | "compare" | "overwrite"> {
    const choice = await this.#context.dialogs.choice({
      altLabel: this.#t("filePanel.conflict.compareLabel", "Compare"),
      body: this.#t(
        "filePanel.conflict.body",
        "The file has been modified outside Pier. Overwrite it anyway?"
      ),
      cancelLabel: this.#t("filePanel.conflict.cancelLabel", "Cancel"),
      confirmLabel: this.#t("filePanel.conflict.confirmLabel", "Overwrite"),
      intent: "destructive",
      size: "sm",
      title: this.#t("filePanel.conflict.title", "File changed on disk"),
    });
    if (choice === "confirm") {
      return "overwrite";
    }
    return choice === "alt" ? "compare" : "cancel";
  }

  #t(key: string, fallback: string): string {
    return this.#context.i18n.t(key, undefined, fallback);
  }
}
