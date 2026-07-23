export { kindFromFileName } from "@shared/composer-attachment-kind.ts";

export interface ComposerAttachment {
  id: string;
  /** Directory attachment (folder). */
  isDirectory?: boolean;
  kind: "image" | "file";
  name: string;
  path: string;
  /** Image thumbnail data URL from main; file attachments omit this. */
  previewDataUrl?: string | undefined;
}

export const MAX_COMPOSER_SEND_TEXT_LENGTH = 64_000;

/**
 * Build the single sendText payload.
 * Attachment chips already serialize to absolute paths in the draft, so only
 * rail paths missing from the body are prefixed (avoids image/path duplicates).
 */
export function buildComposerSendText(
  attachments: readonly ComposerAttachment[],
  draft: string
): string {
  const railPaths = attachments
    .map((att) => att.path)
    .filter((path) => path.length > 0);
  const present = findPresentAttachmentPaths(draft, railPaths);
  const missingPaths = railPaths.filter((path) => !present.has(path));
  // 仅用 trim 判断是否附带正文；载荷保留首尾空白。
  if (missingPaths.length === 0) {
    return draft.trim() === "" ? "" : draft;
  }
  if (draft.trim() === "") {
    return missingPaths.join("\n");
  }
  return [...missingPaths, draft].join("\n");
}

/**
 * Left-to-right longest-path scan over the known attachment set.
 * Handles adjacent chips (`/a.png/b.pdf`) and rejects shorter prefixes
 * (`/tmp/a` inside `/tmp/a.png`).
 */
function findPresentAttachmentPaths(
  draft: string,
  paths: readonly string[]
): Set<string> {
  const candidates = [...new Set(paths)].sort(
    (a, b) => b.length - a.length || a.localeCompare(b)
  );
  const present = new Set<string>();
  if (candidates.length === 0 || draft.length === 0) {
    return present;
  }

  let index = 0;
  let allowPathStart = true;
  while (index < draft.length) {
    let matched: string | null = null;
    if (allowPathStart) {
      for (const path of candidates) {
        if (!draft.startsWith(path, index)) {
          continue;
        }
        const end = index + path.length;
        const after = end >= draft.length ? "" : (draft[end] ?? "");
        const afterOk =
          after === "" ||
          !isPathContinuationChar(after) ||
          candidates.some((other) => draft.startsWith(other, end));
        if (afterOk) {
          matched = path;
          break;
        }
      }
    }
    if (matched) {
      present.add(matched);
      index += matched.length;
      // Adjacent chip may start immediately (no separator).
      allowPathStart = true;
      continue;
    }
    allowPathStart = !isPathContinuationChar(draft[index] ?? "");
    index += 1;
  }
  return present;
}

function isPathContinuationChar(char: string): boolean {
  if (char === "") {
    return false;
  }
  return /[A-Za-z0-9._+\-~%/]/.test(char);
}

export function insertPlainTextAtSelection(
  draft: string,
  selectionStart: number,
  selectionEnd: number,
  text: string
): { draft: string; cursor: number } {
  if (text === "") {
    return {
      draft,
      cursor: Math.max(0, Math.min(selectionStart, draft.length)),
    };
  }
  const start = Math.max(0, Math.min(selectionStart, draft.length));
  const end = Math.max(start, Math.min(selectionEnd, draft.length));
  const next = draft.slice(0, start) + text + draft.slice(end);
  return { draft: next, cursor: start + text.length };
}

/** Fallback when Lexical is unavailable: insert the attachment path as plain text. */
export function insertAttachmentPathAtCursor(
  draft: string,
  cursor: number,
  absolutePath: string,
  selectionEnd: number = cursor
): { draft: string; cursor: number } {
  return insertPlainTextAtSelection(draft, cursor, selectionEnd, absolutePath);
}

export function removeAttachmentById(input: {
  attachments: ComposerAttachment[];
  removeId: string;
}): ComposerAttachment[] {
  return input.attachments.filter((att) => att.id !== input.removeId);
}
