import type { RefObject } from "react";
import { useEffect, useState } from "react";
import {
  readComposerEditorSnapshot,
  writeComposerEditorSnapshot,
} from "../composer-helpers.ts";
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
  panelId: string;
  value: string;
}): string | null {
  const { editorRef, panelId, value } = input;
  const [initialSnapshotJson] = useState(() =>
    readComposerEditorSnapshot(panelId)
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` re-runs capture after each commit
  useEffect(() => {
    const json = editorRef.current?.getEditorJson();
    if (json != null) {
      writeComposerEditorSnapshot(panelId, json);
    }
  }, [editorRef, panelId, value]);
  return initialSnapshotJson;
}
