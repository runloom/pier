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

/** Read the full plain-text document (paragraphs joined by \\n). */
export function readLexicalPlainText(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => $getRoot().getTextContent());
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
 * Counts TextNode + LineBreakNode + DecoratorNode (mentions) in document order.
 */
export function readLexicalPlainSelection(editor: LexicalEditor): {
  cursor: number;
  selectionEnd: number;
} {
  return editor.getEditorState().read(() => {
    const root = $getRoot();
    const full = root.getTextContent();
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      return { cursor: full.length, selectionEnd: full.length };
    }

    const anchorOffset = plainOffsetForPoint(full.length, () =>
      offsetForPoint(selection.anchor.key, selection.anchor.offset)
    );
    const focusOffset = plainOffsetForPoint(full.length, () =>
      offsetForPoint(selection.focus.key, selection.focus.offset)
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

function isPlainLeaf(node: LexicalNode): boolean {
  return $isTextNode(node) || $isLineBreakNode(node) || $isDecoratorNode(node);
}

/** Document-order leaves that contribute to `getTextContent()`. */
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

/** Plain-text offset at the start of `target` (before its own content). */
function plainOffsetAtNodeStart(target: LexicalNode): number {
  const root = $getRoot();
  let total = 0;
  let found = false;
  const walk = (node: LexicalNode): void => {
    if (found) {
      return;
    }
    if (node.getKey() === target.getKey()) {
      found = true;
      return;
    }
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        walk(child);
        if (found) {
          return;
        }
      }
      return;
    }
    if (isPlainLeaf(node)) {
      total += node.getTextContentSize();
    }
  };
  walk(root);
  return total;
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

function offsetForPoint(nodeKey: string, offset: number): number {
  const node = findNodeByKey(nodeKey);
  if (!node) {
    return offset;
  }
  if ($isElementNode(node)) {
    // Selection on an element: `offset` is a child index.
    let total = plainOffsetAtNodeStart(node);
    const children = node.getChildren();
    const limit = Math.min(Math.max(0, offset), children.length);
    for (let i = 0; i < limit; i += 1) {
      total += children[i]?.getTextContentSize() ?? 0;
    }
    return total;
  }
  if ($isTextNode(node)) {
    return (
      plainOffsetAtNodeStart(node) +
      Math.min(Math.max(0, offset), node.getTextContentSize())
    );
  }
  // Atomic leaf (linebreak / decorator): 0 → before, >0 → after.
  const start = plainOffsetAtNodeStart(node);
  if (offset <= 0) {
    return start;
  }
  return start + node.getTextContentSize();
}

/** Move caret to a plain-text offset after an external draft rewrite. */
export function setLexicalPlainSelection(
  editor: LexicalEditor,
  offset: number
): void {
  editor.update(
    () => {
      const root = $getRoot();
      const leaves = collectPlainLeaves(root);
      if (leaves.length === 0) {
        root.selectEnd();
        return;
      }
      let remaining = Math.max(0, offset);
      for (const node of leaves) {
        const size = node.getTextContentSize();
        if ($isTextNode(node)) {
          if (remaining <= size) {
            node.select(remaining, remaining);
            return;
          }
          remaining -= size;
          continue;
        }
        // Atomic leaf (linebreak / mention): land before it, or skip past it.
        if (remaining === 0) {
          node.selectPrevious();
          return;
        }
        if (remaining < size) {
          node.selectNext();
          return;
        }
        remaining -= size;
      }
      root.selectEnd();
    },
    { discrete: true }
  );
}
