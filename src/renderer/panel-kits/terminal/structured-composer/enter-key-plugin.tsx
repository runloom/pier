import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createLineBreakNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
} from "lexical";
import { useEffect } from "react";

/**
 * Enter → send (parent). Shift/Mod/Alt+Enter → linebreak.
 * Skips when mention menu is open (handled at CRITICAL by MentionPlugin).
 */
export function EnterKeyPlugin({
  menuOpenRef,
  onSend,
}: {
  menuOpenRef: { current: boolean };
  onSend: () => void;
}): null {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        (event: KeyboardEvent | null) => {
          if (menuOpenRef.current) {
            return false;
          }
          if (event?.isComposing) {
            return false;
          }
          if (
            event &&
            (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey)
          ) {
            event.preventDefault();
            editor.update(() => {
              const selection = $getSelection();
              if (!$isRangeSelection(selection)) {
                return;
              }
              selection.insertNodes([$createLineBreakNode()]);
            });
            return true;
          }
          event?.preventDefault();
          onSend();
          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
    [editor, menuOpenRef, onSend]
  );

  return null;
}
