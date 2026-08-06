import { type RefObject, useEffect } from "react";
import { mergeComposerText } from "@/lib/comments/processable.ts";
import {
  isReviewInsertFlushPending,
  registerComposerInserter,
  registerComposerReviewInserter,
} from "../composer-bridge.ts";
import {
  type ComposerReviewChipDraft,
  readReviewChipDraft,
} from "../composer-helpers.ts";
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
  stripPlainPayload: boolean
): Promise<boolean> {
  return new Promise((resolve) => {
    const attempt = (left: number): void => {
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
          resolve(false);
          return;
        }
        valueRef.current = next;
        onValueChange(next);
        queueMicrotask(() => {
          editorRef.current?.focus();
        });
        resolve(true);
        return;
      }
      if (left <= 0) {
        resolve(false);
        return;
      }
      requestAnimationFrame(() => {
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
  valueRef: RefObject<string>;
}): void {
  const { editorRef, onValueChange, panelId, valueRef } = input;

  useEffect(() => {
    const unregisterPlain = registerComposerInserter(panelId, (text) => {
      const handle = editorRef.current;
      const current = handle?.getValue() ?? valueRef.current;
      const next = mergeComposerText(current, text);
      valueRef.current = next;
      onValueChange(next);
      queueMicrotask(() => {
        const editor = editorRef.current;
        if (!editor) {
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
      panelId,
      (chip: ReviewCommentsChipInsert) =>
        insertReviewChipWhenReady(
          editorRef,
          chip,
          onValueChange,
          valueRef,
          HANDLE_RETRY_FRAMES,
          false
        )
    );

    // Remount rehydrate only when plain draft holds an expanded payload and no
    // live pending flush is about to insert the same (or newer) chip.
    const chipDraft: ComposerReviewChipDraft | null =
      readReviewChipDraft(panelId);
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
        true
      ).catch(() => undefined);
    }

    return () => {
      unregisterPlain();
      unregisterReview();
    };
  }, [editorRef, onValueChange, panelId, valueRef]);
}
