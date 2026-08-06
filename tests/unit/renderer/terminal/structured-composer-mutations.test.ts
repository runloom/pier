import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { describe, expect, it } from "vitest";
import type { ComposerAttachment } from "@/panel-kits/terminal/composer-attachments-model.ts";
import {
  $createAttachmentTokenNode,
  $isAttachmentTokenNode,
  AttachmentTokenNode,
} from "@/panel-kits/terminal/structured-composer/attachment-token-node.tsx";
import { $deleteAdjacentMention } from "@/panel-kits/terminal/structured-composer/mention-delete-plugin.tsx";
import {
  insertAttachmentTokenAtLexicalSelection,
  insertOrReplaceReviewCommentsChipInLexical,
  listInvalidAttachmentRefsInLexical,
  rewriteAttachmentTokensInLexical,
} from "@/panel-kits/terminal/structured-composer/mutations.ts";
import {
  $isReviewCommentsChipNode,
  ReviewCommentsChipNode,
} from "@/panel-kits/terminal/structured-composer/review-comments-chip-node.tsx";
import { readLexicalPlainText } from "@/panel-kits/terminal/structured-composer/serialize.ts";
import {
  $createWorkspacePathMentionNode,
  $isWorkspacePathMentionNode,
  WorkspacePathMentionNode,
} from "@/panel-kits/terminal/structured-composer/workspace-path-mention-node.tsx";

function createMentionEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: "mutation-test",
    nodes: [
      WorkspacePathMentionNode,
      AttachmentTokenNode,
      ReviewCommentsChipNode,
    ],
  });
  editor.setRootElement(document.createElement("div"));
  return editor;
}

function countReviewChips(editor: LexicalEditor): number {
  let count = 0;
  editor.getEditorState().read(() => {
    const stack: LexicalNode[] = [$getRoot()];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      if ($isReviewCommentsChipNode(node)) {
        count += 1;
      }
      if ("getChildren" in node && typeof node.getChildren === "function") {
        stack.push(...node.getChildren());
      }
    }
  });
  return count;
}

function countMentions(editor: LexicalEditor): number {
  let mentionCount = 0;
  editor.getEditorState().read(() => {
    const stack: LexicalNode[] = [$getRoot()];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      if ($isWorkspacePathMentionNode(node)) {
        mentionCount += 1;
      }
      if ("getChildren" in node && typeof node.getChildren === "function") {
        stack.push(...node.getChildren());
      }
    }
  });
  return mentionCount;
}

function countAttachmentTokens(editor: LexicalEditor): number {
  let count = 0;
  editor.getEditorState().read(() => {
    const stack: LexicalNode[] = [$getRoot()];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) {
        continue;
      }
      if ($isAttachmentTokenNode(node)) {
        count += 1;
      }
      if ("getChildren" in node && typeof node.getChildren === "function") {
        stack.push(...node.getChildren());
      }
    }
  });
  return count;
}

function att(path: string): ComposerAttachment {
  return {
    id: path,
    kind: "file",
    name: path.split("/").pop() ?? path,
    path,
  };
}

describe("structured-composer-mutations", () => {
  it("inserts attachment chip without destroying mention chips", () => {
    const editor = createMentionEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createWorkspacePathMentionNode("/abs/a.ts", "a.ts"),
          $createTextNode(" ")
        );
        root.append(paragraph);
        root.selectEnd();
      },
      { discrete: true }
    );

    insertAttachmentTokenAtLexicalSelection(editor, "/tmp/note.pdf", 1);
    const text = readLexicalPlainText(editor);
    expect(text).toContain("/abs/a.ts");
    expect(text).toContain("/tmp/note.pdf");
    expect(text).not.toContain("[#");
    expect(countMentions(editor)).toBe(1);
    expect(countAttachmentTokens(editor)).toBe(1);
  });

  it("inserts attachment chip without document TextNode spaces; export adds them", () => {
    const editor = createMentionEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        const text = $createTextNode("ab");
        paragraph.append(text);
        root.append(paragraph);
        text.select(1, 1);
      },
      { discrete: true }
    );

    insertAttachmentTokenAtLexicalSelection(editor, "/p/x.png", 1);
    // Document model: text "a" + chip + text "b" (no synthetic space nodes).
    // Export inserts chip-boundary spaces for the agent payload.
    expect(readLexicalPlainText(editor)).toBe("a /p/x.png b");
    expect(countAttachmentTokens(editor)).toBe(1);
    editor.getEditorState().read(() => {
      const paragraph = $getRoot().getFirstChild();
      expect(paragraph).toBeTruthy();
      if (paragraph && "getChildren" in paragraph) {
        const children = (
          paragraph as { getChildren: () => LexicalNode[] }
        ).getChildren();
        // a | chip | b — three leaves, no space TextNodes.
        expect(children).toHaveLength(3);
        expect(children.every((c) => c.getTextContent() !== " ")).toBe(true);
      }
    });
  });

  it("removes chips for a deleted path and renumbers survivors", () => {
    const editor = createMentionEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createWorkspacePathMentionNode("/abs/a.ts", "a.ts"),
          $createTextNode(" "),
          $createAttachmentTokenNode("/p/1.png", 1),
          $createTextNode(" "),
          $createAttachmentTokenNode("/p/2.pdf", 2)
        );
        root.append(paragraph);
      },
      { discrete: true }
    );

    const next = rewriteAttachmentTokensInLexical(editor, "/p/1.png", [
      att("/p/2.pdf"),
    ]);
    expect(next).toBe("/abs/a.ts  /p/2.pdf");
    expect(countMentions(editor)).toBe(1);
    expect(countAttachmentTokens(editor)).toBe(1);
    editor.getEditorState().read(() => {
      const stack: LexicalNode[] = [$getRoot()];
      while (stack.length > 0) {
        const node = stack.pop();
        if (!node) {
          continue;
        }
        if ($isAttachmentTokenNode(node)) {
          expect(node.getOrdinal()).toBe(1);
          expect(node.getAbsolutePath()).toBe("/p/2.pdf");
        }
        if ("getChildren" in node && typeof node.getChildren === "function") {
          stack.push(...node.getChildren());
        }
      }
    });
  });

  it("lists invalid attachment chip ordinals", () => {
    const editor = createMentionEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        paragraph.append($createAttachmentTokenNode("/gone.png", 9, false));
        root.append(paragraph);
      },
      { discrete: true }
    );
    expect(
      listInvalidAttachmentRefsInLexical(editor, [att("/keep.png")])
    ).toEqual(["9"]);
  });

  it("backspace removes an adjacent mention chip atomically", () => {
    const editor = createMentionEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        const mention = $createWorkspacePathMentionNode("/abs/x", "x");
        const text = $createTextNode("a");
        paragraph.append(mention, text);
        root.append(paragraph);
        text.select(0, 0);
        expect($deleteAdjacentMention("backward")).toBe(true);
      },
      { discrete: true }
    );
    expect(readLexicalPlainText(editor)).toBe("a");
    expect(countMentions(editor)).toBe(0);
  });

  it("backspace removes an adjacent attachment chip atomically", () => {
    const editor = createMentionEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        const token = $createAttachmentTokenNode("/p/x", 1);
        const text = $createTextNode("a");
        paragraph.append(token, text);
        root.append(paragraph);
        text.select(0, 0);
        expect($deleteAdjacentMention("backward")).toBe(true);
      },
      { discrete: true }
    );
    expect(readLexicalPlainText(editor)).toBe("a");
    expect(countAttachmentTokens(editor)).toBe(0);
  });

  it("inserts review-comments chip and replaces on resubmit", () => {
    const editor = createMentionEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode("note "));
        root.append(paragraph);
        root.selectEnd();
      },
      { discrete: true }
    );
    insertOrReplaceReviewCommentsChipInLexical(editor, {
      count: 1,
      label: "Comments · 1",
      payloadText: "Please address these review comments:\n\n- `a.ts:1`: one",
    });
    expect(countReviewChips(editor)).toBe(1);
    expect(readLexicalPlainText(editor)).toContain("Please address");
    expect(countMentions(editor)).toBe(0);

    insertOrReplaceReviewCommentsChipInLexical(editor, {
      count: 2,
      label: "Comments · 2",
      payloadText: "Please address these review comments:\n\n- two items",
    });
    expect(countReviewChips(editor)).toBe(1);
    expect(readLexicalPlainText(editor)).toContain("two items");
    expect(readLexicalPlainText(editor)).not.toContain("`a.ts:1`");
  });
});
