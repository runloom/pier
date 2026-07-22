import {
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  type LexicalNode,
} from "lexical";
import { $isAttachmentTokenNode } from "./attachment-token-node.tsx";
import { $isWorkspacePathMentionNode } from "./workspace-path-mention-node.tsx";

export function $isComposerChipNode(
  node: LexicalNode | null | undefined
): node is LexicalNode {
  return $isWorkspacePathMentionNode(node) || $isAttachmentTokenNode(node);
}

/**
 * Park the caret after a chip without inserting empty TextNodes.
 * Lexical drops "" text nodes, which re-triggered atomic snap loops.
 * Prefer an existing text sibling; else an element point after the chip
 * (works between adjacent chips).
 */
export function $placeCaretAfterComposerChip(chip: LexicalNode): void {
  const next = chip.getNextSibling();
  if ($isTextNode(next)) {
    next.select(0, 0);
    return;
  }
  const parent = chip.getParent();
  if ($isElementNode(parent)) {
    const index = chip.getIndexWithinParent() + 1;
    parent.select(index, index);
    return;
  }
  chip.selectNext(0, 0);
}

/** Park the caret immediately before a chip (mirror of after). */
export function $placeCaretBeforeComposerChip(chip: LexicalNode): void {
  const prev = chip.getPreviousSibling();
  if ($isTextNode(prev)) {
    const size = prev.getTextContentSize();
    prev.select(size, size);
    return;
  }
  const parent = chip.getParent();
  if ($isElementNode(parent)) {
    const index = chip.getIndexWithinParent();
    parent.select(index, index);
    return;
  }
  chip.selectPrevious(0, 0);
}

/**
 * Collapse-move left/right across one chip as an atomic unit.
 * Must run inside `editor.update`.
 */
export function $moveCaretAcrossComposerChip(
  direction: "left" | "right"
): boolean {
  const selection = $getSelection();
  if (!($isRangeSelection(selection) && selection.isCollapsed())) {
    return false;
  }
  const { anchor } = selection;
  const node = anchor.getNode();

  if (direction === "right") {
    if ($isTextNode(node) && anchor.offset === node.getTextContentSize()) {
      const next = node.getNextSibling();
      if ($isComposerChipNode(next)) {
        $placeCaretAfterComposerChip(next);
        return true;
      }
    }
    if ($isElementNode(node)) {
      const child = node.getChildAtIndex(anchor.offset);
      if ($isComposerChipNode(child)) {
        $placeCaretAfterComposerChip(child);
        return true;
      }
    }
    if ($isComposerChipNode(node)) {
      $placeCaretAfterComposerChip(node);
      return true;
    }
    return false;
  }

  if ($isTextNode(node) && anchor.offset === 0) {
    const prev = node.getPreviousSibling();
    if ($isComposerChipNode(prev)) {
      $placeCaretBeforeComposerChip(prev);
      return true;
    }
  }
  if ($isElementNode(node) && anchor.offset > 0) {
    const child = node.getChildAtIndex(anchor.offset - 1);
    if ($isComposerChipNode(child)) {
      $placeCaretBeforeComposerChip(child);
      return true;
    }
  }
  if ($isComposerChipNode(node)) {
    $placeCaretBeforeComposerChip(node);
    return true;
  }
  return false;
}
