import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_DOWN_COMMAND,
  type LexicalNode,
  MOVE_TO_END,
  MOVE_TO_START,
} from "lexical";
import { useEffect } from "react";
import {
  $isComposerChipNode,
  $moveCaretAcrossComposerChip,
  $moveCaretByWordAcrossChips,
  $moveCaretToBlockEndAroundChips,
  $moveCaretToBlockStartAroundChips,
  $placeCaretAfterComposerChip,
  COMPOSER_CHIP_HOST_SELECTOR,
  isComposerLineEdgeKey,
  isComposerWordMoveArrow,
} from "./composer-chip-caret.ts";

const SNAP_TAG = "pier-composer-chip-snap";

/**
 * Keep the caret outside chip interiors, and let ←/→ step across a chip
 * as one atomic unit (isKeyboardSelectable is false on chip nodes).
 *
 * Also owns line-edge and word-jump shortcuts that Chromium cannot land
 * correctly past contenteditable=false decorators:
 * - Cmd/Ctrl+←/→ → MOVE_TO_START / MOVE_TO_END (current soft line only)
 * - Option/Alt+←/→ → word move when the block has chips (chip-local)
 * - Home / End → same block-edge recovery as MOVE_TO_*
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
        // Host class is shared by @ / skill / attachment / review chips.
        if (!target.closest(COMPOSER_CHIP_HOST_SELECTOR)) {
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

    // Cmd/Ctrl+←/→ — not KEY_ARROW_*; Lexical routes them to MOVE_TO_*.
    const unregisterMoveStart = editor.registerCommand(
      MOVE_TO_START,
      (event) => $moveCaretToBlockStartAroundChips(event),
      COMMAND_PRIORITY_HIGH
    );

    const unregisterMoveEnd = editor.registerCommand(
      MOVE_TO_END,
      (event) => $moveCaretToBlockEndAroundChips(event),
      COMMAND_PRIORITY_HIGH
    );

    // Option+←/→ and Home/End never become KEY_ARROW_* / MOVE_TO_* —
    // intercept on KEY_DOWN before Lexical's default $handleKeyDown.
    const unregisterKeyDown = editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event) => {
        const wordDir = isComposerWordMoveArrow(event);
        if (wordDir !== null) {
          return $moveCaretByWordAcrossChips(wordDir, event);
        }
        const lineEdge = isComposerLineEdgeKey(event);
        if (lineEdge === "start") {
          return $moveCaretToBlockStartAroundChips(event);
        }
        if (lineEdge === "end") {
          return $moveCaretToBlockEndAroundChips(event);
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH
    );

    return () => {
      unregisterUpdate();
      unregisterClick();
      unregisterLeft();
      unregisterRight();
      unregisterMoveStart();
      unregisterMoveEnd();
      unregisterKeyDown();
    };
  }, [editor]);

  return null;
}
