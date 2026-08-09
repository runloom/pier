import { $moveCaretSelection } from "@lexical/selection";
import {
  $findMatchingParent,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
  type RangeSelection,
} from "lexical";
import { $isAttachmentTokenNode } from "./attachment-token-node.tsx";
import { COMPOSER_CHIP_HOST_CLASS } from "./composer-chip-styles.ts";
import { $isReviewCommentsChipNode } from "./review-comments-chip-node.tsx";
import { $isSkillMentionNode } from "./skill-mention-node.tsx";
import { $isWorkspacePathMentionNode } from "./workspace-path-mention-node.tsx";

/** CSS host class shared by every composer chip (click / hit-test). */
export const COMPOSER_CHIP_HOST_SELECTOR = `.${COMPOSER_CHIP_HOST_CLASS}`;

export function $isComposerChipNode(
  node: LexicalNode | null | undefined
): node is LexicalNode {
  return (
    $isWorkspacePathMentionNode(node) ||
    $isAttachmentTokenNode(node) ||
    $isSkillMentionNode(node) ||
    $isReviewCommentsChipNode(node)
  );
}

interface SelectionPoint {
  key: string;
  offset: number;
  type: "text" | "element";
}

function $pointAfterComposerChip(chip: LexicalNode): SelectionPoint | null {
  const next = chip.getNextSibling();
  if ($isTextNode(next)) {
    return { key: next.getKey(), offset: 0, type: "text" };
  }
  const parent = chip.getParent();
  if ($isElementNode(parent)) {
    return {
      key: parent.getKey(),
      offset: chip.getIndexWithinParent() + 1,
      type: "element",
    };
  }
  return null;
}

function $pointBeforeComposerChip(chip: LexicalNode): SelectionPoint | null {
  const prev = chip.getPreviousSibling();
  if ($isTextNode(prev)) {
    return {
      key: prev.getKey(),
      offset: prev.getTextContentSize(),
      type: "text",
    };
  }
  const parent = chip.getParent();
  if ($isElementNode(parent)) {
    return {
      key: parent.getKey(),
      offset: chip.getIndexWithinParent(),
      type: "element",
    };
  }
  return null;
}

/**
 * Move focus (and optionally anchor) to just before/after a chip.
 * `extend` keeps the existing anchor so Shift selections grow across the chip.
 */
export function $setSelectionEdgeAroundComposerChip(
  chip: LexicalNode,
  side: "before" | "after",
  mode: "collapse" | "extend"
): boolean {
  const point =
    side === "after"
      ? $pointAfterComposerChip(chip)
      : $pointBeforeComposerChip(chip);
  if (point === null) {
    return false;
  }
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return false;
  }
  selection.focus.set(point.key, point.offset, point.type);
  if (mode === "collapse") {
    selection.anchor.set(point.key, point.offset, point.type);
  }
  return true;
}

/**
 * Park the caret after a chip without inserting empty TextNodes.
 * Lexical drops "" text nodes, which re-triggered atomic snap loops.
 * Prefer an existing text sibling; else an element point after the chip
 * (works between adjacent chips).
 */
export function $placeCaretAfterComposerChip(chip: LexicalNode): void {
  if ($setSelectionEdgeAroundComposerChip(chip, "after", "collapse")) {
    return;
  }
  chip.selectNext(0, 0);
}

/** Park the caret immediately before a chip (mirror of after). */
export function $placeCaretBeforeComposerChip(chip: LexicalNode): void {
  if ($setSelectionEdgeAroundComposerChip(chip, "before", "collapse")) {
    return;
  }
  chip.selectPrevious(0, 0);
}

/** Adjacent chip in the move direction for a collapsed (or focus) edge. */
function $findAdjacentComposerChip(
  direction: "left" | "right"
): LexicalNode | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return null;
  }
  // Use focus for extend selections; anchor === focus when collapsed.
  const { focus } = selection;
  const node = focus.getNode();

  if (direction === "right") {
    if ($isTextNode(node) && focus.offset === node.getTextContentSize()) {
      const next = node.getNextSibling();
      return $isComposerChipNode(next) ? next : null;
    }
    if ($isElementNode(node)) {
      const child = node.getChildAtIndex(focus.offset);
      return $isComposerChipNode(child) ? child : null;
    }
    if ($isComposerChipNode(node)) {
      return node;
    }
    return null;
  }

  if ($isTextNode(node) && focus.offset === 0) {
    const prev = node.getPreviousSibling();
    return $isComposerChipNode(prev) ? prev : null;
  }
  if ($isElementNode(node) && focus.offset > 0) {
    const child = node.getChildAtIndex(focus.offset - 1);
    return $isComposerChipNode(child) ? child : null;
  }
  if ($isComposerChipNode(node)) {
    return node;
  }
  return null;
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
  const chip = $findAdjacentComposerChip(direction);
  if (chip === null) {
    return false;
  }
  return $setSelectionEdgeAroundComposerChip(
    chip,
    direction === "right" ? "after" : "before",
    "collapse"
  );
}

/**
 * Move or extend the selection across one adjacent chip.
 * When `extend` is true, only focus moves (Shift+Option word / Shift+arrow).
 */
export function $moveOrExtendAcrossComposerChip(
  direction: "left" | "right",
  extend: boolean
): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return false;
  }
  if (!(extend || selection.isCollapsed())) {
    return false;
  }
  const chip = $findAdjacentComposerChip(direction);
  if (chip === null) {
    return false;
  }
  return $setSelectionEdgeAroundComposerChip(
    chip,
    direction === "right" ? "after" : "before",
    extend ? "extend" : "collapse"
  );
}

function $nearestNonInlineBlock(node: LexicalNode): ElementNode | null {
  const block = $findMatchingParent(
    node,
    (candidate) => $isElementNode(candidate) && !candidate.isInline()
  );
  return $isElementNode(block) ? block : null;
}

function $isInlineDecoratorBoundary(
  node: LexicalNode | null | undefined
): boolean {
  return $isDecoratorNode(node) && node.isInline();
}

function $blockHasComposerChip(block: ElementNode): boolean {
  for (const child of block.getChildren()) {
    if ($isComposerChipNode(child)) {
      return true;
    }
  }
  return false;
}

/**
 * True when a LineBreak sits between `fromNode` and the start/end of `block`.
 * Used so Cmd/Home/End only coerce past chips on the *current* soft line,
 * not the whole paragraph when Shift+Enter produced multiple lines.
 */
function $hasLineBreakTowardBlockEdge(
  block: ElementNode,
  fromNode: LexicalNode,
  toward: "start" | "end"
): boolean {
  let child: LexicalNode | null = fromNode;
  while (child !== null && child.getParent() !== block) {
    child = child.getParent();
  }
  if (child === null) {
    return false;
  }
  const idx = child.getIndexWithinParent();
  const children = block.getChildren();
  if (toward === "start") {
    for (let i = 0; i < idx; i++) {
      if ($isLineBreakNode(children[i])) {
        return true;
      }
    }
    return false;
  }
  for (let i = idx + 1; i < children.length; i++) {
    if ($isLineBreakNode(children[i])) {
      return true;
    }
  }
  return false;
}

function $consumeKeyEvent(event?: KeyboardEvent | null): void {
  event?.preventDefault();
}

/**
 * Cmd/Ctrl+← (MOVE_TO_START) when the *current line* starts with an inline
 * decorator chip. Chromium cannot park the caret before contenteditable=false
 * decorators. Skips multi-line paragraphs when a LineBreak lies between the
 * focus and the block start (native lineboundary can handle later lines).
 *
 * Must run inside the command's `updateEditorSync` (no nested `editor.update`).
 */
export function $moveCaretToBlockStartAroundChips(
  event?: KeyboardEvent | null
): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return false;
  }
  const { anchor, focus } = selection;
  const focusBlock = $nearestNonInlineBlock(focus.getNode());
  if (focusBlock === null) {
    return false;
  }
  if (!$isInlineDecoratorBoundary(focusBlock.getFirstChild())) {
    return false;
  }
  if ($nearestNonInlineBlock(anchor.getNode()) !== focusBlock) {
    return false;
  }
  if ($hasLineBreakTowardBlockEdge(focusBlock, focus.getNode(), "start")) {
    return false;
  }
  const blockKey = focusBlock.getKey();
  if (
    focus.type === "element" &&
    focus.key === blockKey &&
    focus.offset === 0
  ) {
    return false;
  }
  selection.focus.set(blockKey, 0, "element");
  if (!event?.shiftKey) {
    selection.anchor.set(blockKey, 0, "element");
  }
  $consumeKeyEvent(event);
  return true;
}

/**
 * Cmd/Ctrl+→ (MOVE_TO_END) around trailing / leading inline decorator chips.
 *
 * 1. Caret stuck at element offset 0 before a leading chip → `selectEnd`
 *    (rich-text recovery path).
 * 2. Current line ends with an inline chip (no LineBreak toward block end).
 *
 * Must run inside the command's `updateEditorSync`.
 */
export function $moveCaretToBlockEndAroundChips(
  event?: KeyboardEvent | null
): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return false;
  }
  const { anchor, focus } = selection;

  // Recovery: Chromium stuck at element offset 0 before a leading decorator.
  if (anchor.type === "element" && anchor.offset === 0) {
    const element = anchor.getNode();
    if (
      $isElementNode(element) &&
      $isInlineDecoratorBoundary(element.getFirstChild())
    ) {
      const elementKey = element.getKey();
      const ending = element.selectEnd();
      if (event?.shiftKey) {
        ending.anchor.set(elementKey, 0, "element");
      }
      $consumeKeyEvent(event);
      return true;
    }
  }

  const focusBlock = $nearestNonInlineBlock(focus.getNode());
  if (focusBlock === null) {
    return false;
  }
  if (!$isInlineDecoratorBoundary(focusBlock.getLastChild())) {
    return false;
  }
  if ($nearestNonInlineBlock(anchor.getNode()) !== focusBlock) {
    return false;
  }
  if ($hasLineBreakTowardBlockEdge(focusBlock, focus.getNode(), "end")) {
    return false;
  }
  const blockKey = focusBlock.getKey();
  const endOffset = focusBlock.getChildrenSize();
  if (
    focus.type === "element" &&
    focus.key === blockKey &&
    focus.offset === endOffset
  ) {
    return false;
  }
  selection.focus.set(blockKey, endOffset, "element");
  if (!event?.shiftKey) {
    selection.anchor.set(blockKey, endOffset, "element");
  }
  $consumeKeyEvent(event);
  return true;
}

function $selectionPointSnapshot(selection: RangeSelection): string {
  return `${selection.anchor.key}:${selection.anchor.offset}|${selection.focus.key}:${selection.focus.offset}`;
}

/**
 * Option/Alt+←/→ word move when the current block contains chips.
 * Lexical does not route Option+Arrow into KEY_ARROW_* (altKey fails
 * isMoveBackward/Forward). Chip-local: no chips in block → return false so
 * native word navigation runs. With chips: boundary chip is one word (extend
 * preserves anchor); otherwise Lexical word-modify + chip landing fixups.
 *
 * Must run inside the command's `updateEditorSync`.
 */
export function $moveCaretByWordAcrossChips(
  direction: "left" | "right",
  event?: KeyboardEvent | null
): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return false;
  }

  const isBackward = direction === "left";
  const isHoldingShift = event?.shiftKey ?? false;
  const focusBlock = $nearestNonInlineBlock(selection.focus.getNode());
  if (focusBlock === null || !$blockHasComposerChip(focusBlock)) {
    return false;
  }

  // Boundary chip as one word unit (extend keeps anchor for Shift+Option).
  if ($moveOrExtendAcrossComposerChip(direction, isHoldingShift)) {
    $consumeKeyEvent(event);
    return true;
  }

  const before = $selectionPointSnapshot(selection);
  $moveCaretSelection(selection, isHoldingShift, isBackward, "word");

  // Word modify can land focus on the decorator node itself — park outside
  // without collapsing when Shift is held.
  const focusNode = selection.focus.getNode();
  if ($isComposerChipNode(focusNode)) {
    $setSelectionEdgeAroundComposerChip(
      focusNode,
      isBackward ? "before" : "after",
      isHoldingShift ? "extend" : "collapse"
    );
    $consumeKeyEvent(event);
    return true;
  }

  // Chromium stuck at the chip edge: word step moved nothing — jump the chip.
  if ($selectionPointSnapshot(selection) === before) {
    if ($moveOrExtendAcrossComposerChip(direction, isHoldingShift)) {
      $consumeKeyEvent(event);
      return true;
    }
    return false;
  }

  // Word step moved within a chip-containing block — consume so native does
  // not double-step after our modify.
  $consumeKeyEvent(event);
  return true;
}

/** True for macOS Option / Windows Alt + Left/Right (word jump), no Cmd/Ctrl. */
export function isComposerWordMoveArrow(
  event: KeyboardEvent
): "left" | "right" | null {
  if (event.metaKey || event.ctrlKey || !event.altKey) {
    return null;
  }
  if (event.key === "ArrowLeft") {
    return "left";
  }
  if (event.key === "ArrowRight") {
    return "right";
  }
  return null;
}

/** Home / End (optional Shift) without Cmd/Ctrl/Alt. */
export function isComposerLineEdgeKey(
  event: KeyboardEvent
): "start" | "end" | null {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return null;
  }
  if (event.key === "Home") {
    return "start";
  }
  if (event.key === "End") {
    return "end";
  }
  return null;
}
