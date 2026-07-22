import { createEditor } from "lexical";
import { describe, expect, it } from "vitest";
import {
  readLexicalPlainText,
  writeLexicalPlainText,
} from "@/panel-kits/terminal/structured-composer/structured-composer-serialize.ts";

describe("structured-composer-serialize", () => {
  it("round-trips plain text including newlines", () => {
    const editor = createEditor({ namespace: "test" });
    editor.setRootElement(document.createElement("div"));
    writeLexicalPlainText(editor, "keep me");
    expect(readLexicalPlainText(editor)).toBe("keep me");
    writeLexicalPlainText(editor, "line1\nline2");
    expect(readLexicalPlainText(editor)).toBe("line1\nline2");
  });
});
