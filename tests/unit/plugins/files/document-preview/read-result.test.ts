import { createDiskDocumentRecord } from "@plugins/builtin/files/renderer/document/factory.ts";
import { withDocumentReadResult } from "@plugins/builtin/files/renderer/document/read-result.ts";
import { describe, expect, it } from "vitest";

const base = (path: string) =>
  createDiskDocumentRecord({
    draft: null,
    id: "doc",
    path,
    root: "/repo",
  });

describe("withDocumentReadResult document previews", () => {
  it("maps a document result to an image-like read-only preview", () => {
    const next = withDocumentReadResult(base("a.docx"), {
      canonicalPath: "/repo/a.docx",
      format: "docx",
      kind: "document",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      mtimeMs: 1,
      path: "a.docx",
      revision: "r1",
      root: "/repo",
      size: 123,
    });

    expect(next.preview).toEqual({
      format: "docx",
      kind: "document",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      revision: "r1",
    });
    expect(next.capabilities).toEqual([]);
    expect(next.currentContents).toBe("");
    expect(next.dirty).toBe(false);
    expect(next.format).toBeNull();
    expect(next.eol).toBeNull();
    expect(next.loadState).toBe("loaded");
    expect(next.readOnly).toBe(true);
    expect(next.readOnlyReason).toBeNull();
    expect(next.revision).toBe("r1");
  });

  it("maps unsupported documents to preview state without a revision", () => {
    const next = withDocumentReadResult(base("a.pptx"), {
      canonicalPath: "/repo/a.pptx",
      format: "pptx",
      kind: "document-unsupported",
      mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      path: "a.pptx",
      reason: "not-supported",
      root: "/repo",
      size: 42,
    });

    expect(next.preview).toEqual({
      format: "pptx",
      kind: "document-unsupported",
      reason: "not-supported",
    });
    expect(next.capabilities).toEqual([]);
    expect(next.currentContents).toBe("");
    expect(next.loadState).toBe("loaded");
    expect(next.readOnly).toBe(true);
    expect(next.readOnlyReason).toBeNull();
    expect(next.revision).toBeNull();
  });

  it("shows an unsupported document as a conflict while a local buffer is dirty", () => {
    const dirty = {
      ...base("a.docx"),
      dirty: true,
      currentContents: "unsaved",
    };
    const next = withDocumentReadResult(dirty, {
      canonicalPath: "/repo/a.docx",
      format: "docx",
      kind: "document",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      mtimeMs: 1,
      path: "a.docx",
      revision: "r1",
      root: "/repo",
      size: 123,
    });

    expect(next.diskConflict).toBe(true);
    expect(next.preview).toBeNull();
    expect(next.readOnlyReason).toBe("binary");
  });
});
