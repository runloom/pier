import type { RefObject } from "react";
import { useEffect, useState } from "react";
import { writeTerminalDraftComposition } from "@/stores/terminal-drafts.store.ts";
import {
  readComposerEditorSnapshot,
  type TerminalComposerSession,
  writeComposerEditorSnapshot,
} from "../composer/session.ts";
import type { StructuredComposerEditorHandle } from "../structured-composer/editor.tsx";

/**
 * Per-panel editor-state snapshot lifecycle for on-demand open/close.
 *
 * The return value seeds mount-time chip restore with the snapshot captured
 * at last close; the capture effect keeps the snapshot in lockstep with the
 * plain draft so chips survive close/reopen regardless of which path
 * unmounts the card. Capture runs after commit — never inside the Lexical
 * update dispatch.
 */
export function useComposerEditorSnapshot(input: {
  editorRef: RefObject<StructuredComposerEditorHandle | null>;
  session: TerminalComposerSession;
  value: string;
}): string | null {
  const { editorRef, session, value } = input;
  const [initialSnapshotJson] = useState(() =>
    readComposerEditorSnapshot(session)
  );
  useEffect(() => {
    if (session.signal.aborted) {
      return;
    }
    const json = editorRef.current?.getEditorJson();
    if (json != null) {
      writeComposerEditorSnapshot(session, json);
      writeTerminalDraftComposition(session.panelId, {
        editorJson: json,
        editorText: value,
      });
    }
  }, [editorRef, session, value]);
  return initialSnapshotJson;
}
