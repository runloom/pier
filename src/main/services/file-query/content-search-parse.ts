/**
 * Parse rg --json match lines into content-query hits.
 */

import { relative, sep } from "node:path";
import {
  FILE_CONTENT_QUERY_PREVIEW_MAX_CHARS,
  type FileContentQueryItem,
  type FileContentQueryStart,
} from "@shared/contracts/file/query.ts";
import { FILES_TREE_DEFAULT_EXCLUDE_PATTERNS } from "@shared/contracts/file/tree-exclude.ts";
import { utf8ByteOffsetToStringIndex } from "@shared/text/utf8-byte-offset.ts";

export { utf8ByteOffsetToStringIndex } from "@shared/text/utf8-byte-offset.ts";

interface RgMatchJson {
  data?: {
    path?: { text?: string };
    lines?: { text?: string };
    line_number?: number;
    absolute_offset?: number;
    submatches?: readonly {
      start?: number;
      end?: number;
    }[];
  };
  type?: string;
}

/**
 * Parse one `rg --json` line into zero or more content hits.
 * Exported for unit tests.
 */
export function parseRgMatchLine(
  line: string,
  projectRoot: string
): FileContentQueryItem[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let parsed: RgMatchJson;
  try {
    parsed = JSON.parse(trimmed) as RgMatchJson;
  } catch {
    return [];
  }
  if (parsed.type !== "match" || !parsed.data) return [];

  const absPath = parsed.data.path?.text;
  const lineNumber = parsed.data.line_number;
  const absoluteOffset = parsed.data.absolute_offset;
  const lineTextRaw = parsed.data.lines?.text ?? "";
  if (
    typeof absPath !== "string" ||
    typeof lineNumber !== "number" ||
    typeof absoluteOffset !== "number"
  ) {
    return [];
  }

  const rel = toRelativePosix(projectRoot, absPath);
  if (!rel) return [];

  const lineText = lineTextRaw.replace(/\r?\n$/, "");
  const submatches = parsed.data.submatches ?? [];
  if (submatches.length === 0) {
    const preview = truncatePreview(lineText, 0, 0);
    return [
      {
        path: rel,
        line: lineNumber,
        matchCharStart: 0,
        matchCharEnd: 0,
        matchByteStart: absoluteOffset,
        matchByteEnd: absoluteOffset,
        preview: preview.text,
        previewMatchStart: preview.matchStart,
        previewMatchEnd: preview.matchEnd,
      },
    ];
  }

  const items: FileContentQueryItem[] = [];
  for (const sub of submatches) {
    // rg submatch start/end are UTF-8 byte offsets within the line text.
    const startBytes = typeof sub.start === "number" ? sub.start : 0;
    const endBytes = typeof sub.end === "number" ? sub.end : startBytes;
    const startIdx = utf8ByteOffsetToStringIndex(lineText, startBytes);
    const endIdx = utf8ByteOffsetToStringIndex(lineText, endBytes);
    const preview = truncatePreview(lineText, startIdx, endIdx);
    items.push({
      path: rel,
      line: lineNumber,
      matchCharStart: startIdx,
      matchCharEnd: endIdx,
      matchByteStart: absoluteOffset + startBytes,
      matchByteEnd: absoluteOffset + endBytes,
      preview: preview.text,
      previewMatchStart: preview.matchStart,
      previewMatchEnd: preview.matchEnd,
    });
  }
  return items;
}

function toRelativePosix(root: string, absolutePath: string): string | null {
  const rel = relative(root, absolutePath);
  // Drop escapes, empty, and absolute relatives (Windows cross-drive).
  const escapes =
    !rel ||
    rel.startsWith("..") ||
    rel.includes(`..${sep}`) ||
    rel === ".." ||
    rel.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(rel);
  if (escapes) {
    // Accept already-relative paths from rg when cwd == root (posix only).
    if (
      !(
        absolutePath.startsWith("/") ||
        /^[A-Za-z]:[\\/]/.test(absolutePath) ||
        absolutePath.includes("\0") ||
        /(^|\/)\.\.(\/|$)/.test(absolutePath)
      )
    ) {
      return absolutePath.split(sep).join("/");
    }
    return null;
  }
  return rel.split(sep).join("/");
}

function truncatePreview(
  lineText: string,
  matchStart: number,
  matchEnd: number
): { text: string; matchStart: number; matchEnd: number } {
  const max = FILE_CONTENT_QUERY_PREVIEW_MAX_CHARS;
  if (lineText.length <= max) {
    return {
      text: lineText,
      matchStart: clamp(matchStart, 0, lineText.length),
      matchEnd: clamp(matchEnd, 0, lineText.length),
    };
  }

  // Keep a window around the match.
  const matchMid = Math.floor((matchStart + matchEnd) / 2);
  let windowStart = Math.max(0, matchMid - Math.floor(max / 2));
  let windowEnd = windowStart + max;
  if (windowEnd > lineText.length) {
    windowEnd = lineText.length;
    windowStart = Math.max(0, windowEnd - max);
  }
  const slice = lineText.slice(windowStart, windowEnd);
  const prefix = windowStart > 0 ? "…" : "";
  const suffix = windowEnd < lineText.length ? "…" : "";
  const text = `${prefix}${slice}${suffix}`;
  const adjust = windowStart - (prefix ? 1 : 0);
  return {
    text,
    matchStart: clamp(matchStart - adjust, 0, text.length),
    matchEnd: clamp(matchEnd - adjust, 0, text.length),
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Test helper: pure exclude source resolution mirrors path mode. */
export function resolveContentExcludePatterns(
  defaults: string,
  options: FileContentQueryStart["options"]
): string {
  const applyExcludes = options?.applyExcludePatterns ?? true;
  if (!applyExcludes) return "";
  if (options?.excludePatterns !== undefined) {
    return options.excludePatterns;
  }
  return defaults || FILES_TREE_DEFAULT_EXCLUDE_PATTERNS;
}
