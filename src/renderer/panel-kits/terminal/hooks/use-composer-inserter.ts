import { type RefObject, useEffect } from "react";
import { mergeComposerText } from "@/lib/comments/processable.ts";
import {
  type ComposerReviewChipDraft,
  readReviewChipDraft,
  type TerminalComposerSession,
} from "../composer/session.ts";
import {
  isReviewInsertFlushPending,
  registerComposerInserter,
  registerComposerReviewInserter,
} from "../composer-bridge.ts";
import type { StructuredComposerEditorHandle } from "../structured-composer/editor.tsx";
import type { ReviewCommentsChipInsert } from "../structured-composer/mutations.ts";

const HANDLE_RETRY_FRAMES = 12;

function stripTrailingPayload(text: string, payload: string): string {
  const trimmed = text.replace(/\s+$/u, "");
  const pay = payload.trim();
  if (trimmed === pay) {
    return "";
  }
  if (trimmed.endsWith(pay)) {
    return trimmed.slice(0, -pay.length).replace(/\s+$/u, "");
  }
  return text;
}

function insertReviewChipWhenReady(
  editorRef: RefObject<StructuredComposerEditorHandle | null>,
  chip: ReviewCommentsChipInsert,
  onValueChange: (value: string) => void,
  valueRef: RefObject<string>,
  framesLeft: number,
  stripPlainPayload: boolean,
  signal: AbortSignal
): Promise<boolean> {
  return new Promise((resolve) => {
    let frame = 0;
    const finish = (ok: boolean) => {
      cancelAnimationFrame(frame);
      signal.removeEventListener("abort", onAbort);
      resolve(ok);
    };
    const onAbort = () => finish(false);
    if (signal.aborted) {
      finish(false);
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    const attempt = (left: number): void => {
      if (signal.aborted) {
        finish(false);
        return;
      }
      const handle = editorRef.current;
      if (handle) {
        if (stripPlainPayload) {
          const current = handle.getValue();
          const cleaned = stripTrailingPayload(current, chip.payloadText);
          if (cleaned !== current) {
            handle.setValue(cleaned);
          }
        }
        handle.insertReviewCommentsChip(chip);
        const next = handle.getValue();
        // Ack only when agent payload is present in the serialized draft.
        if (!next.includes(chip.payloadText.trim())) {
          finish(false);
          return;
        }
        valueRef.current = next;
        onValueChange(next);
        queueMicrotask(() => {
          if (!signal.aborted && editorRef.current === handle) {
            handle.focus();
          }
        });
        finish(true);
        return;
      }
      if (left <= 0) {
        finish(false);
        return;
      }
      frame = requestAnimationFrame(() => {
        attempt(left - 1);
      });
    };
    attempt(framesLeft);
  });
}

/**
 * External insert path (plain text + review-comments chip → agent composer).
 * Merges into the live editor when mounted.
 */
export function useComposerInserter(input: {
  editorRef: RefObject<StructuredComposerEditorHandle | null>;
  onValueChange: (value: string) => void;
  panelId: string;
  session: TerminalComposerSession;
  valueRef: RefObject<string>;
}): void {
  const { editorRef, onValueChange, panelId, session, valueRef } = input;

  useEffect(() => {
    const mounted = new AbortController();
    const signal = AbortSignal.any([session.signal, mounted.signal]);
    const unregisterPlain = registerComposerInserter(session, (text) => {
      if (signal.aborted) {
        return;
      }
      const handle = editorRef.current;
      const current = handle?.getValue() ?? valueRef.current;
      const next = mergeComposerText(current, text);
      valueRef.current = next;
      onValueChange(next);
      queueMicrotask(() => {
        const editor = editorRef.current;
        if (!editor || signal.aborted) {
          return;
        }
        if (editor.getValue() !== next) {
          editor.setValue(next);
        }
        editor.setSelection(next.length);
        editor.focus();
      });
    });

    const unregisterReview = registerComposerReviewInserter(
      session,
      (chip: ReviewCommentsChipInsert) =>
        insertReviewChipWhenReady(
          editorRef,
          chip,
          onValueChange,
          valueRef,
          HANDLE_RETRY_FRAMES,
          false,
          signal
        )
    );

    // Remount rehydrate only when plain draft holds an expanded payload and no
    // live pending flush is about to insert the same (or newer) chip.
    const chipDraft: ComposerReviewChipDraft | null =
      readReviewChipDraft(session);
    const plain = valueRef.current;
    const shouldRehydrate =
      chipDraft !== null &&
      !isReviewInsertFlushPending(panelId) &&
      plain.includes(chipDraft.payloadText.trim());
    if (shouldRehydrate && chipDraft) {
      insertReviewChipWhenReady(
        editorRef,
        chipDraft,
        onValueChange,
        valueRef,
        HANDLE_RETRY_FRAMES,
        true,
        signal
      ).catch(() => undefined);
    }

    return () => {
      unregisterPlain();
      unregisterReview();
      mounted.abort();
    };
  }, [editorRef, onValueChange, panelId, session, valueRef]);
}
