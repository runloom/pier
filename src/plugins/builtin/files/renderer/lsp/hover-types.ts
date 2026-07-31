import type { EditorView } from "@codemirror/view";
import type { RendererPluginFilesFacade } from "@plugins/api/renderer-facades.ts";

export interface FilesLspHoverLabels {
  contentTruncated: string;
  definitionsTitle: string;
  definitionsTruncated: string;
  documentationTitle: string;
  goToDefinitionFailed: string;
  goToDefinitionUnavailable: string;
  lineTruncated: string;
  noInformation: string;
  previewUnavailable: string;
  symbolTitle: string;
  unavailable: string;
}

export interface FilesLspHoverInput {
  documentId: string;
  getLabels(): FilesLspHoverLabels;
  notifyError?(message: string): void;
  ownerId: string;
  prepareForManual(view: EditorView): "pending" | "ready" | "unavailable";
  readDocument: RendererPluginFilesFacade["readDocument"];
  rootPath: string;
}

export interface FilesLspPosition {
  character: number;
  line: number;
}

export interface FilesLspRange {
  end: FilesLspPosition;
  start: FilesLspPosition;
}

export interface FilesLspParams {
  position: FilesLspPosition;
  textDocument: { uri: string };
}

export type FilesLspRequestResult =
  | { ok: true; value: unknown }
  | { ok: false };

export interface FilesLspPreparedDocumentation {
  html?: string;
  kind: "markdown" | "plaintext";
  value: string;
}

export interface FilesLspPreparedSignature {
  /** Highlighted HTML from docToHTML (fenced code); preferred over plain value. */
  html?: string;
  language: string;
  value: string;
}

export interface FilesLspPreparedPreviewLine {
  lineNumber: number;
  text: string;
  truncated: boolean;
}

export interface FilesLspPreparedDefinition {
  path: string;
  preview?: FilesLspPreparedPreviewLine[] | null;
  range: FilesLspRange;
  uri: string;
}

export type FilesLspHoverCardMode = "definition" | "documentation" | "symbol";

export interface FilesLspHoverCardModel {
  activePreviewTarget: FilesLspPreparedDefinition | null;
  contentTruncated: boolean;
  definitions: FilesLspPreparedDefinition[];
  definitionsShown: number;
  definitionsTotal: number;
  definitionsTruncated: boolean;
  documentation: FilesLspPreparedDocumentation[];
  error: boolean;
  labels: FilesLspHoverLabels;
  mode: FilesLspHoverCardMode;
  signatures: FilesLspPreparedSignature[];
  sourcePath: string;
}

export function filesLspHoverModelHasContent(
  model: Pick<
    FilesLspHoverCardModel,
    "definitions" | "documentation" | "signatures"
  >
): boolean {
  return (
    model.definitions.length > 0 ||
    model.documentation.length > 0 ||
    model.signatures.length > 0
  );
}
