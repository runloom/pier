import { syntaxHighlighting } from "@codemirror/language";
import { search as codeMirrorSearch } from "@codemirror/search";
import { type Compartment, type Extension, Prec } from "@codemirror/state";
import { basicSetup, EditorView } from "codemirror";
import { filesSyntaxHighlightStyle } from "./cm-highlight-style.ts";
import { EDITOR_THEME } from "./code-mirror-editor-theme.ts";
import type { EditorSearchState } from "./code-mirror-search-state.ts";
import {
  currentEditorSearchState,
  editorViewRanges,
} from "./file-editor-view-operations.ts";
import type { EditorRange } from "./files-document-types.ts";
import { createGitGutterExtension } from "./files-editor-git-gutter.ts";
import { createMinimapExtension } from "./files-editor-minimap.ts";
import { isFilesLspMultiCursorModifier } from "./files-lsp-pointer-modifiers.ts";

interface FileEditorViewExtensionInput {
  ariaCompartment: Compartment;
  ariaLabel: string;
  editableCompartment: Compartment;
  getContextMenuHandler: () =>
    | ((event: MouseEvent, ranges: readonly EditorRange[]) => void)
    | undefined;
  isDocumentSyncing: () => boolean;
  languageCompartment: Compartment;
  languageExtension: Extension | null;
  languageToolExtensions: readonly Extension[];
  minimapCompartment: Compartment;
  minimapEnabled: boolean;
  onContentsChange: (contents: string) => void;
  onOpenSearch: () => void;
  onSearchStateChange: (state: EditorSearchState) => void;
  readOnly: boolean;
}

export function createFileEditorViewExtensions(
  input: FileEditorViewExtensionInput
): Extension[] {
  return [
    createGitGutterExtension(),
    // VS Code-aligned: only Alt+Click adds multi-cursor (not Cmd/Ctrl).
    // Cmd/Ctrl+Click is reserved for Go to Definition (LSP hover controller).
    EditorView.clickAddsSelectionRange.of((event) =>
      isFilesLspMultiCursorModifier(event)
    ),
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
            input.onOpenSearch();
            return true;
          }
          return false;
        },
      })
    ),
    codeMirrorSearch(),
    basicSetup,
    input.ariaCompartment.of(
      EditorView.contentAttributes.of({ "aria-label": input.ariaLabel })
    ),
    EditorView.editorAttributes.of({ class: "h-full" }),
    EDITOR_THEME,
    input.minimapCompartment.of(
      input.minimapEnabled ? createMinimapExtension() : []
    ),
    syntaxHighlighting(filesSyntaxHighlightStyle),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) {
        return;
      }
      input.onSearchStateChange(currentEditorSearchState(update.view));
      if (!input.isDocumentSyncing()) {
        input.onContentsChange(update.state.doc.toString());
      }
    }),
    EditorView.domEventHandlers({
      contextmenu: (event, view) => {
        const handler = input.getContextMenuHandler();
        if (!handler) {
          return false;
        }
        handler(event, editorViewRanges(view));
        return true;
      },
    }),
    input.editableCompartment.of(EditorView.editable.of(!input.readOnly)),
    input.languageCompartment.of(input.languageExtension ?? []),
    ...input.languageToolExtensions,
  ];
}
