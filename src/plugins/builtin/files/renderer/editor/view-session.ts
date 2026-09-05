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
import { setFileChangePeek } from "../git-changes/source-widget.ts";
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
import type {
  EditorSearchOptions,
  EditorSearchState,
} from "./cm-search-state.ts";
import {
  clearGitGutterMarkers,
  type GitGutterNavigateHandler,
  gitGutterNavigateFacet,
  setGitGutterMarkers,
  setGitGutterModel,
} from "./git-gutter.ts";
import type { GitGutterLineMarker, GitGutterModel } from "./git-markers.ts";
import { FileEditorLanguageTools } from "./language-tools.ts";
import { createMinimapExtension } from "./minimap.ts";
import type { FilesEditorPrefs } from "./prefs.ts";
import {
  applyEditorSearchQuery,
  clearEditorSearch,
  editorStateCurrentLine,
  editorStateSelectionLines,
  executeEditorViewCommand,
  type FileEditorCommand,
  type FileEditorViewCommand,
  navigateEditorSearch,
  replaceEditorSearch,
  resetEditorSearch,
  runEditorViewCommand,
  selectAllEditorMatches,
} from "./view-operations.ts";
import {
  restoreFileEditorScroll,
  revealFileEditorOffset,
} from "./view-scroll.ts";
import {
  bindEditorScrollCapture,
  captureEditorScrollOffset,
} from "./view-scroll-capture.ts";
import {
  applyDefaultLanguagePreference,
  buildFileEditorSessionExtensions,
  resolveDocumentEditorChrome,
} from "./view-session-extensions.ts";
import { captureEditorViewportAnchor } from "./view-viewport-anchor.ts";

export type {
  FileEditorLspHoverResult,
  FileEditorViewPresentation,
} from "./adapter-types.ts";

export class FileEditorViewSession {
  readonly documentId: string;
  readonly editorSessionId: string;
  readonly #ariaCompartment = new Compartment();
  readonly #editableCompartment = new Compartment();
  readonly #gitGutterNavigateCompartment = new Compartment();
  readonly #languageCompartment = new Compartment();
  readonly #minimapCompartment = new Compartment();
  readonly #languageTools: FileEditorLanguageTools;
  #gitGutterNavigate: GitGutterNavigateHandler | null = null;
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
  #scrollListener: (() => void) | null = null;
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
    const restoreScroll = options?.restoreScroll !== false;
    if (this.#view) {
      this.#captureScrollFromView(this.#view);
      if (this.#view.dom.parentElement !== parent) {
        parent.appendChild(this.#view.dom);
      }
      this.syncDocument(document);
      if (restoreScroll) {
        restoreFileEditorScroll(this.#view, this.#scroll);
      }
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
    this.#bindScrollCapture(this.#view);
    this.syncDocument(document);
    if (restoreScroll) {
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
    if (this.#hostReadOnly === readOnly) return;
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
    const chrome = resolveDocumentEditorChrome({
      document,
      editorPrefs: this.#editorPrefs,
      hostReadOnly: this.#hostReadOnly,
    });
    this.#documentReadOnly = chrome.documentReadOnly;
    const effects: StateEffect<unknown>[] = [];
    if (this.#configuredReadOnly !== chrome.readOnly) {
      effects.push(
        this.#editableCompartment.reconfigure(
          EditorView.editable.of(!chrome.readOnly)
        )
      );
      this.#configuredReadOnly = chrome.readOnly;
    }
    if (
      this.#configuredLanguage !== chrome.language ||
      this.#configuredPath !== chrome.path
    ) {
      effects.push(
        this.#languageCompartment.reconfigure(chrome.languageExtension ?? [])
      );
      this.#configuredLanguage = chrome.language;
      this.#configuredPath = chrome.path;
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
  detach(parent?: HTMLElement): boolean {
    const view = this.#view;
    if (!view) {
      return false;
    }
    this.#captureScrollFromView(view);
    if (
      parent &&
      view.dom.parentElement !== parent &&
      view.dom.parentElement !== null
    ) {
      return false;
    }
    this.#unbindScrollCapture();
    clearFilesLspHover(view);
    resetEditorSearch(view);
    this.#savedState = view.state.update({
      effects: setFileChangePeek.of(null),
    }).state;
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
  #captureScrollFromView(view: EditorView): void {
    this.#scroll = captureEditorScrollOffset(view, this.#scroll);
  }
  #bindScrollCapture(view: EditorView): void {
    this.#unbindScrollCapture();
    this.#scrollListener = bindEditorScrollCapture(view, (offset) => {
      this.#scroll = offset;
    });
  }
  #unbindScrollCapture(): void {
    this.#scrollListener?.();
    this.#scrollListener = null;
  }
  captureSnapshot(): {
    selection?: { anchor: number; head: number };
    scroll: { left: number; top: number };
  } {
    const view = this.#view;
    if (view) {
      this.#captureScrollFromView(view);
      const main = view.state.selection.main;
      return {
        selection: { anchor: main.anchor, head: main.head },
        scroll: { ...this.#scroll },
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
  captureViewportAnchor(): MarkdownCrossModeAnchor | null {
    return this.#view ? captureEditorViewportAnchor(this.#view) : null;
  }
  hasView(): boolean {
    return this.#view !== null;
  }
  getEditorView = (): EditorView | null => this.#view;
  currentLine(): number | null {
    return editorStateCurrentLine(this.#view?.state ?? this.#savedState);
  }
  currentSelectionLines(): { endLine: number; startLine: number } | null {
    return editorStateSelectionLines(this.#view?.state ?? this.#savedState);
  }
  cancelQueuedLspHover(): void {
    if (this.#view) cancelQueuedFilesLspHover(this.#view);
  }
  showLspHover(): Promise<FileEditorLspHoverResult> {
    return this.#view
      ? showFilesLspHover(this.#view)
      : Promise.resolve("unavailable");
  }
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
  runViewCommand(command: FileEditorViewCommand): boolean {
    return runEditorViewCommand(this.#view, command);
  }
  setGitGutterMarkers(markers: ReadonlyMap<number, GitGutterLineMarker>): void {
    if (this.#view) setGitGutterMarkers(this.#view, markers);
  }
  setGitGutterModel(model: GitGutterModel): void {
    if (this.#view) setGitGutterModel(this.#view, model);
  }
  clearGitGutterMarkers(): void {
    if (this.#view) clearGitGutterMarkers(this.#view);
  }
  setGitGutterNavigate(handler: GitGutterNavigateHandler | null): void {
    this.#gitGutterNavigate = handler;
    this.#view?.dispatch({
      effects: this.#gitGutterNavigateCompartment.reconfigure(
        gitGutterNavigateFacet.of(handler)
      ),
    });
  }
  getPanelContext(): PanelContext | undefined {
    return this.#languageTools.getPanelContext();
  }
  setMinimapEnabled(enabled: boolean): void {
    if (this.#minimapEnabled === enabled) return;
    this.#minimapEnabled = enabled;
    this.#view?.dispatch({
      effects: this.#minimapCompartment.reconfigure(
        enabled ? createMinimapExtension() : []
      ),
    });
  }
  setPanelContext(panelContext: PanelContext | undefined): void {
    const effect = this.#languageTools.setPanelContext(panelContext);
    if (!effect) return;
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
    if (defaultLanguageChanged && view && document) {
      const next = applyDefaultLanguagePreference({
        document,
        languageCompartment: this.#languageCompartment,
        prefs,
        view,
      });
      if (next) {
        this.#configuredLanguage = next.language;
        this.#configuredPath = next.path;
      }
    }
    this.#languageTools.setPrefs(view, prefs);
  }
  #extensions(document: FilesDocument) {
    this.#document = document;
    const built = buildFileEditorSessionExtensions({
      ariaCompartment: this.#ariaCompartment,
      document,
      documentId: this.documentId,
      editableCompartment: this.#editableCompartment,
      editorPrefs: this.#editorPrefs,
      gitGutterNavigate: this.#gitGutterNavigate,
      gitGutterNavigateCompartment: this.#gitGutterNavigateCompartment,
      hostReadOnly: this.#hostReadOnly,
      isDocumentSyncing: () => this.#syncingDocument,
      languageCompartment: this.#languageCompartment,
      languageTools: this.#languageTools,
      minimapCompartment: this.#minimapCompartment,
      minimapEnabled: this.#minimapEnabled,
      onChange: this.#onChange,
      presentation: this.#presentation,
    });
    this.#configuredLanguage = built.configuredLanguage;
    this.#configuredPath = built.configuredPath;
    this.#configuredReadOnly = built.configuredReadOnly;
    this.#documentReadOnly = built.documentReadOnly;
    return built.extensions;
  }
}
