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

export const COMPOSER_ATT_TOKEN = /\[#(\d+)\]/g;

export const MAX_COMPOSER_SEND_TEXT_LENGTH = 64_000;

export function expandAttachmentTokens(
  draft: string,
  attachments: readonly ComposerAttachment[]
): string {
  return draft.replace(COMPOSER_ATT_TOKEN, (match, digits: string) => {
    const n = Number(digits);
    if (n >= 1 && n <= attachments.length) {
      return attachments[n - 1]!.path;
    }
    return match;
  });
}

export function findInvalidAttachmentTokens(
  draft: string,
  attachmentCount: number
): number[] {
  const invalid = new Set<number>();
  for (const match of draft.matchAll(COMPOSER_ATT_TOKEN)) {
    const n = Number(match[1]);
    if (n < 1 || n > attachmentCount) {
      invalid.add(n);
    }
  }
  return [...invalid].sort((a, b) => a - b);
}

export function buildComposerSendText(
  attachments: readonly ComposerAttachment[],
  draft: string
): string {
  const paths = attachments.map((att) => att.path);
  const expanded = expandAttachmentTokens(draft, attachments);
  // 仅用 trim 判断是否附带正文；载荷保留首尾空白。
  if (paths.length === 0) {
    return expanded.trim() === "" ? "" : expanded;
  }
  if (expanded.trim() === "") {
    return paths.join("\n");
  }
  return [...paths, expanded].join("\n");
}

export function removeAttachmentAndRewriteDraft(input: {
  attachments: ComposerAttachment[];
  draft: string;
  removeId: string;
}): { attachments: ComposerAttachment[]; draft: string } {
  const { attachments, draft, removeId } = input;
  const removeIndex = attachments.findIndex((att) => att.id === removeId);
  if (removeIndex < 0) {
    return { attachments, draft };
  }

  const nextAttachments = attachments.filter((_, i) => i !== removeIndex);
  const removedOrdinal = removeIndex + 1;

  const matches = [...draft.matchAll(COMPOSER_ATT_TOKEN)]
    .map((m) => ({
      index: m.index ?? 0,
      n: Number(m[1]),
      text: m[0],
    }))
    .sort((a, b) => b.index - a.index);

  let nextDraft = draft;
  for (const m of matches) {
    let replacement: string;
    if (m.n === removedOrdinal) {
      replacement = "";
    } else if (m.n > removedOrdinal) {
      replacement = `[#${m.n - 1}]`;
    } else {
      continue;
    }
    nextDraft =
      nextDraft.slice(0, m.index) +
      replacement +
      nextDraft.slice(m.index + m.text.length);
  }

  return { attachments: nextAttachments, draft: nextDraft };
}

export function insertTokenAtCursor(
  draft: string,
  cursor: number,
  tokenIndex1Based: number,
  selectionEnd: number = cursor
): { draft: string; cursor: number } {
  const token = `[#${tokenIndex1Based}]`;
  const start = Math.max(0, Math.min(cursor, draft.length));
  const end = Math.max(start, Math.min(selectionEnd, draft.length));
  const before = draft.slice(0, start);
  const after = draft.slice(end);

  const needLeadingSpace = before.length > 0 && !/\s$/.test(before);
  const needTrailingSpace = after.length > 0 && !/^\s/.test(after);

  const inserted =
    (needLeadingSpace ? " " : "") + token + (needTrailingSpace ? " " : "");

  return {
    draft: before + inserted + after,
    cursor: before.length + inserted.length,
  };
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
