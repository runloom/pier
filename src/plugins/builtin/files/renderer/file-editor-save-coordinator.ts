import type { FileEditorSaveCommands } from "./file-editor-save-commands.ts";
import type { FileSaveFeedback } from "./file-save-feedback.ts";
import type {
  FileDocumentSettleResult,
  FileSaveOutcome,
} from "./file-save-outcome.ts";
import { getDocument } from "./files-document-store.ts";

export class FileEditorSaveCoordinator {
  readonly #confirmDurability: (
    documentId: string,
    feedback: FileSaveFeedback
  ) => Promise<boolean>;
  readonly #getPanelDocumentId: (panelId: string) => string | null;
  readonly #handlers = new Map<
    string,
    (feedback: FileSaveFeedback) => Promise<FileSaveOutcome>
  >();
  readonly #panelDocumentIds = new Map<string, string>();
  readonly #saveAsDocumentTails = new Map<string, Promise<void>>();
  readonly #saveAsOperations = new Map<string, Promise<FileSaveOutcome>>();
  readonly #saveCommands: FileEditorSaveCommands;
  readonly #settleOperations = new Map<
    string,
    Promise<FileDocumentSettleResult>
  >();

  constructor(input: {
    confirmDurability: (
      documentId: string,
      feedback: FileSaveFeedback
    ) => Promise<boolean>;
    getPanelDocumentId: (panelId: string) => string | null;
    saveCommands: FileEditorSaveCommands;
  }) {
    this.#confirmDurability = input.confirmDurability;
    this.#getPanelDocumentId = input.getPanelDocumentId;
    this.#saveCommands = input.saveCommands;
  }

  registerHandler(
    panelId: string,
    handler: (feedback: FileSaveFeedback) => Promise<FileSaveOutcome>
  ): () => void {
    this.#handlers.set(panelId, handler);
    return () => {
      if (this.#handlers.get(panelId) === handler) {
        this.#handlers.delete(panelId);
      }
    };
  }

  recordPanelDocument(panelId: string, documentId: string): void {
    this.#panelDocumentIds.set(panelId, documentId);
  }

  takePanelDocument(panelId: string): string | null {
    const documentId = this.#panelDocumentIds.get(panelId) ?? null;
    this.#panelDocumentIds.delete(panelId);
    return documentId;
  }

  async savePanel(
    panelId: string | null,
    feedback: FileSaveFeedback
  ): Promise<FileSaveOutcome> {
    const documentId = panelId ? this.#getPanelDocumentId(panelId) : null;
    const document = documentId ? getDocument(documentId) : null;
    return document?.needsSaveAs && panelId
      ? await this.saveAsPanel(panelId, feedback)
      : await this.#saveCommands.savePanel(panelId, feedback);
  }

  async saveDocument(
    documentId: string,
    panelId: string | undefined,
    feedback: FileSaveFeedback
  ): Promise<FileSaveOutcome> {
    const document = getDocument(documentId);
    return document?.needsSaveAs && panelId
      ? await this.saveAsPanel(panelId, feedback)
      : await this.#saveCommands.saveDocument(documentId, panelId, feedback);
  }

  async saveAsPanel(
    panelId: string | null,
    feedback: FileSaveFeedback
  ): Promise<FileSaveOutcome> {
    if (!panelId) {
      return "noop";
    }
    const existing = this.#saveAsOperations.get(panelId);
    if (existing) {
      return await existing;
    }
    this.#panelDocumentIds.delete(panelId);
    const handler = this.#handlers.get(panelId);
    const documentKey = this.#getPanelDocumentId(panelId) ?? `panel:${panelId}`;
    const previous =
      this.#saveAsDocumentTails.get(documentKey) ?? Promise.resolve();
    const operation: Promise<FileSaveOutcome> = previous
      .catch(() => undefined)
      .then(() => (handler ? handler(feedback) : ("noop" as const)))
      .finally(() => {
        if (this.#saveAsOperations.get(panelId) === operation) {
          this.#saveAsOperations.delete(panelId);
        }
      });
    const tail = operation.then(
      () => undefined,
      () => undefined
    );
    this.#saveAsOperations.set(panelId, operation);
    this.#saveAsDocumentTails.set(documentKey, tail);
    tail.finally(() => {
      if (this.#saveAsDocumentTails.get(documentKey) === tail) {
        this.#saveAsDocumentTails.delete(documentKey);
      }
    });
    return await operation;
  }

  async settleDocument(
    documentId: string,
    panelId: string | undefined,
    feedback: FileSaveFeedback
  ): Promise<FileDocumentSettleResult> {
    const existing = this.#settleOperations.get(documentId);
    if (existing) {
      return await existing;
    }
    const operation = this.#settle(documentId, panelId, feedback).finally(
      () => {
        if (this.#settleOperations.get(documentId) === operation) {
          this.#settleOperations.delete(documentId);
        }
      }
    );
    this.#settleOperations.set(documentId, operation);
    return await operation;
  }

  dispose(): void {
    this.#handlers.clear();
    this.#panelDocumentIds.clear();
    this.#saveAsDocumentTails.clear();
    this.#saveAsOperations.clear();
    this.#settleOperations.clear();
  }

  async #settle(
    initialDocumentId: string,
    panelId: string | undefined,
    feedback: FileSaveFeedback
  ): Promise<FileDocumentSettleResult> {
    let documentId = initialDocumentId;
    let performedSave = false;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const document = getDocument(documentId);
      if (!document) {
        return { documentId, outcome: "failed" };
      }
      if (document.durabilityUnknown) {
        if (!(await this.#confirmDurability(document.id, feedback))) {
          return { documentId, outcome: "failed" };
        }
        performedSave = true;
        continue;
      }
      if (document.needsSaveAs) {
        if (!panelId) {
          return { documentId, outcome: "failed" };
        }
        const outcome = await this.saveAsPanel(panelId, feedback);
        if (outcome !== "saved") {
          return { documentId, outcome };
        }
        const savedAsDocumentId = this.takePanelDocument(panelId);
        if (!savedAsDocumentId) {
          return { documentId, outcome: "failed" };
        }
        documentId = savedAsDocumentId;
        performedSave = true;
        continue;
      }
      if (document.dirty) {
        const outcome = await this.#saveCommands.saveDocument(
          document.id,
          panelId,
          feedback
        );
        if (outcome !== "saved") {
          return { documentId, outcome };
        }
        performedSave = true;
        continue;
      }
      return { documentId, outcome: performedSave ? "saved" : "noop" };
    }
    return { documentId, outcome: "failed" };
  }
}
