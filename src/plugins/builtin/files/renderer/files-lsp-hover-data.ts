import type { LSPPlugin, WorkspaceMapping } from "@codemirror/lsp-client";
import type { EditorView } from "@codemirror/view";
import { highlightFilesLspCodeToHtml } from "./files-lsp-code-highlight.ts";
import { decodeFilesLspFileUriPath } from "./files-lsp-definition-preview.ts";
import { normalizeLspHoverContents } from "./files-lsp-hover-content.ts";
import type {
  FilesLspHoverCardMode,
  FilesLspHoverCardModel,
  FilesLspHoverInput,
  FilesLspParams,
  FilesLspPreparedDefinition,
  FilesLspRange,
  FilesLspRequestResult,
} from "./files-lsp-hover-types.ts";

export interface FilesLspHoverCandidate {
  from: number;
  position: number;
  to: number;
}

export function filesLspHoverCandidateAt(
  view: EditorView,
  x: number,
  y: number
): FilesLspHoverCandidate | null {
  const position = view.posAtCoords({ x, y });
  if (position === null) {
    return null;
  }
  const word = view.state.wordAt(position);
  return word
    ? { from: word.from, position, to: word.to }
    : { from: position, position, to: position };
}

export function filesLspHoverParams(
  plugin: LSPPlugin,
  position: number
): FilesLspParams {
  return {
    position: plugin.toPosition(position),
    textDocument: { uri: plugin.uri },
  };
}

export function sameFilesLspHoverCandidate(
  left: FilesLspHoverCandidate | null,
  right: FilesLspHoverCandidate
): boolean {
  return left?.from === right.from && left.to === right.to;
}

export interface FilesLspDefinitionResponseTarget {
  range: FilesLspRange;
  uri: string;
}

export class FilesLspOwnedMapping {
  #destroyed = false;
  readonly value: WorkspaceMapping;

  constructor(mapping: WorkspaceMapping) {
    this.value = mapping;
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    this.value.destroy();
  }
}

export {
  filesLspEventHasNoModifiers,
  isFilesLspDefinitionModifier as exactFilesLspDefinitionModifier,
  isFilesLspDefinitionModifier,
  isFilesLspMultiCursorModifier,
} from "./files-lsp-pointer-modifiers.ts";

export function displayFilesLspPath(uri: string): string {
  return decodeFilesLspFileUriPath(uri) ?? uri;
}

export function prepareFilesLspDefinitions(input: {
  targets: FilesLspDefinitionResponseTarget[];
}): FilesLspPreparedDefinition[] {
  return input.targets.map((target) => ({
    path: displayFilesLspPath(target.uri),
    range: target.range,
    uri: target.uri,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPosition(
  value: unknown
): value is { character: number; line: number } {
  return (
    isRecord(value) &&
    typeof value.character === "number" &&
    Number.isInteger(value.character) &&
    value.character >= 0 &&
    typeof value.line === "number" &&
    Number.isInteger(value.line) &&
    value.line >= 0
  );
}

function isRange(value: unknown): value is FilesLspRange {
  if (!(isRecord(value) && isPosition(value.start) && isPosition(value.end))) {
    return false;
  }
  return (
    value.end.line > value.start.line ||
    (value.end.line === value.start.line &&
      value.end.character >= value.start.character)
  );
}

/** Prefer server Hover.range when present; used to re-anchor tooltips. */
export function extractFilesLspHoverRange(
  response: unknown
): FilesLspRange | null {
  if (!(isRecord(response) && "range" in response && isRange(response.range))) {
    return null;
  }
  return response.range;
}

export function createFilesLspHoverModel(input: {
  definitions: FilesLspPreparedDefinition[];
  definitionsTotal: number;
  definitionsTruncated: boolean;
  error: boolean;
  hoverInput: FilesLspHoverInput;
  hoverResult: FilesLspRequestResult | null;
  mode: FilesLspHoverCardMode;
  plugin: Pick<LSPPlugin, "docToHTML" | "uri">;
}): FilesLspHoverCardModel {
  const response = input.hoverResult?.ok ? input.hoverResult.value : null;
  const contents =
    response !== null && typeof response === "object" && "contents" in response
      ? normalizeLspHoverContents(response.contents)
      : normalizeLspHoverContents(null);
  return {
    activePreviewTarget: null,
    contentTruncated: contents.truncated,
    definitions: input.definitions,
    definitionsTruncated: input.definitionsTruncated,
    definitionsShown: input.definitions.length,
    definitionsTotal: input.definitionsTotal,
    documentation: contents.documentation.map((documentation) => ({
      ...(documentation.kind === "markdown"
        ? { html: input.plugin.docToHTML(documentation) }
        : {}),
      kind: documentation.kind,
      value: documentation.value,
    })),
    error: input.error,
    labels: input.hoverInput.getLabels(),
    mode: input.mode,
    // MarkedString signatures: stable tok-* highlighting (not StyleModule ͼ*).
    signatures: contents.signatures.map((signature) => ({
      html: highlightFilesLspCodeToHtml(
        signature.value,
        signature.language.trim().length > 0 ? signature.language : "text"
      ),
      language: signature.language,
      value: signature.value,
    })),
    sourcePath: displayFilesLspPath(input.plugin.uri),
  };
}
