import {
  Compartment,
  EditorState,
  type StateEffect,
  Transaction,
} from "@codemirror/state";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { EditorView } from "codemirror";
import type {
  FilesDocument,
  FilesDocumentLanguage,
} from "../document/types.ts";
import {
  cancelQueuedFilesLspHover,
  clearFilesLspHover,
  showFilesLspHover,
} from "../lsp/hover.ts";
import type { MarkdownCrossModeAnchor } from "../markdown/cross-mode-anchor.ts";
import type {
  FileEditorLspHoverResult,
  FileEditorViewPresentation,
} from "./adapter-types.ts";
import { cmLanguageExtension } from "./cm-language.ts";
import type {
  EditorSearchOptions,
  EditorSearchState,
} from "./cm-search-state.ts";
import { clearGitGutterMarkers, setGitGutterMarkers } from "./git-gutter.ts";
import type { GitGutterLineMarker } from "./git-markers.ts";
import { FileEditorLanguageTools } from "./language-tools.ts";
import { createMinimapExtension } from "./minimap.ts";
import { type FilesEditorPrefs, resolveFilesEditorLanguage } from "./prefs.ts";
import { createFileEditorViewExtensions } from "./view-extensions.ts";
import {
  applyEditorSearchQuery,
  clearEditorSearch,
  executeEditorViewCommand,
  type FileEditorCommand,
  navigateEditorSearch,
  replaceEditorSearch,
  resetEditorSearch,
  selectAllEditorMatches,
} from "./view-operations.ts";
import {
  restoreFileEditorScroll,
  revealFileEditorOffset,
} from "./view-scroll.ts";
import { captureEditorViewportAnchor } from "./view-viewport-anchor.ts";

export type {
  FileEditorLspHoverResult,
  FileEditorViewPresentation,
} from "./adapter-types.ts";
export type { FileEditorCommand } from "./view-operations.ts";
export class FileEditorViewSession {
  readonly documentId: string;
  readonly editorSessionId: string;
  readonly #ariaCompartment = new Compartment();
  readonly #editableCompartment = new Compartment();
  readonly #languageCompartment = new Compartment();
  readonly #minimapCompartment = new Compartment();
  readonly #languageTools: FileEditorLanguageTools;
  #minimapEnabled: boolean;
  readonly #onChange: (documentId: string, contents: string) => void;
  #presentation: FileEditorViewPresentation;
  #configuredReadOnly: boolean | null = null;
  #documentReadOnly = false;
  #document: FilesDocument | null = null;
  #editorPrefs: FilesEditorPrefs;
  #hostReadOnly = false;
  #configuredLanguage: FilesDocumentLanguage | null = null;
  #configuredPath: string | undefined;
  #savedState: EditorState | null = null;
  #scroll = { left: 0, top: 0 };
  #syncingDocument = false;
  #view: EditorView | null = null;
  constructor(input: {
    documentId: string;
    editorPrefs: FilesEditorPrefs;
    editorSessionId: string;
    minimapEnabled: boolean;
    onChange: (documentId: string, contents: string) => void;
    panelContext?: PanelContext;
    presentation: FileEditorViewPresentation;
  }) {
    this.documentId = input.documentId;
    this.editorSessionId = input.editorSessionId;
    this.#editorPrefs = input.editorPrefs;
    this.#presentation = input.presentation;
    this.#languageTools = new FileEditorLanguageTools({
      getOpenExternal: () => this.#presentation.openExternal,
      ...(input.presentation.getLspHoverLabels
        ? { getLabels: input.presentation.getLspHoverLabels }
        : {}),
      ...(input.presentation.notifyLspError
        ? {
            notifyError: (message: string) =>
              this.#presentation.notifyLspError?.(message),
          }
        : {}),
      ownerId: input.editorSessionId,
      prefs: input.editorPrefs,
      ...(input.presentation.readDocument
        ? { readDocument: input.presentation.readDocument }
        : {}),
    });
    this.#languageTools.setPanelContext(input.panelContext);
    this.#minimapEnabled = input.minimapEnabled;
    this.#onChange = input.onChange;
  }
  mount(
    parent: HTMLElement,
    document: FilesDocument,
    options?: { restoreScroll?: boolean }
  ): void {
    if (this.#view) {
      if (this.#view.dom.parentElement !== parent) {
        parent.appendChild(this.#view.dom);
      }
      this.syncDocument(document);
      return;
    }
    let state = this.#savedState;
    if (state) {
      const pendingEffects = [
        ...this.#languageTools.syncPrefs(),
        ...this.#languageTools.syncDocument(document),
      ];
      if (pendingEffects.length > 0) {
        state = state.update({ effects: pendingEffects }).state;
      }
      this.#languageTools.commitPendingStatus();
    } else {
      state = EditorState.create({
        doc: document.currentContents,
        extensions: this.#extensions(document),
      });
    }
    this.#view = new EditorView({ parent, state });
    this.#view.scrollDOM.dataset.scrollbar = "stable";
    this.syncDocument(document);
    // Skip pixel restore when a content reveal is pending (mode switch / go-to).
    if (options?.restoreScroll !== false) {
      restoreFileEditorScroll(this.#view, this.#scroll);
    }
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
    this.#document = document;
    const languageToolEffects = this.#languageTools.syncDocument(document);
    const view = this.#view;
    if (!view) {
      if (this.#savedState && languageToolEffects.length > 0) {
        this.#savedState = this.#savedState.update({
          effects: languageToolEffects,
        }).state;
      }
      this.#languageTools.commitPendingStatus();
      return;
    }

    const language = resolveFilesEditorLanguage(
      document.language,
      this.#editorPrefs.defaultLanguage
    );
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
    effects.push(...languageToolEffects);
    if (effects.length > 0) {
      view.dispatch({ effects });
      this.#languageTools.commitPendingStatus();
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
  /** Detaches only while the view still belongs to the optional parent. */
  detach(parent?: HTMLElement): boolean {
    const view = this.#view;
    if (!view) {
      return false;
    }
    if (parent && view.dom.parentElement !== parent) {
      return false;
    }
    clearFilesLspHover(view);
    resetEditorSearch(view);
    this.#savedState = view.state;
    this.#scroll = {
      left: view.scrollDOM.scrollLeft,
      top: view.scrollDOM.scrollTop,
    };
    view.destroy();
    this.#view = null;
    return true;
  }

  dispose(): void {
    this.detach();
    this.#languageTools.dispose();
    this.#savedState = null;
    this.#scroll = { left: 0, top: 0 };
  }

  captureSnapshot(): {
    selection?: { anchor: number; head: number };
    scroll: { left: number; top: number };
  } {
    const view = this.#view;
    if (view) {
      const main = view.state.selection.main;
      return {
        selection: { anchor: main.anchor, head: main.head },
        scroll: {
          left: view.scrollDOM.scrollLeft,
          top: view.scrollDOM.scrollTop,
        },
      };
    }
    const saved = this.#savedState;
    if (saved) {
      const main = saved.selection.main;
      return {
        selection: { anchor: main.anchor, head: main.head },
        scroll: { ...this.#scroll },
      };
    }
    return { scroll: { ...this.#scroll } };
  }

  applySnapshot(snapshot: {
    selection?: { anchor: number; head: number };
    scroll?: { left: number; top: number };
  }): void {
    if (snapshot.scroll) {
      this.#scroll = { left: snapshot.scroll.left, top: snapshot.scroll.top };
    }
    const view = this.#view;
    if (!view) return;
    // Selection owns vertical scroll; cross-mode content reveal resets X.
    // Pixel restore (left+top) only for transfer / same-mode remount seed.
    if (snapshot.selection) {
      revealFileEditorOffset(view, snapshot.selection.anchor, {
        head: snapshot.selection.head,
        resetHorizontal: true,
        y: "start",
      });
      this.#scroll = {
        left: view.scrollDOM.scrollLeft,
        top: view.scrollDOM.scrollTop,
      };
      return;
    }
    if (snapshot.scroll) restoreFileEditorScroll(view, this.#scroll);
  }

  revealOffset(offset: number): void {
    this.applySnapshot({ selection: { anchor: offset, head: offset } });
  }

  revealRange(from: number, to: number): void {
    this.applySnapshot({
      selection: { anchor: Math.min(from, to), head: Math.max(from, to) },
    });
  }

  /** Content anchor for exclusive source → preview (caret or focus band). */
  captureViewportAnchor(): MarkdownCrossModeAnchor | null {
    return this.#view ? captureEditorViewportAnchor(this.#view) : null;
  }

  currentLine(): number | null {
    const view = this.#view;
    if (!view) {
      return null;
    }
    const head = view.state.selection.main.head;
    return view.state.doc.lineAt(head).number;
  }

  cancelQueuedLspHover(): void {
    if (this.#view) cancelQueuedFilesLspHover(this.#view);
  }
  showLspHover(): Promise<FileEditorLspHoverResult> {
    return this.#view
      ? showFilesLspHover(this.#view)
      : Promise.resolve("unavailable");
  }

  /** Recompute line geometry after external CSS font-size / family changes. */
  requestMeasure(): void {
    this.#view?.requestMeasure();
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

  setMinimapEnabled(enabled: boolean): void {
    if (this.#minimapEnabled === enabled) {
      return;
    }
    this.#minimapEnabled = enabled;
    const view = this.#view;
    if (!view) {
      return;
    }
    view.dispatch({
      effects: this.#minimapCompartment.reconfigure(
        enabled ? createMinimapExtension() : []
      ),
    });
  }

  setPanelContext(panelContext: PanelContext | undefined): void {
    const effect = this.#languageTools.setPanelContext(panelContext);
    if (!effect) {
      return;
    }
    if (this.#view) {
      this.#view.dispatch({ effects: effect });
      this.#languageTools.commitPendingStatus();
    } else if (this.#savedState) {
      this.#savedState = this.#savedState.update({ effects: effect }).state;
      this.#languageTools.commitPendingStatus();
    }
  }

  setEditorPrefs(prefs: FilesEditorPrefs): void {
    const defaultLanguageChanged =
      this.#editorPrefs.defaultLanguage !== prefs.defaultLanguage;
    this.#editorPrefs = prefs;
    const view = this.#view;
    const document = this.#document;
    if (defaultLanguageChanged && view && document?.language === "text") {
      const language = prefs.defaultLanguage ?? "text";
      const path =
        document.source.kind === "disk" ? document.source.path : undefined;
      view.dispatch({
        effects: this.#languageCompartment.reconfigure(
          cmLanguageExtension(language, path) ?? []
        ),
      });
      this.#configuredLanguage = language;
      this.#configuredPath = path;
    }
    this.#languageTools.setPrefs(view, prefs);
  }

  #extensions(document: FilesDocument) {
    this.#document = document;
    const language = resolveFilesEditorLanguage(
      document.language,
      this.#editorPrefs.defaultLanguage
    );
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
    return createFileEditorViewExtensions({
      ariaCompartment: this.#ariaCompartment,
      ariaLabel: this.#presentation.ariaLabel,
      editableCompartment: this.#editableCompartment,
      languageCompartment: this.#languageCompartment,
      languageExtension,
      languageToolExtensions: this.#languageTools.extensions(document),
      minimapCompartment: this.#minimapCompartment,
      minimapEnabled: this.#minimapEnabled,
      getContextMenuHandler: () => this.#presentation.onContextMenu,
      isDocumentSyncing: () => this.#syncingDocument,
      onContentsChange: (contents) => this.#onChange(this.documentId, contents),
      onOpenSearch: () => this.#presentation.onOpenSearch(),
      onSearchStateChange: (state) =>
        this.#presentation.onSearchStateChange(state),
      readOnly,
    });
  }
}
