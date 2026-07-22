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
 * Build the single sendText payload: rail paths first, then draft body.
 * Attachment chips already serialize to absolute paths in the draft.
 */
export function buildComposerSendText(
  attachments: readonly ComposerAttachment[],
  draft: string
): string {
  const paths = attachments.map((att) => att.path);
  // 仅用 trim 判断是否附带正文；载荷保留首尾空白。
  if (paths.length === 0) {
    return draft.trim() === "" ? "" : draft;
  }
  if (draft.trim() === "") {
    return paths.join("\n");
  }
  return [...paths, draft].join("\n");
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
