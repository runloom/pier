import type { RendererPluginFilesFacade } from "@plugins/api/renderer-facades.ts";

interface DefinitionPosition {
  character: number;
  line: number;
}

interface DefinitionRange {
  end: DefinitionPosition;
  start: DefinitionPosition;
}

interface DefinitionTarget {
  range: DefinitionRange;
  uri: string;
}

type ReadDocumentRequest = Parameters<
  RendererPluginFilesFacade["readDocument"]
>[0];
type ReadDocument = (request: ReadDocumentRequest) => Promise<unknown>;

export interface FilesLspPreviewDocument {
  line(number: number): { readonly text: string };
  readonly lines: number;
}

interface LoadDefinitionPreviewInput {
  currentDocument: FilesLspPreviewDocument;
  currentUri: string;
  readDocument: ReadDocument;
  serverRoot: string;
  target: DefinitionTarget;
}

interface FilesLspDefinitionPreviewLine {
  lineNumber: number;
  text: string;
  truncated: boolean;
}

interface FilesLspPreviewLineRange {
  from: number;
  to: number;
}

interface LoadedPreviewContents {
  contents: string;
  range: FilesLspPreviewLineRange | null;
}

const CONTEXT_LINE_COUNT = 3;
const MAX_LINE_LENGTH = 512;

function hasParentSegment(path: string): boolean {
  return path
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => segment === "..");
}

function collapseSeparators(path: string): string {
  if (path.startsWith("//")) {
    return `//${path.slice(2).replace(/\/{2,}/g, "/")}`;
  }
  return path.replace(/\/{2,}/g, "/");
}

function trimTrailingSeparators(path: string): string {
  if (path === "/" || /^[A-Za-z]:\/$/.test(path)) {
    return path;
  }
  return path.replace(/\/+$/g, "");
}

function normalizeRoot(root: string): string | null {
  if (root.length === 0 || root.includes("\0") || hasParentSegment(root)) {
    return null;
  }
  const normalized = trimTrailingSeparators(
    collapseSeparators(root.replaceAll("\\", "/"))
  );
  if (
    normalized.length === 0 ||
    !(normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized))
  ) {
    return null;
  }
  return normalized;
}

export function decodeFilesLspFileUriPath(uri: string): string | null {
  if (!uri.startsWith("file://")) {
    return null;
  }

  const encodedPath = uri.slice("file://".length).split(/[?#]/, 1)[0] ?? "";
  let decodedRawPath: string;
  try {
    decodedRawPath = decodeURIComponent(encodedPath);
  } catch {
    return null;
  }
  if (hasParentSegment(decodedRawPath)) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(uri.replaceAll("\\", "/"));
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "file:" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== ""
  ) {
    return null;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\0") || hasParentSegment(pathname)) {
    return null;
  }

  const hostname = parsed.hostname;
  let filePath =
    hostname === "" || hostname.toLowerCase() === "localhost"
      ? pathname
      : `//${hostname}${pathname}`;
  if (/^\/[A-Za-z]:\//.test(filePath)) {
    filePath = filePath.slice(1);
  }
  return trimTrailingSeparators(collapseSeparators(filePath));
}

function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:\//.test(path) || path.startsWith("//");
}

function rootRelativePath(root: string, targetPath: string): string | null {
  const normalizedRoot = isWindowsPath(root) ? root.toLowerCase() : root;
  const normalizedTarget = isWindowsPath(root)
    ? targetPath.toLowerCase()
    : targetPath;
  const prefix = root.endsWith("/") ? normalizedRoot : `${normalizedRoot}/`;
  if (!normalizedTarget.startsWith(prefix)) {
    return null;
  }

  const relative = targetPath.slice(prefix.length);
  if (relative.length === 0 || hasParentSegment(relative)) {
    return null;
  }
  return relative;
}

function previewLine(
  text: string,
  lineNumber: number
): FilesLspDefinitionPreviewLine {
  if (text.length <= MAX_LINE_LENGTH) {
    return { lineNumber, text, truncated: false };
  }

  let prefix = text.slice(0, MAX_LINE_LENGTH);
  const finalCodeUnit = prefix.charCodeAt(prefix.length - 1);
  if (finalCodeUnit >= 0xd8_00 && finalCodeUnit <= 0xdb_ff) {
    prefix = prefix.slice(0, -1);
  }
  return { lineNumber, text: prefix, truncated: true };
}

function previewFromDocument(
  document: FilesLspPreviewDocument,
  targetLine: number,
  firstDocumentLine = 0
): FilesLspDefinitionPreviewLine[] | null {
  if (
    !Number.isInteger(targetLine) ||
    targetLine < firstDocumentLine ||
    targetLine >= firstDocumentLine + document.lines
  ) {
    return null;
  }

  const localTargetLine = targetLine - firstDocumentLine;
  const firstLocalLine = Math.max(0, localTargetLine - CONTEXT_LINE_COUNT);
  const lastLocalLine = Math.min(
    document.lines - 1,
    localTargetLine + CONTEXT_LINE_COUNT
  );
  const preview: FilesLspDefinitionPreviewLine[] = [];
  for (let index = firstLocalLine; index <= lastLocalLine; index += 1) {
    const absoluteLine = firstDocumentLine + index;
    preview.push(previewLine(document.line(index + 1).text, absoluteLine + 1));
  }
  return preview;
}

function previewFromContents(
  loaded: LoadedPreviewContents,
  targetLine: number
): FilesLspDefinitionPreviewLine[] | null {
  const lines = loaded.contents.split(/\r\n|\n|\r/);
  const range = loaded.range ?? { from: 0, to: lines.length };
  if (targetLine < range.from || targetLine >= range.to) {
    return null;
  }
  return previewFromDocument(
    {
      line: (number) => ({ text: lines[number - 1] ?? "" }),
      lines: Math.min(lines.length, range.to - range.from),
    },
    targetLine,
    range.from
  );
}

function isPreviewLineRange(value: unknown): value is FilesLspPreviewLineRange {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const from = "from" in value ? value.from : null;
  const to = "to" in value ? value.to : null;
  return (
    typeof from === "number" &&
    Number.isInteger(from) &&
    from >= 0 &&
    typeof to === "number" &&
    Number.isInteger(to) &&
    to >= from
  );
}

function textContents(result: unknown): LoadedPreviewContents | null {
  if (
    result === null ||
    typeof result !== "object" ||
    !("kind" in result) ||
    result.kind !== "text" ||
    !("contents" in result) ||
    typeof result.contents !== "string"
  ) {
    return null;
  }
  let range: FilesLspPreviewLineRange | null = null;
  if ("range" in result) {
    if (!isPreviewLineRange(result.range)) {
      return null;
    }
    range = result.range;
  }
  return {
    contents: result.contents,
    range,
  };
}

export async function loadFilesLspDefinitionPreview(
  input: LoadDefinitionPreviewInput
): Promise<FilesLspDefinitionPreviewLine[] | null> {
  const targetLine = input.target.range.start.line;
  if (input.target.uri === input.currentUri) {
    return previewFromDocument(input.currentDocument, targetLine);
  }

  const root = normalizeRoot(input.serverRoot);
  const targetPath = decodeFilesLspFileUriPath(input.target.uri);
  if (root === null || targetPath === null) {
    return null;
  }
  const relativePath = rootRelativePath(root, targetPath);
  if (relativePath === null) {
    return null;
  }

  try {
    const result = await input.readDocument({ path: relativePath, root });
    const loaded = textContents(result);
    return loaded === null ? null : previewFromContents(loaded, targetLine);
  } catch {
    return null;
  }
}
