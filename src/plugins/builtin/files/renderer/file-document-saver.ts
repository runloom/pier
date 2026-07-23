import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type {
  FileDocumentExpectedState,
  FileDocumentWriteResult,
  FileWritableDocumentEol,
} from "@shared/contracts/file.ts";
import { fileEditorErrorMessage } from "./file-editor-errors.ts";
import type { FileSaveOutcome } from "./file-save-outcome.ts";
import { waitForSettledWithAbort } from "./files-async-drain.ts";
import {
  getDocument,
  markDocumentSaveError,
  markDocumentSaveIdle,
  markDocumentSaving,
  markDocumentWritten,
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

  async waitForIdle(signal: AbortSignal): Promise<void> {
    while (this.#operations.size > 0) {
      await waitForSettledWithAbort(
        this.#operations.values(),
        signal,
        "File save drain aborted"
      );
    }
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
      const result = await this.#write(document, savedContents, epoch, panelId);
      if (typeof result === "string") {
        return result;
      }
      if (!this.#isCurrent(document.id, epoch)) {
        return "noop";
      }
      markDocumentWritten(document.id, savedContents, result);
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
        !document.durabilityUnknown &&
        !document.readOnly &&
        document.format !== null &&
        document.eol !== null &&
        document.eol !== "mixed" &&
        document.loadState === "loaded"
    );
  }

  async #write(
    document: DiskDocument,
    contents: string,
    epoch: number,
    panelId?: string
  ): Promise<
    | Extract<FileDocumentWriteResult, { kind: "written" }>
    | "cancelled"
    | "compare"
    | "noop"
  > {
    // External deletion clears revision; recreate with absent so Save skips
    // the false "changed on disk" dialog.
    let expected: FileDocumentExpectedState;
    if (document.deletedOnDisk || !document.revision) {
      expected = { kind: "absent" };
    } else {
      expected = { kind: "revision", revision: document.revision };
    }
    const initial = await this.#writeExpected(document, contents, expected);
    if (initial.kind === "written") {
      return initial;
    }
    if (initial.kind === "not-writable") {
      throw new Error(initial.message);
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
      const disk = await this.#context.files.readDocument({
        path: document.source.path,
        root: document.source.root,
      });
      if (!this.#isCurrent(document.id, epoch)) {
        return "noop";
      }
      if (disk.kind !== "text") {
        throw new Error(
          this.#t(
            "filePanel.conflict.compareUnavailable",
            "The changed file is not readable text."
          )
        );
      }
      setDocumentConflictContents(document.id, disk.contents);
      this.#onShowDiff(document.id, panelId);
      return "compare";
    }
    const inspection = await this.#context.files.inspectWriteTarget({
      path: document.source.path,
      root: document.source.root,
    });
    let overwriteExpected: FileDocumentExpectedState;
    if (inspection.kind === "absent") {
      overwriteExpected = { kind: "absent" };
    } else if (inspection.kind === "existing") {
      overwriteExpected = { kind: "revision", revision: inspection.revision };
    } else {
      throw new Error(
        inspection.kind === "not-writable"
          ? inspection.message
          : this.#t(
              "filePanel.errors.unsupportedOverwrite",
              "This file type cannot be overwritten safely."
            )
      );
    }
    const overwritten = await this.#writeExpected(
      document,
      contents,
      overwriteExpected
    );
    if (overwritten.kind === "written") {
      return overwritten;
    }
    if (overwritten.kind === "not-writable") {
      throw new Error(overwritten.message);
    }
    throw new Error(
      this.#t(
        "filePanel.conflict.changedAgain",
        "The file changed again before it could be overwritten."
      )
    );
  }

  #writeExpected(
    document: DiskDocument,
    contents: string,
    expected: FileDocumentExpectedState
  ): Promise<FileDocumentWriteResult> {
    if (!document.format) {
      throw new Error("Document format is unavailable");
    }
    if (!document.eol || document.eol === "mixed") {
      throw new Error("Document line ending is not writable");
    }
    const eol: FileWritableDocumentEol =
      document.eol === "none" ? "lf" : document.eol;
    return this.#context.files.writeDocument({
      contents,
      eol,
      expected,
      format: document.format,
      path: document.source.path,
      root: document.source.root,
    });
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
      intent: "default",
      size: "default",
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
