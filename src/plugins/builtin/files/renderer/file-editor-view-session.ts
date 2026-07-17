import { syntaxHighlighting } from "@codemirror/language";
import { search as codeMirrorSearch } from "@codemirror/search";
import {
  Compartment,
  EditorState,
  Prec,
  type StateEffect,
  Transaction,
} from "@codemirror/state";
import { basicSetup, EditorView } from "codemirror";
import { filesSyntaxHighlightStyle } from "./cm-highlight-style.ts";
import { cmLanguageExtension } from "./cm-language.ts";
import { EDITOR_THEME } from "./code-mirror-editor-theme.ts";
import type {
  EditorSearchOptions,
  EditorSearchState,
} from "./code-mirror-search-state.ts";
import {
  applyEditorSearchQuery,
  clearEditorSearch,
  currentEditorSearchState,
  editorViewRanges,
  executeEditorViewCommand,
  type FileEditorCommand,
  navigateEditorSearch,
  replaceEditorSearch,
  resetEditorSearch,
  selectAllEditorMatches,
} from "./file-editor-view-operations.ts";
import type {
  EditorRange,
  FilesDocument,
  FilesDocumentLanguage,
} from "./files-document-types.ts";
import {
  clearGitGutterMarkers,
  createGitGutterExtension,
  setGitGutterMarkers,
} from "./files-editor-git-gutter.ts";
import type { GitGutterLineMarker } from "./files-editor-git-markers.ts";

export type { FileEditorCommand } from "./file-editor-view-operations.ts";

export interface FileEditorViewPresentation {
  ariaLabel: string;
  onContextMenu?: (event: MouseEvent, ranges: readonly EditorRange[]) => void;
  onOpenSearch: () => void;
  onSearchStateChange: (state: EditorSearchState) => void;
}

interface ScrollSnapshot {
  left: number;
  top: number;
}

export class FileEditorViewSession {
  readonly documentId: string;
  readonly editorSessionId: string;
  readonly #ariaCompartment = new Compartment();
  readonly #editableCompartment = new Compartment();
  readonly #languageCompartment = new Compartment();
  readonly #onChange: (documentId: string, contents: string) => void;
  #presentation: FileEditorViewPresentation;
  #configuredLanguage: FilesDocumentLanguage | null = null;
  #configuredPath: string | undefined;
  #configuredReadOnly: boolean | null = null;
  #documentReadOnly = false;
  #hostReadOnly = false;
  #savedState: EditorState | null = null;
  #scroll: ScrollSnapshot = { left: 0, top: 0 };
  #syncingDocument = false;
  #view: EditorView | null = null;

  constructor(input: {
    documentId: string;
    editorSessionId: string;
    onChange: (documentId: string, contents: string) => void;
    presentation: FileEditorViewPresentation;
  }) {
    this.documentId = input.documentId;
    this.editorSessionId = input.editorSessionId;
    this.#onChange = input.onChange;
    this.#presentation = input.presentation;
  }

  mount(parent: HTMLElement, document: FilesDocument): void {
    if (this.#view) {
      this.syncDocument(document);
      return;
    }

    const state =
      this.#savedState ??
      EditorState.create({
        doc: document.currentContents,
        extensions: this.#extensions(document),
      });
    this.#view = new EditorView({ parent, state });
    this.#view.scrollDOM.dataset.scrollbar = "stable";
    this.syncDocument(document);
    this.#restoreScroll();
  }

  updatePresentation(presentation: FileEditorViewPresentation): void {
    this.#presentation = presentation;
    const view = this.#view;
    if (view) {
      view.dispatch({
        effects: this.#ariaCompartment.reconfigure(
          EditorView.contentAttributes.of({
            "aria-label": presentation.ariaLabel,
          })
        ),
      });
    }
  }

  setHostReadOnly(readOnly: boolean): void {
    if (this.#hostReadOnly === readOnly) {
      return;
    }
    this.#hostReadOnly = readOnly;
    const view = this.#view;
    if (view) {
      view.dispatch({
        effects: this.#editableCompartment.reconfigure(
          EditorView.editable.of(!(readOnly || this.#documentReadOnly))
        ),
      });
    }
  }

  syncDocument(document: FilesDocument): void {
    const view = this.#view;
    if (!view) {
      return;
    }

    const language = document.language;
    const path =
      document.source.kind === "disk" ? document.source.path : undefined;
    const documentReadOnly =
      document.readOnly || document.loadState === "loading";
    this.#documentReadOnly = documentReadOnly;
    const readOnly = this.#hostReadOnly || documentReadOnly;
    const languageExtension = cmLanguageExtension(language, path);
    const effects: StateEffect<unknown>[] = [];
    if (this.#configuredReadOnly !== readOnly) {
      effects.push(
        this.#editableCompartment.reconfigure(EditorView.editable.of(!readOnly))
      );
      this.#configuredReadOnly = readOnly;
    }
    if (
      this.#configuredLanguage !== language ||
      this.#configuredPath !== path
    ) {
      effects.push(
        this.#languageCompartment.reconfigure(languageExtension ?? [])
      );
      this.#configuredLanguage = language;
      this.#configuredPath = path;
    }
    if (effects.length > 0) {
      view.dispatch({ effects });
    }

    const currentValue = view.state.doc.toString();
    if (currentValue === document.currentContents) {
      return;
    }
    this.#syncingDocument = true;
    try {
      view.dispatch({
        annotations: Transaction.addToHistory.of(false),
        changes: {
          from: 0,
          insert: document.currentContents,
          to: currentValue.length,
        },
      });
    } finally {
      this.#syncingDocument = false;
    }
  }

  detach(): void {
    const view = this.#view;
    if (!view) {
      return;
    }
    resetEditorSearch(view);
    this.#savedState = view.state;
    this.#scroll = {
      left: view.scrollDOM.scrollLeft,
      top: view.scrollDOM.scrollTop,
    };
    view.destroy();
    this.#view = null;
  }

  dispose(): void {
    this.detach();
    this.#savedState = null;
    this.#scroll = { left: 0, top: 0 };
  }

  applySearchQuery(
    search: string,
    replace: string,
    options: EditorSearchOptions,
    navigate = false
  ): EditorSearchState {
    return applyEditorSearchQuery(
      this.#view,
      search,
      replace,
      options,
      navigate
    );
  }

  clearSearch(
    replace: string,
    options: EditorSearchOptions
  ): EditorSearchState {
    return clearEditorSearch(this.#view, replace, options);
  }

  navigateSearch(direction: "next" | "previous"): EditorSearchState {
    return navigateEditorSearch(this.#view, direction);
  }

  replaceSearch(all: boolean): EditorSearchState {
    return replaceEditorSearch(this.#view, all);
  }

  selectAllMatches(): EditorSearchState {
    return selectAllEditorMatches(this.#view);
  }

  async execute(command: FileEditorCommand): Promise<void> {
    await executeEditorViewCommand(this.#view, command);
  }

  setGitGutterMarkers(markers: ReadonlyMap<number, GitGutterLineMarker>): void {
    const view = this.#view;
    if (view) {
      setGitGutterMarkers(view, markers);
    }
  }

  clearGitGutterMarkers(): void {
    const view = this.#view;
    if (view) {
      clearGitGutterMarkers(view);
    }
  }

  #extensions(document: FilesDocument) {
    const language = document.language;
    const path =
      document.source.kind === "disk" ? document.source.path : undefined;
    const documentReadOnly =
      document.readOnly || document.loadState === "loading";
    this.#documentReadOnly = documentReadOnly;
    const readOnly = this.#hostReadOnly || documentReadOnly;
    const languageExtension = cmLanguageExtension(language, path);
    this.#configuredLanguage = language;
    this.#configuredPath = path;
    this.#configuredReadOnly = readOnly;
    return [
      createGitGutterExtension(),
      Prec.highest(
        EditorView.domEventHandlers({
          keydown: (event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              !event.altKey &&
              !event.shiftKey &&
              event.key.toLowerCase() === "f"
            ) {
              event.preventDefault();
              this.#presentation.onOpenSearch();
              return true;
            }
            return false;
          },
        })
      ),
      codeMirrorSearch(),
      basicSetup,
      this.#ariaCompartment.of(
        EditorView.contentAttributes.of({
          "aria-label": this.#presentation.ariaLabel,
        })
      ),
      EditorView.editorAttributes.of({ class: "h-full" }),
      EDITOR_THEME,
      syntaxHighlighting(filesSyntaxHighlightStyle),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) {
          return;
        }
        this.#presentation.onSearchStateChange(
          currentEditorSearchState(update.view)
        );
        if (!this.#syncingDocument) {
          this.#onChange(this.documentId, update.state.doc.toString());
        }
      }),
      EditorView.domEventHandlers({
        contextmenu: (event, view) => {
          const handler = this.#presentation.onContextMenu;
          if (!handler) {
            return false;
          }
          handler(event, editorViewRanges(view));
          return true;
        },
      }),
      this.#editableCompartment.of(EditorView.editable.of(!readOnly)),
      this.#languageCompartment.of(languageExtension ?? []),
    ];
  }

  #restoreScroll(): void {
    const view = this.#view;
    if (!view) {
      return;
    }
    const apply = () => {
      view.scrollDOM.scrollLeft = this.#scroll.left;
      view.scrollDOM.scrollTop = this.#scroll.top;
    };
    apply();
    view.requestMeasure({ read: () => undefined, write: apply });
  }
}
