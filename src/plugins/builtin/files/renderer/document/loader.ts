import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  fileEditorErrorMessage,
  isFileMissingError,
} from "../editor/errors.ts";
import { waitForSettledWithAbort } from "./async-drain.ts";
import {
  consumeDiskReplaceAuthorization,
  protectsLocalBufferFromDisk,
} from "./disk-protection.ts";
import {
  getDocument,
  markDocumentDeletedOnDisk,
  markDocumentDiskConflict,
  markDocumentError,
  markDocumentLoading,
  markDocumentReadResult,
  setDocumentConflictContents,
} from "./store.ts";
import type { FilesDocument } from "./types.ts";

export class FileDocumentLoader {
  readonly #context: RendererPluginContext;
  readonly #documentEpochs = new Map<string, number>();
  readonly #operations = new Map<string, Promise<void>>();
  /** Presence means "run another reload after the current op settles". */
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
      if (this.#operations.get(document.id) !== operation) {
        return;
      }
      this.#operations.delete(document.id);
      if (this.#pendingReloads.delete(document.id)) {
        // Keep force-adopt authorization for the chained reload (banner while
        // a watch reload was already in flight).
        this.start(document.id, true);
        return;
      }
      // Chain finished: drop one-shot force-adopt authorization if unused or used.
      consumeDiskReplaceAuthorization(document.id);
    });
  }

  /**
   * Await the current load/reload and any chained pending reloads kicked from
   * its finally handler (required for force-adopt while a watch reload runs).
   */
  async waitFor(documentId: string): Promise<void> {
    for (;;) {
      const operation = this.#operations.get(documentId);
      if (!operation) {
        return;
      }
      await operation;
    }
  }

  invalidate(documentId: string): void {
    this.#documentEpochs.set(
      documentId,
      (this.#documentEpochs.get(documentId) ?? 0) + 1
    );
    this.#operations.delete(documentId);
    this.#pendingReloads.delete(documentId);
    consumeDiskReplaceAuthorization(documentId);
  }

  dispose(): void {
    this.#disposed = true;
    for (const documentId of this.#operations.keys()) {
      consumeDiskReplaceAuthorization(documentId);
    }
    for (const documentId of this.#pendingReloads) {
      consumeDiskReplaceAuthorization(documentId);
    }
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
      // Atomic rewrite: delete then create must not block adopt of restored
      // disk text. Force-adopt is a one-shot id authorization (banner); protect
      // peeks it, and start()'s finally consumes when the chain ends.
      if (input.reload && protectsLocalBufferFromDisk(latest)) {
        if (!("revision" in result && result.revision === latest.revision)) {
          markDocumentDiskConflict(latest.id);
          if (result.kind === "text") {
            setDocumentConflictContents(latest.id, result.contents);
          }
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
