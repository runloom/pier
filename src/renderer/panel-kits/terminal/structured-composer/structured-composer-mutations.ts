import type { LexicalEditor, LexicalNode } from "lexical";
import {
  $createLineBreakNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
} from "lexical";
import type { ComposerAttachment } from "../terminal-composer-attachments-model.ts";
import {
  $createAttachmentTokenNode,
  $isAttachmentTokenNode,
} from "./attachment-token-node.tsx";
import { $placeCaretAfterComposerChip } from "./composer-chip-caret.ts";
import { readLexicalPlainText } from "./structured-composer-serialize.ts";

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

/**
 * Insert plain text at the current selection without rewriting the document.
 * Preserves DecoratorNodes (e.g. @ path mentions) elsewhere in the draft.
 */
export function insertLexicalPlainTextAtSelection(
  editor: LexicalEditor,
  text: string
): void {
  if (text.length === 0) {
    return;
  }
  editor.update(
    () => {
      const selection = $getSelection();
      const nodes = nodesFromPlainText(text);
      if (nodes.length === 0) {
        return;
      }
      if ($isRangeSelection(selection)) {
        selection.insertNodes(nodes);
        return;
      }
      const root = $getRoot();
      const paragraph = root.getLastChild();
      if (paragraph && $isElementNode(paragraph)) {
        for (const node of nodes) {
          paragraph.append(node);
        }
        root.selectEnd();
      }
    },
    { discrete: true }
  );
}

/**
 * Insert an attachment chip at the Lexical selection.
 * Gap comes from host ::before/::after; caret parks in a following TextNode
 * so it stays text-height (not host-height).
 * Does not clear @ mention chips.
 */
export function insertAttachmentTokenAtLexicalSelection(
  editor: LexicalEditor,
  absolutePath: string,
  ordinal1Based: number
): void {
  editor.update(
    () => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        return;
      }
      const token = $createAttachmentTokenNode(
        absolutePath,
        ordinal1Based,
        true
      );
      selection.insertNodes([token]);
      $placeCaretAfterComposerChip(token);
    },
    { discrete: true }
  );
}

/**
 * Drop chips for a removed attachment path and renumber remaining chips
 * against the updated rail. @ mention chips are left intact.
 */
export function rewriteAttachmentTokensInLexical(
  editor: LexicalEditor,
  removedAbsolutePath: string,
  nextAttachments: readonly ComposerAttachment[]
): string {
  editor.update(
    () => {
      const pathToOrdinal = new Map(
        nextAttachments.map((att, index) => [att.path, index + 1] as const)
      );
      const stack: LexicalNode[] = [$getRoot()];
      while (stack.length > 0) {
        const node = stack.pop();
        if (!node) {
          continue;
        }
        if ($isAttachmentTokenNode(node)) {
          const path = node.getAbsolutePath();
          if (path === removedAbsolutePath) {
            node.remove();
            continue;
          }
          const ordinal = pathToOrdinal.get(path);
          if (ordinal == null) {
            node.setValid(false);
          } else {
            if (node.getOrdinal() !== ordinal) {
              node.setOrdinal(ordinal);
            }
            if (!node.isValid()) {
              node.setValid(true);
            }
          }
          continue;
        }
        if ($isElementNode(node)) {
          stack.push(...node.getChildren());
        }
      }
    },
    { discrete: true }
  );
  return readLexicalPlainText(editor);
}

/** Labels (ordinal or path) for attachment chips whose path is not on the rail. */
export function listInvalidAttachmentRefsInLexical(
  editor: LexicalEditor,
  attachments: readonly ComposerAttachment[]
): string[] {
  const paths = new Set(attachments.map((att) => att.path));
  const labels: string[] = [];
  editor.getEditorState().read(() => {
    const stack: LexicalNode[] = [$getRoot()];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      if ($isAttachmentTokenNode(node)) {
        if (!paths.has(node.getAbsolutePath())) {
          const ordinal = node.getOrdinal();
          labels.push(ordinal >= 1 ? String(ordinal) : node.getAbsolutePath());
        }
        continue;
      }
      if ($isElementNode(node)) {
        stack.push(...node.getChildren());
      }
    }
  });
  return labels;
}

/** Sync chip ordinal/valid against the current attachment rail. */
export function syncAttachmentTokenValidityInLexical(
  editor: LexicalEditor,
  attachments: readonly ComposerAttachment[]
): void {
  editor.update(() => {
    const pathToOrdinal = new Map(
      attachments.map((att, index) => [att.path, index + 1] as const)
    );
    const stack: LexicalNode[] = [$getRoot()];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      if ($isAttachmentTokenNode(node)) {
        const ordinal = pathToOrdinal.get(node.getAbsolutePath());
        if (ordinal == null) {
          if (node.isValid()) {
            node.setValid(false);
          }
        } else {
          if (node.getOrdinal() !== ordinal) {
            node.setOrdinal(ordinal);
          }
          if (!node.isValid()) {
            node.setValid(true);
          }
        }
        continue;
      }
      if ($isElementNode(node)) {
        stack.push(...node.getChildren());
      }
    }
  });
}
