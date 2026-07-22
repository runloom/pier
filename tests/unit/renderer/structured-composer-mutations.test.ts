import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { describe, expect, it } from "vitest";
import {
  $createAttachmentTokenNode,
  $isAttachmentTokenNode,
  AttachmentTokenNode,
} from "@/panel-kits/terminal/structured-composer/attachment-token-node.tsx";
import { $deleteAdjacentMention } from "@/panel-kits/terminal/structured-composer/mention-delete-plugin.tsx";
import {
  insertAttachmentTokenAtLexicalSelection,
  listInvalidAttachmentRefsInLexical,
  rewriteAttachmentTokensInLexical,
} from "@/panel-kits/terminal/structured-composer/structured-composer-mutations.ts";
import { readLexicalPlainText } from "@/panel-kits/terminal/structured-composer/structured-composer-serialize.ts";
import {
  $createWorkspacePathMentionNode,
  $isWorkspacePathMentionNode,
  WorkspacePathMentionNode,
} from "@/panel-kits/terminal/structured-composer/workspace-path-mention-node.tsx";
import type { ComposerAttachment } from "@/panel-kits/terminal/terminal-composer-attachments-model.ts";

function createMentionEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: "mutation-test",
    nodes: [WorkspacePathMentionNode, AttachmentTokenNode],
  });
  editor.setRootElement(document.createElement("div"));
  return editor;
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

  it("inserts attachment chip without synthetic surrounding spaces", () => {
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
    expect(readLexicalPlainText(editor)).toBe("a/p/x.pngb");
    expect(countAttachmentTokens(editor)).toBe(1);
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
});
