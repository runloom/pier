import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from "lexical";
import { describe, expect, it } from "vitest";
import {
  $createAttachmentTokenNode,
  AttachmentTokenNode,
} from "@/panel-kits/terminal/structured-composer/attachment-token-node.tsx";
import {
  readLexicalPlainSelection,
  readLexicalPlainText,
  setLexicalPlainSelection,
  writeLexicalPlainText,
} from "@/panel-kits/terminal/structured-composer/serialize.ts";
import {
  $createWorkspacePathMentionNode,
  WorkspacePathMentionNode,
} from "@/panel-kits/terminal/structured-composer/workspace-path-mention-node.tsx";

function createChipEditor() {
  const editor = createEditor({
    namespace: "serialize-test",
    nodes: [WorkspacePathMentionNode, AttachmentTokenNode],
  });
  editor.setRootElement(document.createElement("div"));
  return editor;
}

describe("structured-composer-serialize", () => {
  it("round-trips plain text including newlines", () => {
    const editor = createEditor({ namespace: "test" });
    editor.setRootElement(document.createElement("div"));
    writeLexicalPlainText(editor, "keep me");
    expect(readLexicalPlainText(editor)).toBe("keep me");
    writeLexicalPlainText(editor, "line1\nline2");
    expect(readLexicalPlainText(editor)).toBe("line1\nline2");
  });

  it("inserts a space between adjacent chips on export", () => {
    const editor = createChipEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createAttachmentTokenNode("/a.png", 1),
          $createAttachmentTokenNode("/b.pdf", 2)
        );
        root.append(paragraph);
      },
      { discrete: true }
    );
    expect(readLexicalPlainText(editor)).toBe("/a.png /b.pdf");
  });

  it("inserts spaces between non-ws text and a chip", () => {
    const editor = createChipEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createTextNode("分析"),
          $createWorkspacePathMentionNode("/abs/a.ts", "a.ts"),
          $createTextNode("里的图")
        );
        root.append(paragraph);
      },
      { discrete: true }
    );
    expect(readLexicalPlainText(editor)).toBe("分析 /abs/a.ts 里的图");
  });

  it("does not double-space when a real space TextNode already exists", () => {
    const editor = createChipEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createTextNode("see "),
          $createAttachmentTokenNode("/p/x.png", 1),
          $createTextNode(" please")
        );
        root.append(paragraph);
      },
      { discrete: true }
    );
    expect(readLexicalPlainText(editor)).toBe("see /p/x.png please");
  });

  it("does not insert spaces across line breaks", () => {
    const editor = createChipEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createAttachmentTokenNode("/a.png", 1),
          $createLineBreakNode(),
          $createAttachmentTokenNode("/b.pdf", 2)
        );
        root.append(paragraph);
      },
      { discrete: true }
    );
    expect(readLexicalPlainText(editor)).toBe("/a.png\n/b.pdf");
  });

  it("maps selection offsets; synthetic spaces are not caret slots", () => {
    const editor = createChipEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        const text = $createTextNode("ab");
        const chip = $createAttachmentTokenNode("/p/x", 1);
        paragraph.append(text, chip);
        root.append(paragraph);
        // Caret after "a"
        text.select(1, 1);
      },
      { discrete: true }
    );
    // Projected: "ab /p/x" (space only in export)
    expect(readLexicalPlainText(editor)).toBe("ab /p/x");
    expect(readLexicalPlainSelection(editor)).toEqual({
      cursor: 1,
      selectionEnd: 1,
    });

    // Offset inside the synthetic space collapses to "after ab / before chip".
    setLexicalPlainSelection(editor, "ab ".length);
    expect(readLexicalPlainSelection(editor).cursor).toBe("ab".length);

    setLexicalPlainSelection(editor, "ab /p/x".length);
    expect(readLexicalPlainSelection(editor).cursor).toBe("ab /p/x".length);
  });
});
