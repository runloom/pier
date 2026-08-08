import type { Extension } from "@codemirror/state";
import { Compartment, EditorState, type StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { FilesDocument } from "../document/types.ts";
import {
  absoluteDiskPathForDocument,
  filesLspEditorExtensions,
} from "../lsp/client.ts";
import type { FilesLspHoverInput } from "../lsp/hover.ts";
import {
  clearFilesLanguageServiceStatusOwner,
  type FilesLanguageServiceStatus,
  publishFilesLanguageServiceStatus,
} from "../panel/language-service-status.ts";
import type { FilesEditorPrefs } from "./prefs.ts";

function diskKey(document: FilesDocument): string | null {
  if (document.source.kind !== "disk") {
    return null;
  }
  const disk = absoluteDiskPathForDocument(document.source);
  return disk ? `${disk.rootPath}\0${disk.absolutePath}` : null;
}

/** Owns the live word-wrap, tab-size, and LSP compartments for one editor. */
export class FileEditorLanguageTools {
  readonly #lspCompartment = new Compartment();
  readonly #tabSizeCompartment = new Compartment();
  readonly #wordWrapCompartment = new Compartment();
  readonly #getOpenExternal: () => (url: string) => void;
  readonly #getLabels: FilesLspHoverInput["getLabels"] | undefined;
  readonly #notifyError: FilesLspHoverInput["notifyError"] | undefined;
  #appliedPrefs: FilesEditorPrefs | null = null;
  #document: FilesDocument | null = null;
  #documentKey: string | null = null;
  readonly #ownerId: string;
  readonly #readDocument: FilesLspHoverInput["readDocument"] | undefined;
  #panelContext: PanelContext | undefined;
  #pendingStatus: {
    documentId: string;
    status: FilesLanguageServiceStatus;
  } | null = null;
  #prefs: FilesEditorPrefs;

  constructor(input: {
    getOpenExternal: () => (url: string) => void;
    getLabels?: FilesLspHoverInput["getLabels"];
    notifyError?: FilesLspHoverInput["notifyError"];
    ownerId: string;
    prefs: FilesEditorPrefs;
    readDocument?: FilesLspHoverInput["readDocument"];
  }) {
    this.#getOpenExternal = input.getOpenExternal;
    this.#getLabels = input.getLabels;
    this.#notifyError = input.notifyError;
    this.#ownerId = input.ownerId;
    this.#prefs = input.prefs;
    this.#readDocument = input.readDocument;
  }

  extensions(document: FilesDocument): Extension[] {
    if (this.#document && this.#document.id !== document.id) {
      clearFilesLanguageServiceStatusOwner(this.#ownerId);
    }
    this.#document = document;
    this.#documentKey = diskKey(document);
    this.#appliedPrefs = this.#prefs;
    const extensions = [
      this.#wordWrapCompartment.of(
        this.#prefs.wordWrap ? EditorView.lineWrapping : []
      ),
      this.#tabSizeCompartment.of(EditorState.tabSize.of(this.#prefs.tabSize)),
      this.#lspCompartment.of(this.#lspExtension()),
    ];
    this.commitPendingStatus();
    return extensions;
  }

  syncDocument(document: FilesDocument): StateEffect<unknown>[] {
    const previousDocumentId = this.#document?.id;
    const nextKey = diskKey(document);
    if (previousDocumentId && previousDocumentId !== document.id) {
      clearFilesLanguageServiceStatusOwner(this.#ownerId);
    }
    this.#document = document;
    if (nextKey === this.#documentKey && previousDocumentId === document.id) {
      return [];
    }
    this.#documentKey = nextKey;
    return [this.#lspCompartment.reconfigure(this.#lspExtension())];
  }

  syncPrefs(): StateEffect<unknown>[] {
    const applied = this.#appliedPrefs;
    const effects: StateEffect<unknown>[] = [];
    if (!applied || applied.wordWrap !== this.#prefs.wordWrap) {
      effects.push(
        this.#wordWrapCompartment.reconfigure(
          this.#prefs.wordWrap ? EditorView.lineWrapping : []
        )
      );
    }
    if (!applied || applied.tabSize !== this.#prefs.tabSize) {
      effects.push(
        this.#tabSizeCompartment.reconfigure(
          EditorState.tabSize.of(this.#prefs.tabSize)
        )
      );
    }
    if (!applied || applied.lspEnabled !== this.#prefs.lspEnabled) {
      effects.push(this.#lspCompartment.reconfigure(this.#lspExtension()));
    }
    this.#appliedPrefs = this.#prefs;
    return effects;
  }

  setPanelContext(panelContext?: PanelContext): StateEffect<unknown> | null {
    if (this.#panelContext === panelContext) {
      return null;
    }
    this.#panelContext = panelContext;
    return this.#lspCompartment.reconfigure(this.#lspExtension());
  }

  getPanelContext(): PanelContext | undefined {
    return this.#panelContext;
  }

  setPrefs(view: EditorView | null, prefs: FilesEditorPrefs): void {
    this.#prefs = prefs;
    if (!view) {
      return;
    }
    const effects = this.syncPrefs();
    if (effects.length > 0) {
      view.dispatch({ effects });
      this.commitPendingStatus();
    }
  }

  commitPendingStatus(): void {
    const pending = this.#pendingStatus;
    this.#pendingStatus = null;
    if (pending) {
      publishFilesLanguageServiceStatus(
        this.#ownerId,
        pending.documentId,
        pending.status
      );
    }
  }

  dispose(): void {
    clearFilesLanguageServiceStatusOwner(this.#ownerId);
  }

  #lspExtension(): Extension {
    const document = this.#document;
    if (!document) {
      return [];
    }
    this.#pendingStatus = null;
    if (!this.#prefs.lspEnabled) {
      this.#pendingStatus = {
        documentId: document.id,
        status: { state: "disabled", reason: "editor-disabled" },
      };
      return [];
    }
    if (document.source.kind !== "disk") {
      this.#pendingStatus = {
        documentId: document.id,
        status: { state: "unsupported", reason: "non-disk" },
      };
      return [];
    }
    const disk = absoluteDiskPathForDocument(document.source);
    if (!disk) {
      this.#pendingStatus = {
        documentId: document.id,
        status: { state: "unsupported", reason: "non-disk" },
      };
      return [];
    }
    return filesLspEditorExtensions({
      absolutePath: disk.absolutePath,
      documentId: document.id,
      getOpenExternal: this.#getOpenExternal,
      ...(this.#getLabels ? { getLabels: this.#getLabels } : {}),
      ...(this.#notifyError ? { notifyError: this.#notifyError } : {}),
      ownerId: this.#ownerId,
      ...(this.#readDocument ? { readDocument: this.#readDocument } : {}),
      ...(this.#panelContext ? { panelContext: this.#panelContext } : {}),
      rootPath: disk.rootPath,
    });
  }
}
