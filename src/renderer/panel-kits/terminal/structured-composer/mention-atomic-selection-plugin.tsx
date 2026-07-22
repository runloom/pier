import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  type LexicalNode,
} from "lexical";
import { useEffect } from "react";
import {
  $isComposerChipNode,
  $moveCaretAcrossComposerChip,
  $placeCaretAfterComposerChip,
} from "./composer-chip-caret.ts";

const SNAP_TAG = "pier-composer-chip-snap";

/**
 * Keep the caret outside chip interiors, and let ←/→ step across a chip
 * as one atomic unit (isKeyboardSelectable is false on chip nodes).
 */
export function MentionAtomicSelectionPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const unregisterUpdate = editor.registerUpdateListener(
      ({ editorState, tags }) => {
        if (tags.has(SNAP_TAG)) {
          return;
        }
        let chip: LexicalNode | null = null;
        editorState.read(() => {
          const selection = $getSelection();
          if (!($isRangeSelection(selection) && selection.isCollapsed())) {
            return;
          }
          const node = selection.anchor.getNode();
          if ($isComposerChipNode(node)) {
            chip = node;
          }
        });
        if (!chip) {
          return;
        }
        editor.update(
          () => {
            if (chip) {
              $placeCaretAfterComposerChip(chip);
            }
          },
          { discrete: true, tag: SNAP_TAG }
        );
      }
    );

    const unregisterClick = editor.registerCommand(
      CLICK_COMMAND,
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return false;
        }
        if (
          !(
            target.closest("[data-mention-path]") ||
            target.closest("[data-attachment-path]")
          )
        ) {
          return false;
        }
        event.preventDefault();
        // Command runs inside updateEditorSync — mutate selection directly.
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          const node = selection.anchor.getNode();
          if ($isComposerChipNode(node)) {
            $placeCaretAfterComposerChip(node);
            return true;
          }
        }
        const current = $getSelection();
        if ($isRangeSelection(current)) {
          const node = current.anchor.getNode();
          const prev = node.getPreviousSibling?.();
          const next = node.getNextSibling?.();
          if (prev && $isComposerChipNode(prev)) {
            $placeCaretAfterComposerChip(prev);
          } else if (next && $isComposerChipNode(next)) {
            $placeCaretAfterComposerChip(next);
          } else if ($isComposerChipNode(node)) {
            $placeCaretAfterComposerChip(node);
          }
        }
        return true;
      },
      COMMAND_PRIORITY_HIGH
    );

    const unregisterLeft = editor.registerCommand(
      KEY_ARROW_LEFT_COMMAND,
      (event) => {
        if (event?.shiftKey) {
          return false;
        }
        // Already in updateEditorSync — nested editor.update would queue the
        // move, return false, and let plain-text $moveCharacter also run.
        const handled = $moveCaretAcrossComposerChip("left");
        if (handled) {
          event?.preventDefault();
        }
        return handled;
      },
      COMMAND_PRIORITY_HIGH
    );

    const unregisterRight = editor.registerCommand(
      KEY_ARROW_RIGHT_COMMAND,
      (event) => {
        if (event?.shiftKey) {
          return false;
        }
        const handled = $moveCaretAcrossComposerChip("right");
        if (handled) {
          event?.preventDefault();
        }
        return handled;
      },
      COMMAND_PRIORITY_HIGH
    );

    return () => {
      unregisterUpdate();
      unregisterClick();
      unregisterLeft();
      unregisterRight();
    };
  }, [editor]);

  return null;
}
