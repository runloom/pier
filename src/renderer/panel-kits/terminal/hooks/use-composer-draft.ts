import { useEffect } from "react";
import {
  clearReviewChipDraft,
  readReviewChipDraft,
  writeComposerDraft,
} from "../composer-helpers.ts";

/** Persist plain draft and drop stale review-chip side-channel meta. */
export function useComposerDraft(panelId: string, value: string): void {
  useEffect(() => {
    writeComposerDraft(panelId, value);
    // Chip meta is a side-channel for remount; drop it when the payload leaves
    // the draft (user deleted the chip or edited away the expanded text).
    const chip = readReviewChipDraft(panelId);
    if (chip && !value.includes(chip.payloadText.trim())) {
      clearReviewChipDraft(panelId);
    }
  }, [panelId, value]);
}
