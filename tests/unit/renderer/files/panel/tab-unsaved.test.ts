import { fileDocumentShowsUnsavedMark } from "@plugins/builtin/files/renderer/panel/tab-unsaved.ts";
import { describe, expect, it } from "vitest";

describe("fileDocumentShowsUnsavedMark", () => {
  it("marks untitled documents that still need save-as", () => {
    expect(
      fileDocumentShowsUnsavedMark({ dirty: false, needsSaveAs: true })
    ).toBe(true);
  });

  it("marks dirty disk documents", () => {
    expect(
      fileDocumentShowsUnsavedMark({ dirty: true, needsSaveAs: false })
    ).toBe(true);
  });

  it("hides the mark on a clean saved disk document", () => {
    expect(
      fileDocumentShowsUnsavedMark({ dirty: false, needsSaveAs: false })
    ).toBe(false);
  });
});
