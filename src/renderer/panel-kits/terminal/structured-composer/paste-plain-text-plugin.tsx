import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  $createLineBreakNode,
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  type LexicalNode,
  PASTE_COMMAND,
} from "lexical";
import { useEffect } from "react";
import { LARGE_PASTE_CHAR_THRESHOLD } from "./large-paste.ts";

function nodesFromPlainText(text: string): LexicalNode[] {
  const lines = text.split("\n");
  const nodes: LexicalNode[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.length > 0) {
      nodes.push($createTextNode(line));
    }
    if (i < lines.length - 1) {
      nodes.push($createLineBreakNode());
    }
  }
  return nodes;
}

function clipboardHasFilePayload(
  data: DataTransfer | null | undefined
): boolean {
  if (!data) {
    return false;
  }
  if (data.files.length > 0) {
    return true;
  }
  return Array.from(data.items).some((item) => item.kind === "file");
}

/**
 * Strip HTML formatting on paste; insert clipboard text only.
 * Large pastes are delegated to `onLargePlainPaste` (attachment materialize).
 * File/image payloads are left to React `handleComposerPaste` so we do not
 * double-insert plain text or race attachment chips.
 */
export function PastePlainTextPlugin({
  onLargePlainPaste,
}: {
  onLargePlainPaste: (text: string) => void;
}): null {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      mergeRegister(
        editor.registerCommand(
          PASTE_COMMAND,
          (event: ClipboardEvent) => {
            if (clipboardHasFilePayload(event.clipboardData)) {
              return false;
            }
            const text = event.clipboardData?.getData("text/plain");
            if (typeof text !== "string") {
              return false;
            }
            if (text.length >= LARGE_PASTE_CHAR_THRESHOLD) {
              event.preventDefault();
              onLargePlainPaste(text);
              return true;
            }
            event.preventDefault();
            const nodes = nodesFromPlainText(text);
            if (nodes.length === 0) {
              return true;
            }
            // Already inside updateEditorSync — insert directly.
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
              selection.insertNodes(nodes);
            }
            return true;
          },
          COMMAND_PRIORITY_HIGH
        )
      ),
    [editor, onLargePlainPaste]
  );

  return null;
}

export { clipboardHasFilePayload };
