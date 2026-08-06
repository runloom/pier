import { mergeComposerText } from "@/lib/comments/processable.ts";
import {
  clearReviewChipDraft,
  readComposerDraft,
  writeComposerDraft,
  writeReviewChipDraft,
} from "./composer-helpers.ts";
import type { ReviewCommentsChipInsert } from "./structured-composer/mutations.ts";

type ComposerOpener = () => void;
type ComposerPlainInserter = (text: string) => void;
type ComposerReviewInserter = (
  input: ReviewCommentsChipInsert
) => boolean | Promise<boolean>;

interface PendingReviewInsert {
  readonly input: ReviewCommentsChipInsert;
  readonly resolve: (ok: boolean) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly token: number;
}

const openers = new Map<string, ComposerOpener>();
const plainInserters = new Map<string, ComposerPlainInserter>();
const reviewInserters = new Map<string, ComposerReviewInserter>();
/** When Rich Input is closed, hold chip insert until the editor mounts. */
const pendingReviewInserts = new Map<string, PendingReviewInsert>();
/** Flush scheduled after register — blocks remount rehydrate from racing. */
const reviewFlushPending = new Set<string>();

const PENDING_REVIEW_TIMEOUT_MS = 8000;
let pendingReviewTokenSeq = 1;

function clearPendingReview(panelId: string, ok: boolean): void {
  const pending = pendingReviewInserts.get(panelId);
  if (!pending) {
    return;
  }
  pendingReviewInserts.delete(panelId);
  clearTimeout(pending.timer);
  pending.resolve(ok);
}

/** True while a closed-composer chip insert is queued or flushing into the editor. */
export function isReviewInsertFlushPending(panelId: string): boolean {
  return pendingReviewInserts.has(panelId) || reviewFlushPending.has(panelId);
}

/** Agent composer mount: ensure-open (not toggle). */
export function registerComposerOpener(
  panelId: string,
  open: ComposerOpener
): () => void {
  openers.set(panelId, open);
  return () => {
    if (openers.get(panelId) === open) {
      openers.delete(panelId);
    }
  };
}

/** Live editor plain-text insert while Rich Input is mounted. */
export function registerComposerInserter(
  panelId: string,
  insert: ComposerPlainInserter
): () => void {
  plainInserters.set(panelId, insert);
  return () => {
    if (plainInserters.get(panelId) === insert) {
      plainInserters.delete(panelId);
    }
  };
}

/** Live editor review-comments chip insert while Rich Input is mounted. */
export function registerComposerReviewInserter(
  panelId: string,
  insert: ComposerReviewInserter
): () => void {
  reviewInserters.set(panelId, insert);
  const pending = pendingReviewInserts.get(panelId);
  if (pending) {
    pendingReviewInserts.delete(panelId);
    clearTimeout(pending.timer);
    reviewFlushPending.add(panelId);
    // Defer so StructuredComposerEditorHandle is attached to the parent ref.
    queueMicrotask(() => {
      const live = reviewInserters.get(panelId);
      if (!live) {
        reviewFlushPending.delete(panelId);
        pending.resolve(false);
        return;
      }
      Promise.resolve(live(pending.input))
        .then((ok) => {
          pending.resolve(ok);
        })
        .catch(() => {
          pending.resolve(false);
        })
        .finally(() => {
          reviewFlushPending.delete(panelId);
        });
    });
  }
  return () => {
    if (reviewInserters.get(panelId) === insert) {
      reviewInserters.delete(panelId);
    }
  };
}

/**
 * Insert text into the agent composer for a terminal panel.
 * Open composer when closed (draft merge); append when already open.
 */
export function insertTextIntoTerminalComposer(
  panelId: string,
  text: string
): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return false;
  }
  const insert = plainInserters.get(panelId);
  if (insert) {
    insert(trimmed);
    openers.get(panelId)?.();
    return true;
  }
  const next = mergeComposerText(readComposerDraft(panelId), trimmed);
  writeComposerDraft(panelId, next);
  const open = openers.get(panelId);
  if (!open) {
    return false;
  }
  open();
  return true;
}

/**
 * Insert a review-comments bundle chip and resolve only after materialize ack.
 * Closed composer: queue + open (no plain-draft expand). Timeout → false.
 */
export async function insertReviewCommentsIntoTerminalComposer(
  panelId: string,
  input: ReviewCommentsChipInsert
): Promise<boolean> {
  const payload = input.payloadText.trim();
  if (payload.length === 0 || input.count <= 0) {
    return false;
  }
  const normalized: ReviewCommentsChipInsert = {
    count: input.count,
    label: input.label,
    payloadText: payload,
  };
  const insert = reviewInserters.get(panelId);
  if (insert) {
    clearPendingReview(panelId, false);
    openers.get(panelId)?.();
    try {
      const ok = await Promise.resolve(insert(normalized));
      if (ok) {
        writeReviewChipDraft(panelId, normalized);
      }
      return ok;
    } catch {
      return false;
    }
  }
  const open = openers.get(panelId);
  if (!open) {
    clearReviewChipDraft(panelId);
    return false;
  }
  return await new Promise<boolean>((resolve) => {
    clearPendingReview(panelId, false);
    const token = pendingReviewTokenSeq;
    pendingReviewTokenSeq += 1;
    const timer = setTimeout(() => {
      const current = pendingReviewInserts.get(panelId);
      if (current?.token !== token) {
        return;
      }
      pendingReviewInserts.delete(panelId);
      resolve(false);
    }, PENDING_REVIEW_TIMEOUT_MS);
    pendingReviewInserts.set(panelId, {
      input: normalized,
      resolve: (ok) => {
        clearTimeout(timer);
        if (ok) {
          writeReviewChipDraft(panelId, normalized);
        }
        resolve(ok);
      },
      timer,
      token,
    });
    open();
  });
}

export function resetComposerBridgeForTests(): void {
  for (const panelId of [...pendingReviewInserts.keys()]) {
    clearPendingReview(panelId, false);
  }
  openers.clear();
  plainInserters.clear();
  reviewInserters.clear();
  reviewFlushPending.clear();
  pendingReviewTokenSeq = 1;
}
