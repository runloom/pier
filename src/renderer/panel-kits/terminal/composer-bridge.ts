import { mergeComposerText } from "@/lib/comments/processable.ts";
import {
  appendComposerEdit,
  type ComposerEdit,
  canApplyComposerEdit,
  clearReviewChipDraft,
  getTerminalComposerSession,
  isComposerSending,
  readComposerDraft,
  type TerminalComposerSession,
  takeComposerEdits,
  writeReviewChipDraft,
} from "./composer/session.ts";
import type { ReviewCommentsChipInsert } from "./structured-composer/mutations.ts";

type ComposerOpener = () => void;
type ComposerPlainInserter = (text: string) => void;
type ComposerReviewInserter = (
  input: ReviewCommentsChipInsert
) => boolean | Promise<boolean>;

type ComposerEditHandler = (edit: ComposerEdit) => boolean;
interface Registration<T> {
  readonly callback: T;
  readonly dispose: () => void;
  readonly session: TerminalComposerSession;
}

interface PendingReviewInsert {
  readonly input: ReviewCommentsChipInsert;
  readonly resolve: (ok: boolean) => void;
  readonly session: TerminalComposerSession;
  readonly stopListening: () => void;
  readonly timer: number | undefined;
}

const openers = new Map<string, Registration<ComposerOpener>>();
const plainInserters = new Map<string, Registration<ComposerPlainInserter>>();
const reviewInserters = new Map<string, Registration<ComposerReviewInserter>>();
const editHandlers = new Map<string, Registration<ComposerEditHandler>>();
/** Retain pending inserts through materialize ack so close can settle them. */
const pendingReviewInserts = new Map<string, PendingReviewInsert>();
const PENDING_REVIEW_TIMEOUT_MS = 8000;

function isLiveSession(session: TerminalComposerSession): boolean {
  return (
    !session.signal.aborted &&
    getTerminalComposerSession(session.panelId) === session
  );
}

function register<T>(
  registry: Map<string, Registration<T>>,
  session: TerminalComposerSession,
  callback: T
): Registration<T> {
  const { panelId, signal } = session;
  const registration: Registration<T> = {
    callback,
    session,
    dispose: () => {
      signal.removeEventListener("abort", registration.dispose);
      if (registry.get(panelId) === registration) {
        registry.delete(panelId);
      }
    },
  };
  if (isLiveSession(session)) {
    registry.get(panelId)?.dispose();
    registry.set(panelId, registration);
    signal.addEventListener("abort", registration.dispose, { once: true });
  }
  return registration;
}

function clearPendingReview(panelId: string, ok: boolean): void {
  const pending = pendingReviewInserts.get(panelId);
  if (!pending) {
    return;
  }
  pendingReviewInserts.delete(panelId);
  window.clearTimeout(pending.timer);
  pending.stopListening();
  const accepted = ok && isLiveSession(pending.session);
  if (accepted) {
    writeReviewChipDraft(pending.session, pending.input);
  }
  pending.resolve(accepted);
}

function flushReview(
  registration: Registration<ComposerReviewInserter>,
  pending: PendingReviewInsert
): void {
  const { session } = registration;
  const { panelId } = session;
  const isCurrent = () =>
    isLiveSession(session) &&
    pending.session === session &&
    reviewInserters.get(panelId) === registration &&
    pendingReviewInserts.get(panelId) === pending;
  const settle = (ok: boolean) => {
    if (pendingReviewInserts.get(panelId) === pending) {
      clearPendingReview(panelId, ok && isCurrent());
    }
  };
  if (!isCurrent()) {
    settle(false);
    return;
  }
  try {
    Promise.resolve(registration.callback(pending.input)).then(settle, () =>
      settle(false)
    );
  } catch {
    settle(false);
  }
}

/** Prevent remount hydration from racing a queued or in-flight chip insertion. */
export function isReviewInsertFlushPending(panelId: string): boolean {
  return pendingReviewInserts.has(panelId);
}

export function registerComposerOpener(
  session: TerminalComposerSession,
  open: ComposerOpener
): () => void {
  return register(openers, session, open).dispose;
}

export function registerComposerInserter(
  session: TerminalComposerSession,
  insert: ComposerPlainInserter
): () => void {
  return register(plainInserters, session, insert).dispose;
}

/** Deliver completed input to the current mount; hidden input retains only data. */
export function dispatchComposerEdit(
  session: TerminalComposerSession,
  edit: ComposerEdit
): boolean {
  if (!(isLiveSession(session) && canApplyComposerEdit(session))) {
    return false;
  }
  if (edit.kind === "attachments" && isComposerSending(session)) {
    // Keep them off the payload revision so a successful commit can drop them.
    return appendComposerEdit(session, edit, { bumpRevision: false });
  }
  const registration = editHandlers.get(session.panelId);
  if (registration?.session === session) {
    return registration.callback(edit);
  }
  return appendComposerEdit(session, edit);
}

function deliverPendingEdits(session: TerminalComposerSession): void {
  if (!isLiveSession(session) || isComposerSending(session)) {
    return;
  }
  const registration = editHandlers.get(session.panelId);
  if (registration?.session !== session) {
    return;
  }
  for (const edit of takeComposerEdits(session)) {
    dispatchComposerEdit(session, edit);
  }
}

/** Apply hidden-completion edits now that a live handler (or send) can take them. */
export function flushPendingComposerEdits(
  session: TerminalComposerSession
): void {
  deliverPendingEdits(session);
}

export function registerComposerEditHandler(
  session: TerminalComposerSession,
  handle: ComposerEditHandler
): () => void {
  const registration = register(editHandlers, session, handle);
  deliverPendingEdits(session);
  return registration.dispose;
}

export function registerComposerReviewInserter(
  session: TerminalComposerSession,
  insert: ComposerReviewInserter
): () => void {
  const registration = register(reviewInserters, session, insert);
  const pending = pendingReviewInserts.get(session.panelId);
  if (pending?.session === session && isLiveSession(session)) {
    // Wait until the editor's imperative handle is attached.
    queueMicrotask(() => flushReview(registration, pending));
  }
  return registration.dispose;
}

/** Open a hidden composer, or append into the live editor. No entry, no draft. */
export function insertTextIntoTerminalComposer(
  panelId: string,
  text: string
): boolean {
  const session = getTerminalComposerSession(panelId);
  if (!(session && isLiveSession(session))) {
    return false;
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return false;
  }
  const insert = plainInserters.get(panelId);
  const open = openers.get(panelId);
  if (insert?.session === session) {
    insert.callback(trimmed);
    if (!isLiveSession(session) || plainInserters.get(panelId) !== insert) {
      return false;
    }
    if (open?.session === session && openers.get(panelId) === open) {
      open.callback();
    }
    return isLiveSession(session);
  }
  if (open?.session !== session) {
    return false;
  }
  const existing = readComposerDraft(session);
  const merged = mergeComposerText(existing, trimmed);
  if (merged !== existing) {
    const suffix = merged.startsWith(existing)
      ? merged.slice(existing.length)
      : `\n\n${trimmed}`;
    dispatchComposerEdit(session, { kind: "text", text: suffix });
  }
  open.callback();
  return isLiveSession(session);
}

/** Resolve only after chip ack; abort/timeout/replacement leave comments intact. */
export async function insertReviewCommentsIntoTerminalComposer(
  panelId: string,
  input: ReviewCommentsChipInsert
): Promise<boolean> {
  const session = getTerminalComposerSession(panelId);
  if (!(session && isLiveSession(session))) {
    return false;
  }
  const payload = input.payloadText.trim();
  if (payload.length === 0 || input.count <= 0) {
    return false;
  }
  const insert = reviewInserters.get(panelId);
  const open = openers.get(panelId);
  if (insert?.session !== session && open?.session !== session) {
    clearReviewChipDraft(session);
    return false;
  }
  const normalized = {
    count: input.count,
    label: input.label,
    payloadText: payload,
  };
  return await new Promise<boolean>((resolve) => {
    clearPendingReview(panelId, false);
    const cancel = () => {
      if (pendingReviewInserts.get(panelId) === pending) {
        clearPendingReview(panelId, false);
      }
    };
    const pending: PendingReviewInsert = {
      input: normalized,
      resolve,
      session,
      stopListening: () => session.signal.removeEventListener("abort", cancel),
      timer:
        insert?.session === session
          ? undefined
          : window.setTimeout(cancel, PENDING_REVIEW_TIMEOUT_MS),
    };
    pendingReviewInserts.set(panelId, pending);
    session.signal.addEventListener("abort", cancel, { once: true });
    try {
      if (open?.session === session) {
        open.callback();
      }
      if (insert?.session === session) {
        flushReview(insert, pending);
      }
    } catch {
      cancel();
    }
  });
}

export function resetComposerBridgeForTests(): void {
  for (const panelId of pendingReviewInserts.keys()) {
    clearPendingReview(panelId, false);
  }
  for (const registry of [
    openers,
    plainInserters,
    reviewInserters,
    editHandlers,
  ]) {
    for (const registration of registry.values()) {
      registration.dispose();
    }
  }
}
