import type { Compartment, Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { FilesDocument } from "../document/types.ts";
import type { FileEditorViewPresentation } from "./adapter-types.ts";
import { cmLanguageExtension } from "./cm-language.ts";
import type { EditorSearchState } from "./cm-search-state.ts";
import type { GitGutterNavigateHandler } from "./git-gutter.ts";
import type { FileEditorLanguageTools } from "./language-tools.ts";
import { type FilesEditorPrefs, resolveFilesEditorLanguage } from "./prefs.ts";
import { createFileEditorViewExtensions } from "./view-extensions.ts";

export interface SessionExtensionState {
  configuredLanguage: FilesDocument["language"] | null;
  configuredPath: string | undefined;
  configuredReadOnly: boolean | null;
  documentReadOnly: boolean;
  extensions: Extension[];
}

/** 装配 CodeMirror extensions，并回写 language / readOnly 配置快照。 */
export function buildFileEditorSessionExtensions(input: {
  ariaCompartment: Compartment;
  document: FilesDocument;
  editableCompartment: Compartment;
  editorPrefs: FilesEditorPrefs;
  gitGutterNavigate: GitGutterNavigateHandler | null;
  gitGutterNavigateCompartment: Compartment;
  hostReadOnly: boolean;
  isDocumentSyncing: () => boolean;
  languageCompartment: Compartment;
  languageTools: FileEditorLanguageTools;
  minimapCompartment: Compartment;
  minimapEnabled: boolean;
  onChange: (documentId: string, contents: string) => void;
  presentation: FileEditorViewPresentation;
  documentId: string;
}): SessionExtensionState {
  const language = resolveFilesEditorLanguage(
    input.document.language,
    input.editorPrefs.defaultLanguage
  );
  const path =
    input.document.source.kind === "disk"
      ? input.document.source.path
      : undefined;
  const documentReadOnly =
    input.document.readOnly || input.document.loadState === "loading";
  const readOnly = input.hostReadOnly || documentReadOnly;
  const languageExtension = cmLanguageExtension(language, path);
  return {
    configuredLanguage: language,
    configuredPath: path,
    configuredReadOnly: readOnly,
    documentReadOnly,
    extensions: createFileEditorViewExtensions({
      ariaCompartment: input.ariaCompartment,
      ariaLabel: input.presentation.ariaLabel,
      editableCompartment: input.editableCompartment,
      gitGutterNavigate: input.gitGutterNavigate,
      gitGutterNavigateCompartment: input.gitGutterNavigateCompartment,
      languageCompartment: input.languageCompartment,
      languageExtension,
      languageToolExtensions: input.languageTools.extensions(input.document),
      minimapCompartment: input.minimapCompartment,
      minimapEnabled: input.minimapEnabled,
      getContextMenuHandler: () => input.presentation.onContextMenu,
      isDocumentSyncing: input.isDocumentSyncing,
      onContentsChange: (contents) =>
        input.onChange(input.documentId, contents),
      onOpenSearch: () => input.presentation.onOpenSearch(),
      onSearchStateChange: (state: EditorSearchState) =>
        input.presentation.onSearchStateChange(state),
      readOnly,
    }),
  };
}

/** defaultLanguage 偏好变化且文档 language=text 时重配语言扩展。 */
export function applyDefaultLanguagePreference(input: {
  document: FilesDocument;
  languageCompartment: Compartment;
  prefs: FilesEditorPrefs;
  view: EditorView;
}): { language: FilesDocument["language"]; path: string | undefined } {
  const language = input.prefs.defaultLanguage ?? "text";
  const path =
    input.document.source.kind === "disk"
      ? input.document.source.path
      : undefined;
  input.view.dispatch({
    effects: input.languageCompartment.reconfigure(
      cmLanguageExtension(language, path) ?? []
    ),
  });
  return { language, path };
}

/** syncDocument 时的 language / readOnly 配置差量。 */
export function resolveDocumentEditorChrome(input: {
  document: FilesDocument;
  editorPrefs: FilesEditorPrefs;
  hostReadOnly: boolean;
}): {
  documentReadOnly: boolean;
  language: FilesDocument["language"];
  languageExtension: Extension | null;
  path: string | undefined;
  readOnly: boolean;
} {
  const language = resolveFilesEditorLanguage(
    input.document.language,
    input.editorPrefs.defaultLanguage
  );
  const path =
    input.document.source.kind === "disk"
      ? input.document.source.path
      : undefined;
  const documentReadOnly =
    input.document.readOnly || input.document.loadState === "loading";
  const readOnly = input.hostReadOnly || documentReadOnly;
  return {
    documentReadOnly,
    language,
    languageExtension: cmLanguageExtension(language, path),
    path,
    readOnly,
  };
}
