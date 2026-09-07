import { useCallback, useEffect, useSyncExternalStore } from "react";
import { writeTerminalDraftText } from "@/stores/terminal-drafts.store.ts";
import {
  clearReviewChipDraft,
  readComposerDraft,
  readReviewChipDraft,
  subscribeComposerSession,
  type TerminalComposerSession,
  writeComposerDraft,
} from "../composer/session.ts";

/** The terminal owns the draft; mounts observe it instead of keeping stale copies. */
export function useComposerDraft(
  session: TerminalComposerSession
): readonly [string, (value: string) => void] {
  const subscribe = useCallback(
    (listener: () => void) => subscribeComposerSession(session, listener),
    [session]
  );
  const getSnapshot = useCallback(() => readComposerDraft(session), [session]);
  const value = useSyncExternalStore(subscribe, getSnapshot);
  const setValue = useCallback(
    (next: string) => {
      writeComposerDraft(session, next);
      writeTerminalDraftText(session.panelId, next);
    },
    [session]
  );
  useEffect(() => {
    // Chip meta is a side-channel for remount; drop it when the payload leaves
    // the draft (user deleted the chip or edited away the expanded text).
    const chip = readReviewChipDraft(session);
    if (chip && !value.includes(chip.payloadText.trim())) {
      clearReviewChipDraft(session);
    }
  }, [session, value]);
  return [value, setValue];
}
