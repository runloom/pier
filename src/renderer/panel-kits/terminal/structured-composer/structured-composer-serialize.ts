import type { LexicalEditor, LexicalNode } from "lexical";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
} from "lexical";
import { $isComposerChipNode } from "./composer-chip-caret.ts";

/**
 * Plain-text export for the structured composer.
 *
 * Chip nodes (@ path / skill invoke / attachment) contribute via
 * `getTextContent()` (abs path, `/id` or `$id`, abs path). On export we insert
 * a single ASCII space at chip boundaries when the neighboring projected
 * character is non-whitespace, so agent-facing payloads do not glue tokens
 * together. Visual chip gaps remain CSS-only; the editor does not gain
 * synthetic TextNodes.
 */

interface ProjectedLeaf {
  isChip: boolean;
  /** 0 or 1 — synthetic space emitted before this leaf's own text. */
  leadingSep: number;
  node: LexicalNode;
  text: string;
  /** Index in the projected string where this leaf's own text starts. */
  textStart: number;
}

function isWhitespaceChar(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function shouldInsertChipBoundarySpace(
  prevChar: string,
  prevIsChip: boolean,
  nextChar: string,
  nextIsChip: boolean
): boolean {
  if (isWhitespaceChar(prevChar) || isWhitespaceChar(nextChar)) {
    return false;
  }
  return prevIsChip || nextIsChip;
}

function isPlainLeaf(node: LexicalNode): boolean {
  return $isTextNode(node) || $isLineBreakNode(node) || $isDecoratorNode(node);
}

/** Document-order leaves that contribute to plain text. */
function collectPlainLeaves(root: LexicalNode): LexicalNode[] {
  const leaves: LexicalNode[] = [];
  const walk = (node: LexicalNode): void => {
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        walk(child);
      }
      return;
    }
    if (isPlainLeaf(node)) {
      leaves.push(node);
    }
  };
  walk(root);
  return leaves;
}

/**
 * Project editor leaves → agent-facing plain text (with chip boundary spaces).
 * Must run inside `editorState.read` / `editor.update`.
 */
function $projectComposerPlainLeaves(root: LexicalNode): {
  full: string;
  leaves: ProjectedLeaf[];
} {
  const raw = collectPlainLeaves(root);
  const leaves: ProjectedLeaf[] = [];
  let full = "";
  let lastChar: string | null = null;
  let lastIsChip = false;

  for (const node of raw) {
    const text = node.getTextContent();
    const isChip = $isComposerChipNode(node);
    let leadingSep = 0;

    if (text.length > 0 && lastChar !== null) {
      const nextChar = text[0] ?? "";
      if (
        shouldInsertChipBoundarySpace(lastChar, lastIsChip, nextChar, isChip)
      ) {
        leadingSep = 1;
        full += " ";
      }
    }

    const textStart = full.length;
    full += text;
    leaves.push({ isChip, leadingSep, node, text, textStart });

    if (text.length > 0) {
      lastChar = text.at(-1) ?? null;
      lastIsChip = isChip;
    }
  }

  return { full, leaves };
}

/** Plain text for the current editor state (chip paths + boundary spaces). */
export function $readComposerPlainText(): string {
  return $projectComposerPlainLeaves($getRoot()).full;
}

/** Read the full plain-text document (paragraphs joined by \\n). */
export function readLexicalPlainText(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => $readComposerPlainText());
}

/** Replace the whole document with plain text (\\n → LineBreak within one paragraph). */
export function writeLexicalPlainText(
  editor: LexicalEditor,
  text: string
): void {
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? "";
        if (line.length > 0) {
          paragraph.append($createTextNode(line));
        }
        if (i < lines.length - 1) {
          paragraph.append($createLineBreakNode());
        }
      }
      root.append(paragraph);
      root.selectEnd();
    },
    { discrete: true }
  );
}

/**
 * Map Lexical range selection → plain-text offsets (textarea-compatible).
 * Falls back to end-of-document when selection is missing.
 *
 * Offsets match `$readComposerPlainText` (including synthetic chip spaces).
 */
export function readLexicalPlainSelection(editor: LexicalEditor): {
  cursor: number;
  selectionEnd: number;
} {
  return editor.getEditorState().read(() => {
    const { full, leaves } = $projectComposerPlainLeaves($getRoot());
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      return { cursor: full.length, selectionEnd: full.length };
    }

    const anchorOffset = plainOffsetForPoint(full.length, () =>
      offsetForPoint(leaves, selection.anchor.key, selection.anchor.offset)
    );
    const focusOffset = plainOffsetForPoint(full.length, () =>
      offsetForPoint(leaves, selection.focus.key, selection.focus.offset)
    );

    const a = Math.min(anchorOffset, focusOffset);
    const b = Math.max(anchorOffset, focusOffset);
    return { cursor: a, selectionEnd: b };
  });
}

function plainOffsetForPoint(fallback: number, compute: () => number): number {
  try {
    return compute();
  } catch {
    return fallback;
  }
}

function findProjectedLeaf(
  leaves: readonly ProjectedLeaf[],
  node: LexicalNode
): ProjectedLeaf | null {
  const key = node.getKey();
  for (const leaf of leaves) {
    if (leaf.node.getKey() === key) {
      return leaf;
    }
  }
  return null;
}

/** Projected plain offset at the start of `node`'s contribution (before leading sep). */
function plainOffsetBeforeNode(
  leaves: readonly ProjectedLeaf[],
  node: LexicalNode
): number {
  const direct = findProjectedLeaf(leaves, node);
  if (direct) {
    return direct.textStart - direct.leadingSep;
  }
  // Element / non-leaf: first descendant leaf in document order.
  for (const leaf of leaves) {
    if (isNodeOrDescendant(node, leaf.node)) {
      return leaf.textStart - leaf.leadingSep;
    }
  }
  // No leaves under node — position after previous content in document order.
  let lastEnd = 0;
  for (const leaf of leaves) {
    if (nodeIsBeforeInDocOrder(leaf.node, node)) {
      lastEnd = leaf.textStart + leaf.text.length;
    }
  }
  return lastEnd;
}

/** Projected plain offset immediately after `node`'s full contribution. */
function plainOffsetAfterNode(
  leaves: readonly ProjectedLeaf[],
  node: LexicalNode
): number {
  const direct = findProjectedLeaf(leaves, node);
  if (direct) {
    return direct.textStart + direct.text.length;
  }
  let end = plainOffsetBeforeNode(leaves, node);
  let found = false;
  for (const leaf of leaves) {
    if (isNodeOrDescendant(node, leaf.node)) {
      end = leaf.textStart + leaf.text.length;
      found = true;
    } else if (found) {
      break;
    }
  }
  return end;
}

function isNodeOrDescendant(ancestor: LexicalNode, node: LexicalNode): boolean {
  let current: LexicalNode | null = node;
  while (current) {
    if (current.getKey() === ancestor.getKey()) {
      return true;
    }
    current = current.getParent();
  }
  return false;
}

/**
 * True when `a` ends strictly before `b` starts in document order
 * (sibling / ancestor-aware via key walk is expensive; use projected walk order).
 */
function nodeIsBeforeInDocOrder(a: LexicalNode, b: LexicalNode): boolean {
  // Walk from root collecting keys is heavy; compare via common parent indices.
  if (a.getKey() === b.getKey()) {
    return false;
  }
  const aPath = pathFromRoot(a);
  const bPath = pathFromRoot(b);
  const len = Math.min(aPath.length, bPath.length);
  for (let i = 0; i < len; i += 1) {
    if (aPath[i] !== bPath[i]) {
      return (aPath[i] ?? 0) < (bPath[i] ?? 0);
    }
  }
  // One is ancestor of the other: ancestor is "before" only if we need
  // "ends before" — ancestor start is before descendant, but ancestor
  // as a whole contains descendant. For "leaf before element" we use
  // path prefix: shorter path that is prefix means ancestor.
  return aPath.length < bPath.length;
}

function pathFromRoot(node: LexicalNode): number[] {
  const indices: number[] = [];
  let current: LexicalNode | null = node;
  while (current) {
    const parent: LexicalNode | null = current.getParent();
    if (!(parent && $isElementNode(parent))) {
      break;
    }
    indices.unshift(current.getIndexWithinParent());
    current = parent;
  }
  return indices;
}

function findNodeByKey(key: string): LexicalNode | null {
  const root = $getRoot();
  let found: LexicalNode | null = null;
  const walk = (node: LexicalNode): void => {
    if (found) {
      return;
    }
    if (node.getKey() === key) {
      found = node;
      return;
    }
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        walk(child);
        if (found) {
          return;
        }
      }
    }
  };
  walk(root);
  return found;
}

function offsetForPoint(
  leaves: readonly ProjectedLeaf[],
  nodeKey: string,
  offset: number
): number {
  const node = findNodeByKey(nodeKey);
  if (!node) {
    return offset;
  }
  if ($isElementNode(node)) {
    const children = node.getChildren();
    const limit = Math.min(Math.max(0, offset), children.length);
    if (limit === 0) {
      return plainOffsetBeforeNode(leaves, node);
    }
    const prevChild = children[limit - 1];
    if (!prevChild) {
      return plainOffsetBeforeNode(leaves, node);
    }
    return plainOffsetAfterNode(leaves, prevChild);
  }

  const leaf = findProjectedLeaf(leaves, node);
  if (!leaf) {
    return plainOffsetBeforeNode(leaves, node);
  }

  if ($isTextNode(node)) {
    return leaf.textStart + Math.min(Math.max(0, offset), leaf.text.length);
  }

  // Atomic leaf (linebreak / decorator): 0 → before the leaf in the editor.
  // That caret has no distinct slot for a synthetic export space, so map to
  // the offset *before* any leading sep (same as after the previous leaf).
  // >0 → after own text.
  if (offset <= 0) {
    return leaf.textStart - leaf.leadingSep;
  }
  return leaf.textStart + leaf.text.length;
}

/** Move caret to a plain-text offset after an external draft rewrite. */
export function setLexicalPlainSelection(
  editor: LexicalEditor,
  offset: number
): void {
  editor.update(
    () => {
      const root = $getRoot();
      const { full, leaves } = $projectComposerPlainLeaves(root);
      if (leaves.length === 0) {
        root.selectEnd();
        return;
      }
      let remaining = Math.max(0, Math.min(offset, full.length));
      for (const leaf of leaves) {
        if (leaf.leadingSep > 0) {
          if (remaining <= 0) {
            placeCaretBeforeLeaf(leaf.node);
            return;
          }
          // Land in synthetic space → caret before this leaf in the editor.
          if (remaining < leaf.leadingSep) {
            placeCaretBeforeLeaf(leaf.node);
            return;
          }
          remaining -= leaf.leadingSep;
        }

        const size = leaf.text.length;
        if ($isTextNode(leaf.node)) {
          if (remaining <= size) {
            leaf.node.select(remaining, remaining);
            return;
          }
          remaining -= size;
          continue;
        }

        // Atomic leaf (linebreak / chip): land before it, or skip past it.
        if (remaining === 0) {
          placeCaretBeforeLeaf(leaf.node);
          return;
        }
        if (remaining < size) {
          placeCaretAfterLeaf(leaf.node);
          return;
        }
        remaining -= size;
      }
      root.selectEnd();
    },
    { discrete: true }
  );
}

function placeCaretBeforeLeaf(node: LexicalNode): void {
  if ($isTextNode(node)) {
    node.select(0, 0);
    return;
  }
  const prev = node.getPreviousSibling();
  if ($isTextNode(prev)) {
    const size = prev.getTextContentSize();
    prev.select(size, size);
    return;
  }
  const parent = node.getParent();
  if ($isElementNode(parent)) {
    const index = node.getIndexWithinParent();
    parent.select(index, index);
    return;
  }
  node.selectPrevious();
}

function placeCaretAfterLeaf(node: LexicalNode): void {
  if ($isTextNode(node)) {
    const size = node.getTextContentSize();
    node.select(size, size);
    return;
  }
  const next = node.getNextSibling();
  if ($isTextNode(next)) {
    next.select(0, 0);
    return;
  }
  const parent = node.getParent();
  if ($isElementNode(parent)) {
    const index = node.getIndexWithinParent() + 1;
    parent.select(index, index);
    return;
  }
  node.selectNext();
}
