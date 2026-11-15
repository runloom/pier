import { classifyDocumentPreview } from "@main/services/files/document-classifier.ts";
import { describe, expect, it } from "vitest";

const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
const cfb = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const pdf = new TextEncoder().encode("%PDF-1.7\n");

describe("classifyDocumentPreview", () => {
  it("classifies PDF by magic and extension", () => {
    expect(
      classifyDocumentPreview({ path: "docs/a.pdf", header: pdf })
    ).toEqual({
      kind: "document",
      format: "pdf",
      mime: "application/pdf",
    });
  });

  it("finds a PDF header after leading garbage within the first KiB", () => {
    const header = new Uint8Array(1024);
    header.set(new TextEncoder().encode("junk"), 0);
    header.set(pdf, 900);
    expect(classifyDocumentPreview({ path: "a.pdf", header })).toMatchObject({
      kind: "document",
      format: "pdf",
    });
  });

  it("classifies docx and xlsx by ZIP magic", () => {
    expect(classifyDocumentPreview({ path: "a.docx", header: zip })).toEqual({
      kind: "document",
      format: "docx",
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(classifyDocumentPreview({ path: "a.xlsx", header: zip })).toEqual({
      kind: "document",
      format: "xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  });

  it("reports encrypted OOXML when an OOXML file is a CFB container", () => {
    for (const path of ["a.docx", "a.xlsx", "a.pptx"]) {
      expect(classifyDocumentPreview({ path, header: cfb })).toMatchObject({
        kind: "unsupported",
        reason: "encrypted",
      });
    }
  });

  it("reports legacy Office formats", () => {
    for (const path of ["a.doc", "a.xls", "a.ppt"]) {
      expect(classifyDocumentPreview({ path, header: cfb })).toMatchObject({
        kind: "unsupported",
        reason: "legacy",
      });
    }
  });

  it("reports pptx as not supported", () => {
    expect(
      classifyDocumentPreview({ path: "a.pptx", header: zip })
    ).toMatchObject({
      kind: "unsupported",
      format: "pptx",
      reason: "not-supported",
    });
  });

  it("ignores a spoofed .pdf without %PDF- magic", () => {
    expect(classifyDocumentPreview({ path: "a.pdf", header: zip })).toEqual({
      kind: "none",
    });
  });

  it("ignores PDF magic without the pdf extension", () => {
    expect(classifyDocumentPreview({ path: "a.bin", header: pdf })).toEqual({
      kind: "none",
    });
  });

  it("matches extensions case-insensitively", () => {
    expect(
      classifyDocumentPreview({ path: "A.DOCX", header: zip })
    ).toMatchObject({ kind: "document", format: "docx" });
  });
});
