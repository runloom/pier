import { describe, expect, it } from "vitest";
import type { ComposerAttachment } from "@/panel-kits/terminal/terminal-composer-attachments-model.ts";
import {
  buildComposerSendText,
  insertAttachmentPathAtCursor,
  insertPlainTextAtSelection,
  kindFromFileName,
  removeAttachmentById,
} from "@/panel-kits/terminal/terminal-composer-attachments-model.ts";

const a = (path: string, id = path): ComposerAttachment => ({
  id,
  kind: kindFromFileName(path),
  name: path.split("/").pop() ?? path,
  path,
});

describe("kindFromFileName", () => {
  it("maps image extensions", () => {
    expect(kindFromFileName("x.PNG")).toBe("image");
    expect(kindFromFileName("a.pdf")).toBe("file");
  });
});

describe("buildComposerSendText", () => {
  it("does not re-prefix rail paths already present via chips in the draft", () => {
    const atts = [a("/a.png", "1"), a("/b.pdf", "2")];
    // Lexical chips serialize to absolute paths in the draft body.
    expect(buildComposerSendText(atts, "分析 /a.png 与 /b.pdf")).toBe(
      "分析 /a.png 与 /b.pdf"
    );
  });
  it("does not re-prefix adjacent chips serialized without spaces", () => {
    const atts = [a("/a.png", "1"), a("/b.pdf", "2")];
    // Multi-attach inserts chips back-to-back; Lexical plain text is /a.png/b.pdf.
    expect(buildComposerSendText(atts, "/a.png/b.pdf")).toBe("/a.png/b.pdf");
  });
  it("treats CJK neighbors as path boundaries for chip bodies", () => {
    const atts = [a("/a.png", "1")];
    expect(buildComposerSendText(atts, "分析/a.png里的图")).toBe(
      "分析/a.png里的图"
    );
  });
  it("does not treat a shorter path prefix as present", () => {
    const atts = [a("/tmp/a", "1")];
    expect(buildComposerSendText(atts, "see /tmp/a.png")).toBe(
      "/tmp/a\nsee /tmp/a.png"
    );
  });
  it("prefixes only rail paths missing from the draft body", () => {
    const atts = [a("/a.png", "1"), a("/b.pdf", "2")];
    expect(buildComposerSendText(atts, "只看 /a.png")).toBe(
      "/b.pdf\n只看 /a.png"
    );
  });
  it("joins rail paths when the draft has no body text", () => {
    const atts = [a("/a.png", "1"), a("/b.pdf", "2")];
    expect(buildComposerSendText(atts, "  ")).toBe("/a.png\n/b.pdf");
  });
  it("attachments only has no trailing empty body line", () => {
    expect(buildComposerSendText([a("/a.png", "1")], "  ")).toBe("/a.png");
  });
  it("body only", () => {
    expect(buildComposerSendText([], "hello")).toBe("hello");
  });
  it("does not re-prefix when the path already appears in the body", () => {
    const atts = [a("/a.png", "1")];
    expect(buildComposerSendText(atts, "  分析 /a.png")).toBe("  分析 /a.png");
  });
  it("whitespace-only body is not sendable without attachments", () => {
    expect(buildComposerSendText([], "   \n\t  ")).toBe("");
  });
});

describe("removeAttachmentById", () => {
  it("drops the matching attachment", () => {
    const attachments = [a("/p/1.png", "1"), a("/p/2.pdf", "2")];
    expect(removeAttachmentById({ attachments, removeId: "2" })).toEqual([
      a("/p/1.png", "1"),
    ]);
  });
});

describe("insertAttachmentPathAtCursor", () => {
  it("inserts the absolute path at the cursor", () => {
    const r = insertAttachmentPathAtCursor("分析图", 2, "/p/one.png");
    expect(r.draft).toBe("分析/p/one.png图");
    expect(r.cursor).toBe(2 + "/p/one.png".length);
  });
  it("replaces the selected range", () => {
    const r = insertAttachmentPathAtCursor("abXXXcd", 2, "/p/one.png", 5);
    expect(r.draft).toBe("ab/p/one.pngcd");
  });
});

describe("insertPlainTextAtSelection", () => {
  it("inserts plain text", () => {
    expect(insertPlainTextAtSelection("ab", 1, 1, "X")).toEqual({
      cursor: 2,
      draft: "aXb",
    });
  });
});
