import { clipComposerTextPreview } from "@shared/composer-attachment-kind.ts";

export { kindFromFileName } from "@shared/composer-attachment-kind.ts";

export type ComposerAttachmentPasteTier = "medium" | "large";

export interface ComposerAttachment {
  id: string;
  /** Directory attachment (folder). */
  isDirectory?: boolean;
  kind: "image" | "file" | "paste";
  name: string;
  /**
   * In-memory body for paste attachments created via materializeTieredPlainPaste.
   * Source of truth for medium expand + edit dialog; disk is kept in sync on save
   * (large path semantics for agents still use `path`).
   */
  pasteContent?: string;
  pasteTier?: ComposerAttachmentPasteTier;
  path: string;
  /** Image thumbnail data URL from main; file attachments omit this. */
  previewDataUrl?: string | undefined;
  previewHeight?: number | undefined;
  previewWidth?: number | undefined;
  /** Clipped text thumbnail; paste create/edit keep this in sync with pasteContent. */
  textPreview?: string | undefined;
}

export const MAX_COMPOSER_SEND_TEXT_LENGTH = 64_000;

/**
 * Medium paste with in-memory body: expand into send payload, never path-prefix.
 * Paste without pasteContent (or without medium tier) keeps path semantics.
 */
function isExpandableMediumPaste(att: ComposerAttachment): boolean {
  return (
    att.kind === "paste" &&
    att.pasteTier === "medium" &&
    typeof att.pasteContent === "string"
  );
}

function mediumPasteBodies(attachments: readonly ComposerAttachment[]): string {
  return attachments
    .filter(isExpandableMediumPaste)
    .map((att) => att.pasteContent ?? "")
    .filter((text) => text.length > 0)
    .join("\n\n");
}

/**
 * Build the single sendText payload.
 * Attachment chips already serialize to absolute paths in the draft, so only
 * rail paths missing from the body are prefixed (avoids image/path duplicates).
 *
 * Expandable medium paste: path tokens → pasteContent; never path-prefix.
 * When draft is empty but medium pastes remain on the rail, append their bodies
 * even if other attachments still contribute path prefixes.
 */
export function buildComposerSendText(
  attachments: readonly ComposerAttachment[],
  draft: string
): string {
  const mediumPastes = attachments.filter(isExpandableMediumPaste);
  let body = draft;
  if (mediumPastes.length > 0) {
    body = expandMediumPastePathsInDraft(body, mediumPastes);
  }

  const prefixPaths = attachments
    .filter((att) => att.path.length > 0 && !isExpandableMediumPaste(att))
    .map((att) => att.path);
  const present = findPresentAttachmentPaths(body, prefixPaths);
  const missingPaths = prefixPaths.filter((path) => !present.has(path));

  const bodyTrimmed = body.trim() !== "";
  if (bodyTrimmed) {
    if (missingPaths.length === 0) {
      return body;
    }
    return [...missingPaths, body].join("\n");
  }

  // Empty / whitespace-only body after expansion.
  const mediumBody = mediumPasteBodies(attachments);
  if (missingPaths.length === 0) {
    return mediumBody;
  }
  if (mediumBody.length > 0) {
    return [...missingPaths, mediumBody].join("\n");
  }
  return missingPaths.join("\n");
}

/**
 * Replace medium-paste absolute paths in draft with full paste content.
 * Uses the same longest-path left-to-right scan as presence detection.
 */
function expandMediumPastePathsInDraft(
  draft: string,
  mediumPastes: readonly ComposerAttachment[]
): string {
  const byPath = new Map(
    mediumPastes
      .filter(
        (att) => att.path.length > 0 && typeof att.pasteContent === "string"
      )
      .map((att) => [att.path, att.pasteContent as string] as const)
  );
  if (byPath.size === 0 || draft.length === 0) {
    return draft;
  }

  const candidates = [...byPath.keys()].sort(
    (a, b) => b.length - a.length || a.localeCompare(b)
  );

  let index = 0;
  let allowPathStart = true;
  let out = "";
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
      out += byPath.get(matched) ?? "";
      index += matched.length;
      allowPathStart = true;
      continue;
    }
    const ch = draft[index] ?? "";
    out += ch;
    allowPathStart = !isPathContinuationChar(ch);
    index += 1;
  }
  return out;
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

export function updatePasteAttachmentContent(input: {
  attachments: ComposerAttachment[];
  id: string;
  text: string;
}): ComposerAttachment[] {
  return input.attachments.map((att) => {
    if (att.id !== input.id) {
      return att;
    }
    return {
      ...att,
      pasteContent: input.text,
      textPreview: clipComposerTextPreview(input.text),
    };
  });
}

/** Build a paste attachment with required tier + content (single factory). */
export function createPasteAttachment(input: {
  id: string;
  name: string;
  path: string;
  pasteContent: string;
  pasteTier: ComposerAttachmentPasteTier;
}): ComposerAttachment {
  return {
    id: input.id,
    kind: "paste",
    name: input.name,
    path: input.path,
    pasteContent: input.pasteContent,
    pasteTier: input.pasteTier,
    textPreview: clipComposerTextPreview(input.pasteContent),
  };
}
