import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  fileEditorErrorMessage,
  isFileMissingError,
} from "./file-editor-errors.ts";
import { waitForSettledWithAbort } from "./files-async-drain.ts";
import {
  getDocument,
  markDocumentDeletedOnDisk,
  markDocumentDiskConflict,
  markDocumentError,
  markDocumentLoading,
  markDocumentReadResult,
} from "./files-document-store.ts";
import type { FilesDocument } from "./files-document-types.ts";

export class FileDocumentLoader {
  readonly #context: RendererPluginContext;
  readonly #documentEpochs = new Map<string, number>();
  readonly #operations = new Map<string, Promise<void>>();
  readonly #pendingReloads = new Set<string>();
  #disposed = false;

  constructor(context: RendererPluginContext) {
    this.#context = context;
  }

  start(documentId: string, reload: boolean): void {
    if (this.#disposed) {
      return;
    }
    const document = getDocument(documentId);
    if (document?.source.kind !== "disk") {
      return;
    }
    if (!reload && document.loadState !== "idle") {
      return;
    }
    if (this.#operations.has(document.id)) {
      if (reload) {
        this.#pendingReloads.add(document.id);
      }
      return;
    }
    if (!reload) {
      markDocumentLoading(document.id);
    }
    const epoch = this.#documentEpochs.get(document.id) ?? 0;
    const { path, root } = document.source;
    const operation = this.#read({
      documentId: document.id,
      epoch,
      path,
      reload,
      root,
    });
    this.#operations.set(document.id, operation);
    operation.finally(() => {
      if (this.#operations.get(document.id) === operation) {
        this.#operations.delete(document.id);
        if (this.#pendingReloads.delete(document.id)) {
          this.start(document.id, true);
        }
      }
    });
  }

  invalidate(documentId: string): void {
    this.#documentEpochs.set(
      documentId,
      (this.#documentEpochs.get(documentId) ?? 0) + 1
    );
    this.#operations.delete(documentId);
    this.#pendingReloads.delete(documentId);
  }

  dispose(): void {
    this.#disposed = true;
    this.#operations.clear();
    this.#pendingReloads.clear();
    this.#documentEpochs.clear();
  }

  async waitForIdle(signal: AbortSignal): Promise<void> {
    while (this.#operations.size > 0) {
      await waitForSettledWithAbort(
        this.#operations.values(),
        signal,
        "File load drain aborted"
      );
    }
  }

  async #read(input: {
    documentId: string;
    epoch: number;
    path: string;
    reload: boolean;
    root: string;
  }): Promise<void> {
    try {
      const result = await this.#context.files.readDocument({
        path: input.path,
        root: input.root,
      });
      const latest = getDocument(input.documentId);
      if (this.#disposed || !this.#isCurrent(latest, input)) {
        return;
      }
      if (input.reload && (latest.dirty || latest.durabilityUnknown)) {
        if (!("revision" in result && result.revision === latest.revision)) {
          markDocumentDiskConflict(latest.id);
        }
      } else {
        markDocumentReadResult(latest.id, result);
      }
    } catch (error) {
      const latest = getDocument(input.documentId);
      if (
        !this.#disposed &&
        latest &&
        (this.#documentEpochs.get(input.documentId) ?? 0) === input.epoch
      ) {
        if (isFileMissingError(error)) {
          markDocumentDeletedOnDisk(latest.id);
          return;
        }
        markDocumentError(
          latest.id,
          fileEditorErrorMessage(
            error,
            this.#t(
              "filePanel.errors.read.fallback",
              "Unable to read file contents."
            )
          )
        );
      }
    }
  }

  #isCurrent(
    document: FilesDocument | null,
    input: { documentId: string; epoch: number; path: string; root: string }
  ): document is FilesDocument {
    return Boolean(
      document?.source.kind === "disk" &&
        document.source.path === input.path &&
        document.source.root === input.root &&
        (this.#documentEpochs.get(input.documentId) ?? 0) === input.epoch
    );
  }

  #t(key: string, fallback: string): string {
    return this.#context.i18n.t(key, undefined, fallback);
  }
}
