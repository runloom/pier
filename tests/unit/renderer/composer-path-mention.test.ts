import { $createParagraphNode, $getRoot, createEditor } from "lexical";
import { describe, expect, it } from "vitest";
import {
  joinProjectPath,
  mentionLabelFromRelativePath,
} from "@/panel-kits/terminal/structured-composer/composer-path-query.ts";
import {
  readLexicalPlainSelection,
  readLexicalPlainText,
  setLexicalPlainSelection,
  writeLexicalPlainText,
} from "@/panel-kits/terminal/structured-composer/structured-composer-serialize.ts";
import {
  $createWorkspacePathMentionNode,
  WorkspacePathMentionNode,
} from "@/panel-kits/terminal/structured-composer/workspace-path-mention-node.tsx";
import { LARGE_PASTE_CHAR_THRESHOLD } from "@/panel-kits/terminal/terminal-composer-paste.ts";

describe("composer-path-query helpers", () => {
  it("joins project root and relative posix path", () => {
    expect(joinProjectPath("/Users/me/proj/", "src/main.ts")).toBe(
      "/Users/me/proj/src/main.ts"
    );
    expect(joinProjectPath("/Users/me/proj", "/src/main.ts")).toBe(
      "/Users/me/proj/src/main.ts"
    );
  });

  it("rejects relative paths that escape the project root", () => {
    expect(joinProjectPath("/Users/me/proj", "../outside.ts")).toBeNull();
    expect(joinProjectPath("/Users/me/proj", "a/../../outside.ts")).toBeNull();
  });

  it("uses the final path segment as the mention label", () => {
    expect(mentionLabelFromRelativePath("src/panel/foo.ts")).toBe("foo.ts");
    expect(mentionLabelFromRelativePath("README.md")).toBe("README.md");
  });
});

describe("workspace-path-mention serialize", () => {
  it("serializes mention nodes as absolute paths in plain text", () => {
    const editor = createEditor({
      namespace: "test",
      nodes: [WorkspacePathMentionNode],
    });
    editor.setRootElement(document.createElement("div"));
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createWorkspacePathMentionNode("/Users/me/proj/src/a.ts", "a.ts")
        );
        root.append(paragraph);
      },
      { discrete: true }
    );
    expect(readLexicalPlainText(editor)).toBe("/Users/me/proj/src/a.ts");
  });

  it("counts newlines and mentions in plain-text selection offsets", () => {
    const editor = createEditor({
      namespace: "test",
      nodes: [WorkspacePathMentionNode],
    });
    editor.setRootElement(document.createElement("div"));
    writeLexicalPlainText(editor, "ab\ncd");
    // Place caret after 'c' on second line → offset 4 ("ab\nc|d")
    setLexicalPlainSelection(editor, 4);
    expect(readLexicalPlainSelection(editor)).toEqual({
      cursor: 4,
      selectionEnd: 4,
    });

    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        paragraph.append($createWorkspacePathMentionNode("/abs/x", "x"));
        root.append(paragraph);
        root.selectEnd();
      },
      { discrete: true }
    );
    expect(readLexicalPlainText(editor)).toBe("/abs/x");
    const after = readLexicalPlainSelection(editor);
    expect(after.cursor).toBe("/abs/x".length);
  });
});

describe("large paste threshold", () => {
  it("uses 10_000 characters", () => {
    expect(LARGE_PASTE_CHAR_THRESHOLD).toBe(10_000);
  });
});
