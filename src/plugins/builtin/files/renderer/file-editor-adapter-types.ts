import type { FileEditorController } from "./file-editor-controller.ts";
import type { EditorRange, FileViewMode } from "./files-document-types.ts";

export interface FileEditorAdapterLabels {
  diffUnsupported: string;
  richUnsupported: string;
  sourceEditor: string;
}

export interface FilesEditorSearchLabels {
  close: string;
  matchCase?: string;
  next: string;
  noMatches: string;
  placeholder: string;
  previous: string;
  regexp?: string;
  replace?: string;
  replaceAll?: string;
  replacePlaceholder?: string;
  selectAll?: string;
  wholeWord?: string;
}

export interface FileEditorAdapterProps {
  controller: FileEditorController;
  documentId: string;
  editorSessionId: string;
  labels?: FileEditorAdapterLabels;
  mode: FileViewMode;
  onEditorContextMenu?: (
    event: MouseEvent,
    ranges: readonly EditorRange[]
  ) => void;
  originalValue?: string;
  readOnly?: boolean;
  searchLabels?: FilesEditorSearchLabels;
  searchRequest?: number;
  value: string;
}
