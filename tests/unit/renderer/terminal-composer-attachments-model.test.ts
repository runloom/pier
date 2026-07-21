import { describe, expect, it } from "vitest";
import type { ComposerAttachment } from "@/panel-kits/terminal/terminal-composer-attachments-model.ts";
import {
  buildComposerSendText,
  expandAttachmentTokens,
  findInvalidAttachmentTokens,
  insertTokenAtCursor,
  kindFromFileName,
  removeAttachmentAndRewriteDraft,
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

describe("expandAttachmentTokens", () => {
  it("expands [#n] and leaves unknown intact for caller validation", () => {
    const atts = [a("/p/one.png", "1"), a("/p/two.pdf", "2")];
    expect(expandAttachmentTokens("见 [#1] 与 [#2]", atts)).toBe(
      "见 /p/one.png 与 /p/two.pdf"
    );
  });
});

describe("findInvalidAttachmentTokens", () => {
  it("reports out-of-range ordinals", () => {
    expect(findInvalidAttachmentTokens("x [#0] [#3]", 2)).toEqual([0, 3]);
    expect(findInvalidAttachmentTokens("ok [#1]", 1)).toEqual([]);
  });
});

describe("buildComposerSendText", () => {
  it("joins paths and expanded body", () => {
    const atts = [a("/a.png", "1"), a("/b.pdf", "2")];
    expect(buildComposerSendText(atts, "分析 [#1]")).toBe(
      "/a.png\n/b.pdf\n分析 /a.png"
    );
  });
  it("attachments only has no trailing empty body line", () => {
    expect(buildComposerSendText([a("/a.png", "1")], "  ")).toBe("/a.png");
  });
  it("body only", () => {
    expect(buildComposerSendText([], "hello")).toBe("hello");
  });
});

describe("removeAttachmentAndRewriteDraft", () => {
  it("renumbers without breaking [#10]", () => {
    const attachments = Array.from({ length: 10 }, (_, i) =>
      a(`/p/${i + 1}.bin`, String(i + 1))
    );
    const draft = "x [#1] y [#10] z [#2]";
    const next = removeAttachmentAndRewriteDraft({
      attachments,
      draft,
      removeId: "2",
    });
    expect(next.attachments).toHaveLength(9);
    // 原 #1 仍为 1；原 #10 → #9；原 #2 删除
    expect(next.draft).toMatch(/\[#1]/);
    expect(next.draft).toMatch(/\[#9]/);
    expect(next.draft).not.toMatch(/\[#10\]/);
    expect(next.draft).not.toMatch(/\[#2\]/);
  });
});

describe("insertTokenAtCursor", () => {
  it("inserts spaced [#n] at cursor", () => {
    const r = insertTokenAtCursor("分析图", 2, 1); // after 分析
    expect(r.draft).toContain("[#1]");
    expect(r.cursor).toBeGreaterThan(2);
  });
});

describe("buildComposerSendText whitespace", () => {
  it("preserves leading body whitespace when attachments present", () => {
    const atts = [a("/a.png", "1")];
    expect(buildComposerSendText(atts, "  分析 [#1]")).toBe(
      "/a.png\n  分析 /a.png"
    );
  });
});

describe("insertTokenAtCursor selection", () => {
  it("replaces selected range", () => {
    const r = insertTokenAtCursor("abXXXcd", 2, 1, 5);
    expect(r.draft).toBe("ab [#1] cd");
  });
});

describe("buildComposerSendText empty body", () => {
  it("whitespace-only body is not sendable without attachments", () => {
    expect(buildComposerSendText([], "   \n\t  ")).toBe("");
  });
});
