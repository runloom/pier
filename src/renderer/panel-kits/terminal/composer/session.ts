import type { ComposerAttachment } from "../composer-attachments-model.ts";
import { ComposerAttachmentQueue } from "./attachment-queue.ts";

export interface TerminalComposerSession {
  readonly panelId: string;
  readonly signal: AbortSignal;
}

export interface ComposerReviewChipDraft {
  readonly count: number;
  readonly label: string;
  readonly payloadText: string;
}

export interface ComposerSendLease {
  readonly revision: number;
}

/** Completed input waits here while its editor is hidden, without retaining a view. */
export type ComposerEdit =
  | {
      readonly kind: "attachments";
      readonly attachments: readonly ComposerAttachment[];
    }
  | { readonly kind: "text"; readonly text: string };

interface ComposerSessionRecord {
  attachments: ComposerAttachment[];
  contentGeneration: number;
  controller: AbortController;
  draft: string;
  editorSnapshot: string | null;
  listeners: Set<() => void>;
  mergeApplyGeneration: number | undefined;
  mergeQueue: ComposerAttachmentQueue;
  pendingEdits: ComposerEdit[];
  reviewChip: ComposerReviewChipDraft | null;
  revision: number;
  sending: ComposerSendLease | null;
  session: TerminalComposerSession;
}

const EMPTY_ATTACHMENTS: ComposerAttachment[] = [];
Object.freeze(EMPTY_ATTACHMENTS);
const EMPTY_EDITS: readonly ComposerEdit[] = Object.freeze([]);

/** Terminal-owned, not editor-owned: hiding/unmounting the composer retains it. */
const records = new Map<string, ComposerSessionRecord>();

function recordFor(
  session: TerminalComposerSession
): ComposerSessionRecord | null {
  const record = records.get(session.panelId);
  return record?.session === session ? record : null;
}

function notify(record: ComposerSessionRecord): void {
  for (const listener of record.listeners) {
    listener();
  }
}

export function subscribeComposerSession(
  session: TerminalComposerSession,
  listener: () => void
): () => void {
  const record = recordFor(session);
  record?.listeners.add(listener);
  return () => {
    record?.listeners.delete(listener);
  };
}

export function getTerminalComposerSession(
  panelId: string
): TerminalComposerSession | null {
  return records.get(panelId)?.session ?? null;
}

export function getOrCreateTerminalComposerSession(
  panelId: string
): TerminalComposerSession {
  const existing = getTerminalComposerSession(panelId);
  if (existing) {
    return existing;
  }
  const controller = new AbortController();
  const session = { panelId, signal: controller.signal };
  records.set(panelId, {
    attachments: EMPTY_ATTACHMENTS,
    contentGeneration: 0,
    controller,
    draft: "",
    editorSnapshot: null,
    listeners: new Set(),
    mergeApplyGeneration: undefined,
    mergeQueue: new ComposerAttachmentQueue(),
    pendingEdits: [],
    reviewChip: null,
    revision: 0,
    sending: null,
    session,
  });
  return session;
}

export function disposeTerminalComposerSession(panelId: string): void {
  const record = records.get(panelId);
  if (!record) {
    return;
  }
  // Invalidate before notifying consumers, including synchronous abort callbacks.
  records.delete(panelId);
  record.draft = "";
  record.editorSnapshot = null;
  record.reviewChip = null;
  record.attachments = EMPTY_ATTACHMENTS;
  record.pendingEdits.length = 0;
  record.sending = null;
  record.mergeQueue.dispose();
  notify(record);
  record.listeners.clear();
  record.controller.abort();
}

export function resetTerminalComposerSessionsForTests(): void {
  for (const panelId of records.keys()) {
    disposeTerminalComposerSession(panelId);
  }
}

export function readComposerDraft(session: TerminalComposerSession): string {
  return recordFor(session)?.draft ?? "";
}

export function writeComposerDraft(
  session: TerminalComposerSession,
  value: string
): void {
  const record = recordFor(session);
  if (record && record.draft !== value) {
    record.draft = value;
    record.revision += 1;
    notify(record);
  }
}

export function readComposerEditorSnapshot(
  session: TerminalComposerSession
): string | null {
  return recordFor(session)?.editorSnapshot ?? null;
}

export function writeComposerEditorSnapshot(
  session: TerminalComposerSession,
  json: string
): void {
  const record = recordFor(session);
  if (record) {
    record.editorSnapshot = json;
  }
}

export function readReviewChipDraft(
  session: TerminalComposerSession
): ComposerReviewChipDraft | null {
  return recordFor(session)?.reviewChip ?? null;
}

export function writeReviewChipDraft(
  session: TerminalComposerSession,
  value: ComposerReviewChipDraft
): void {
  const record = recordFor(session);
  if (record) {
    record.reviewChip = value;
  }
}

export function clearReviewChipDraft(session: TerminalComposerSession): void {
  const record = recordFor(session);
  if (record) {
    record.reviewChip = null;
  }
}

export function readComposerAttachments(
  session: TerminalComposerSession
): ComposerAttachment[] {
  return recordFor(session)?.attachments ?? EMPTY_ATTACHMENTS;
}

export function writeComposerAttachments(
  session: TerminalComposerSession,
  attachments: ComposerAttachment[]
): void {
  const record = recordFor(session);
  const next = attachments.length === 0 ? EMPTY_ATTACHMENTS : attachments;
  if (record && record.attachments !== next) {
    record.attachments = next;
    record.revision += 1;
    notify(record);
  }
}

/** One serial queue per terminal; a blocked IPC must not hold other terminals. */
export function enqueueComposerAttachmentMerge(
  session: TerminalComposerSession,
  task: () => void | Promise<void>
): Promise<void> {
  const record = recordFor(session);
  if (!record) {
    return Promise.resolve();
  }
  const generation = record.contentGeneration;
  return record.mergeQueue.enqueue(async () => {
    const current = recordFor(session);
    if (!current || current.contentGeneration !== generation) {
      return;
    }
    current.mergeApplyGeneration = generation;
    try {
      await task();
    } finally {
      if (recordFor(session) === current) {
        current.mergeApplyGeneration = undefined;
      }
    }
  });
}

/** False when a merge job started before the last successful send commit. */
export function canApplyComposerEdit(
  session: TerminalComposerSession
): boolean {
  const record = recordFor(session);
  if (!record) {
    return false;
  }
  return (
    record.mergeApplyGeneration == null ||
    record.mergeApplyGeneration === record.contentGeneration
  );
}

export function appendComposerEdit(
  session: TerminalComposerSession,
  edit: ComposerEdit,
  options?: { bumpRevision?: boolean }
): boolean {
  const record = recordFor(session);
  if (!record) {
    return false;
  }
  record.pendingEdits.push(edit);
  if (options?.bumpRevision !== false) {
    record.revision += 1;
  }
  return true;
}

export function takeComposerEdits(
  session: TerminalComposerSession
): readonly ComposerEdit[] {
  const record = recordFor(session);
  if (!record || record.pendingEdits.length === 0) {
    return EMPTY_EDITS;
  }
  const edits = record.pendingEdits;
  record.pendingEdits = [];
  return edits;
}

export function isComposerSending(session: TerminalComposerSession): boolean {
  return recordFor(session)?.sending != null;
}

export function acquireComposerSend(
  session: TerminalComposerSession,
  currentDraft: string
): ComposerSendLease | null {
  const record = recordFor(session);
  if (!record || record.sending || record.pendingEdits.length > 0) {
    return null;
  }
  // IME may have committed in Lexical before React receives its text change.
  writeComposerDraft(session, currentDraft);
  const lease = { revision: record.revision };
  record.sending = lease;
  notify(record);
  return lease;
}

export function commitComposerSend(
  session: TerminalComposerSession,
  lease: ComposerSendLease
): boolean {
  const record = recordFor(session);
  if (record?.sending !== lease || record.revision !== lease.revision) {
    return false;
  }
  record.draft = "";
  record.editorSnapshot = null;
  record.reviewChip = null;
  record.attachments = EMPTY_ATTACHMENTS;
  record.pendingEdits.length = 0;
  record.contentGeneration += 1;
  record.revision += 1;
  notify(record);
  return true;
}

export function releaseComposerSend(
  session: TerminalComposerSession,
  lease: ComposerSendLease
): void {
  const record = recordFor(session);
  if (record?.sending === lease) {
    record.sending = null;
    notify(record);
  }
}
