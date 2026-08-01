import { syntaxTree } from "@codemirror/language";
import type { LSPPlugin, WorkspaceMapping } from "@codemirror/lsp-client";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { highlightFilesLspCodeToHtml } from "./code-highlight.ts";
import { decodeFilesLspFileUriPath } from "./definition-preview.ts";
import { normalizeLspHoverContents } from "./hover-content.ts";
import type {
  FilesLspHoverCardMode,
  FilesLspHoverCardModel,
  FilesLspHoverInput,
  FilesLspParams,
  FilesLspPreparedDefinition,
  FilesLspRange,
  FilesLspRequestResult,
} from "./hover-types.ts";

export interface FilesLspHoverCandidate {
  from: number;
  position: number;
  to: number;
}

/** Lezer node names that denote a full string / path literal (not word pieces). */
const STRING_NODE_NAMES = new Set([
  "ByteString",
  "RawString",
  "String",
  "TemplateString",
  "string",
]);

/** Inside these, prefer identifier/word ranges over the outer template string. */
const STRING_INTERPOLATION_NODE_NAMES = new Set([
  "Interpolation",
  "TemplateSubstitution",
  "substitution",
]);

/**
 * CodeMirror ranges are half-open [from, to). Empty (from === to) only covers
 * that single position (punctuation / no-word fallback).
 */
export function filesLspHoverRangeContains(
  from: number,
  to: number,
  position: number
): boolean {
  if (from === to) {
    return position === from;
  }
  return position >= from && position < to;
}

/**
 * Prefer a full string literal from the syntax tree (import paths, URLs) so
 * `apply-tokens` is one candidate, not word fragments. Skip template
 * interpolations (`${…}`) so identifiers inside keep word ranges.
 */
export function filesLspStringRangeAt(
  state: EditorState,
  position: number
): { from: number; to: number } | null {
  const docLength = state.doc.length;
  if (position < 0 || position > docLength) {
    return null;
  }
  const tree = syntaxTree(state);
  if (tree.length === 0) {
    return null;
  }
  // side -1 first: prefer the node ending at a boundary (closing quote).
  for (const side of [-1, 1] as const) {
    const start = tree.resolveInner(position, side);
    for (
      let current: typeof start | null = start;
      current;
      current = current.parent
    ) {
      // Inside `${…}`: do not expand to the outer template string.
      if (STRING_INTERPOLATION_NODE_NAMES.has(current.name)) {
        return null;
      }
      if (STRING_NODE_NAMES.has(current.name) && current.to > current.from) {
        return { from: current.from, to: current.to };
      }
    }
  }
  return null;
}

export function filesLspHoverCandidateAtPosition(
  view: EditorView,
  position: number
): FilesLspHoverCandidate {
  const stringRange = filesLspStringRangeAt(view.state, position);
  if (stringRange) {
    return { from: stringRange.from, position, to: stringRange.to };
  }
  const word = view.state.wordAt(position);
  return word
    ? { from: word.from, position, to: word.to }
    : { from: position, position, to: position };
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
  return filesLspHoverCandidateAtPosition(view, position);
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

/**
 * Same hover symbol when ranges match, or when the pointer is still inside an
 * already-expanded anchor (server Hover.range / full string) even if the new
 * probe was a smaller wordAt fragment.
 */
export function sameFilesLspHoverCandidate(
  left: FilesLspHoverCandidate | null,
  right: FilesLspHoverCandidate
): boolean {
  if (!left) {
    return false;
  }
  if (left.from === right.from && left.to === right.to) {
    return true;
  }
  return filesLspHoverRangeContains(left.from, left.to, right.position);
}

/** Prefer the wider of two ranges that cover the same pointer (server expand). */
export function preferFilesLspHoverCandidateRange(
  anchor: FilesLspHoverCandidate | null,
  probe: FilesLspHoverCandidate
): FilesLspHoverCandidate {
  if (!(anchor && sameFilesLspHoverCandidate(anchor, probe))) {
    return probe;
  }
  const anchorSpan = anchor.to - anchor.from;
  const probeSpan = probe.to - probe.from;
  if (anchorSpan > probeSpan) {
    return { from: anchor.from, position: probe.position, to: anchor.to };
  }
  return probe;
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
} from "./pointer-modifiers.ts";

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
