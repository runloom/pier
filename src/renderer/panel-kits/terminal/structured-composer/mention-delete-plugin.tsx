import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type LexicalNode,
} from "lexical";
import { useEffect } from "react";
import {
  $isAttachmentTokenNode,
  type AttachmentTokenNode,
} from "./attachment-token-node.tsx";
import {
  $isWorkspacePathMentionNode,
  type WorkspacePathMentionNode,
} from "./workspace-path-mention-node.tsx";

type ComposerChipNode = AttachmentTokenNode | WorkspacePathMentionNode;

/**
 * Delete an adjacent @ / attachment chip as one atomic unit on Backspace/Delete.
 */
export function MentionDeletePlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const unregisterBackspace = editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event) => {
        // Already inside Lexical's updateEditorSync — do not nest editor.update
        // or `handled` stays false and plain-text DELETE_CHARACTER also runs.
        const handled = $deleteAdjacentComposerChip("backward");
        if (handled) {
          event?.preventDefault();
        }
        return handled;
      },
      COMMAND_PRIORITY_HIGH
    );
    const unregisterDelete = editor.registerCommand(
      KEY_DELETE_COMMAND,
      (event) => {
        const handled = $deleteAdjacentComposerChip("forward");
        if (handled) {
          event?.preventDefault();
        }
        return handled;
      },
      COMMAND_PRIORITY_HIGH
    );
    return () => {
      unregisterBackspace();
      unregisterDelete();
    };
  }, [editor]);

  return null;
}

/** Must run inside `editor.update` / `editorState.read`. */
export function $deleteAdjacentMention(
  direction: "backward" | "forward"
): boolean {
  return $deleteAdjacentComposerChip(direction);
}

export function $deleteAdjacentComposerChip(
  direction: "backward" | "forward"
): boolean {
  const chip = $findAdjacentComposerChip(direction);
  if (!chip) {
    return false;
  }
  chip.remove();
  return true;
}

function $isComposerChipNode(
  node: LexicalNode | null | undefined
): node is ComposerChipNode {
  return $isWorkspacePathMentionNode(node) || $isAttachmentTokenNode(node);
}

function $findAdjacentComposerChip(
  direction: "backward" | "forward"
): ComposerChipNode | null {
  const selection = $getSelection();
  if (!($isRangeSelection(selection) && selection.isCollapsed())) {
    return null;
  }
  const anchor = selection.anchor;
  const node = anchor.getNode();

  if ($isComposerChipNode(node)) {
    return node;
  }

  if ($isTextNode(node)) {
    if (direction === "backward" && anchor.offset === 0) {
      const prev = node.getPreviousSibling();
      return $isComposerChipNode(prev) ? prev : null;
    }
    if (
      direction === "forward" &&
      anchor.offset === node.getTextContentSize()
    ) {
      const next = node.getNextSibling();
      return $isComposerChipNode(next) ? next : null;
    }
    return null;
  }

  // Element caret between nodes (e.g. adjacent chips with no text sibling).
  if ($isElementNode(node)) {
    if (direction === "backward" && anchor.offset > 0) {
      const prev = node.getChildAtIndex(anchor.offset - 1);
      return $isComposerChipNode(prev) ? prev : null;
    }
    if (direction === "forward") {
      const next = node.getChildAtIndex(anchor.offset);
      return $isComposerChipNode(next) ? next : null;
    }
  }

  if (direction === "backward") {
    const prev = node.getPreviousSibling();
    return $isComposerChipNode(prev) ? prev : null;
  }
  const next = node.getNextSibling();
  return $isComposerChipNode(next) ? next : null;
}
