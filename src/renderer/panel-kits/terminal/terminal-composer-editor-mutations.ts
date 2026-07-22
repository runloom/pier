import {
  type ComposerAttachment,
  insertAttachmentPathAtCursor,
  insertPlainTextAtSelection,
  removeAttachmentById,
} from "./terminal-composer-attachments-model.ts";

export interface ComposerEditorMutations {
  getSelection: () => { cursor: number; selectionEnd: number };
  getValue: () => string;
  insertAttachmentToken: (absolutePath: string, ordinal1Based: number) => void;
  insertTextAtSelection: (text: string) => void;
  listInvalidAttachmentRefs: (
    attachments: readonly ComposerAttachment[]
  ) => string[];
  rewriteAttachmentTokensAfterRemove: (
    removedAbsolutePath: string,
    nextAttachments: readonly ComposerAttachment[]
  ) => string;
}

export interface DraftCursorSync {
  cursor: number;
  draft: string;
}

export function removeComposerAttachment(args: {
  editorMutations: ComposerEditorMutations | undefined;
  getDraftAndCursor: () => { cursor: number; draft: string };
  onDraftChange: (draft: string, cursor?: number) => void;
  readAttachments: () => ComposerAttachment[];
  removeId: string;
  writeAttachments: (next: ComposerAttachment[]) => void;
}): DraftCursorSync | null {
  const current = args.readAttachments();
  const removed = current.find((att) => att.id === args.removeId);
  if (!removed) {
    return null;
  }
  const nextAttachments = removeAttachmentById({
    attachments: current,
    removeId: args.removeId,
  });
  args.writeAttachments(nextAttachments);

  if (args.editorMutations) {
    const draft = args.editorMutations.rewriteAttachmentTokensAfterRemove(
      removed.path,
      nextAttachments
    );
    const selection = args.editorMutations.getSelection();
    args.onDraftChange(draft, selection.cursor);
    return { cursor: selection.cursor, draft };
  }

  // No structured editor: rail-only change; body paths stay as plain text.
  const { draft, cursor } = args.getDraftAndCursor();
  return { cursor, draft };
}

export function mergeComposerAttachments(args: {
  editorMutations: ComposerEditorMutations | undefined;
  getDraftAndCursor: () => {
    cursor: number;
    draft: string;
    selectionEnd?: number;
  };
  incoming: readonly ComposerAttachment[];
  onDraftChange: (draft: string, cursor?: number) => void;
  readAttachments: () => ComposerAttachment[];
  writeAttachments: (next: ComposerAttachment[]) => void;
}): DraftCursorSync | null {
  if (args.incoming.length === 0) {
    return null;
  }

  const current = args.readAttachments();
  const existingPaths = new Set(current.map((item) => item.path));
  const unique: ComposerAttachment[] = [];
  for (const item of args.incoming) {
    if (existingPaths.has(item.path)) {
      continue;
    }
    existingPaths.add(item.path);
    unique.push(item);
  }
  if (unique.length === 0) {
    return null;
  }

  const next = [...current];
  if (args.editorMutations) {
    for (const attachment of unique) {
      next.push(attachment);
      args.editorMutations.insertAttachmentToken(attachment.path, next.length);
    }
    args.writeAttachments(next);
    const draft = args.editorMutations.getValue();
    const selection = args.editorMutations.getSelection();
    args.onDraftChange(draft, selection.cursor);
    return { cursor: selection.cursor, draft };
  }

  const snapshot = args.getDraftAndCursor();
  let cursor = snapshot.cursor;
  let selectionEnd = snapshot.selectionEnd ?? snapshot.cursor;
  let draft = snapshot.draft;
  for (const attachment of unique) {
    next.push(attachment);
    const inserted = insertAttachmentPathAtCursor(
      draft,
      cursor,
      attachment.path,
      selectionEnd
    );
    cursor = inserted.cursor;
    selectionEnd = inserted.cursor;
    draft = inserted.draft;
  }

  args.writeAttachments(next);
  args.onDraftChange(draft, cursor);
  return { cursor, draft };
}

export function insertComposerPlainTextAtCursor(args: {
  base?: { cursor: number; draft: string };
  editorMutations: ComposerEditorMutations | undefined;
  getDraftAndCursor: () => {
    cursor: number;
    draft: string;
    selectionEnd?: number;
  };
  onDraftChange: (draft: string, cursor?: number) => void;
  text: string;
}): DraftCursorSync | null {
  if (args.text === "") {
    return null;
  }
  if (args.editorMutations && !args.base) {
    args.editorMutations.insertTextAtSelection(args.text);
    const draft = args.editorMutations.getValue();
    const selection = args.editorMutations.getSelection();
    args.onDraftChange(draft, selection.cursor);
    return { cursor: selection.cursor, draft };
  }

  const live = args.getDraftAndCursor();
  const source = args.base ?? {
    cursor: live.cursor,
    draft: live.draft,
  };
  const selectionEnd = args.base
    ? args.base.cursor
    : (live.selectionEnd ?? live.cursor);
  const inserted = insertPlainTextAtSelection(
    source.draft,
    source.cursor,
    args.base ? args.base.cursor : selectionEnd,
    args.text
  );
  args.onDraftChange(inserted.draft, inserted.cursor);
  return { cursor: inserted.cursor, draft: inserted.draft };
}
