import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { FileDocumentLifecycle } from "./file-document-lifecycle.ts";
import type { FileSaveFeedback } from "./file-save-feedback.ts";
import { reportFileSaveOutcome } from "./file-save-feedback.ts";
import type { FileSaveOutcome } from "./file-save-outcome.ts";

export class FileEditorSaveCommands {
  readonly #context: RendererPluginContext;
  readonly #documents: FileDocumentLifecycle;

  constructor(
    context: RendererPluginContext,
    documents: FileDocumentLifecycle
  ) {
    this.#context = context;
    this.#documents = documents;
  }

  async savePanel(
    panelId: string | null,
    feedback: FileSaveFeedback
  ): Promise<FileSaveOutcome> {
    const documentId = panelId
      ? this.#documents.getPanelDocumentId(panelId)
      : null;
    const outcome = await this.#documents.savePanel(panelId);
    await reportFileSaveOutcome(this.#context, documentId, outcome, feedback);
    return outcome;
  }

  async saveDocument(
    documentId: string,
    panelId: string | undefined,
    feedback: FileSaveFeedback
  ): Promise<FileSaveOutcome> {
    const outcome = await this.#documents.saveDocument(documentId, panelId);
    await reportFileSaveOutcome(this.#context, documentId, outcome, feedback);
    return outcome;
  }
}
