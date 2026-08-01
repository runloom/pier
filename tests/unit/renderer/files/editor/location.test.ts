import { describe, expect, it } from "vitest";
import { editorOffsetForDocumentLocation } from "../../../../../src/plugins/builtin/files/renderer/editor/location.ts";

describe("editorOffsetForDocumentLocation", () => {
  it("converts one-based line and column to a document offset", () => {
    expect(
      editorOffsetForDocumentLocation(
        { currentContents: "one\ntwo\nthree", loadState: "loaded" },
        2,
        2
      )
    ).toBe(5);
  });

  it("defaults to the start of the requested line", () => {
    expect(
      editorOffsetForDocumentLocation(
        { currentContents: "one\ntwo", loadState: "loaded" },
        2
      )
    ).toBe(4);
  });

  it("rejects documents that are not loaded", () => {
    expect(
      editorOffsetForDocumentLocation(
        { currentContents: "", loadState: "loading" },
        1
      )
    ).toBeNull();
  });
});
