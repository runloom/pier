import { describe, expect, it } from "vitest";
import { parseFilesEditorLocation } from "../../../src/plugins/builtin/files/renderer/files-editor-actions.ts";

describe("parseFilesEditorLocation", () => {
  it("parses one-based line and column input", () => {
    expect(parseFilesEditorLocation("12")).toEqual({ line: 12 });
    expect(parseFilesEditorLocation("12:3")).toEqual({ column: 3, line: 12 });
    expect(parseFilesEditorLocation("12， 3")).toEqual({ column: 3, line: 12 });
  });

  it("rejects zero or malformed positions", () => {
    expect(parseFilesEditorLocation("0")).toBeNull();
    expect(parseFilesEditorLocation("12:0")).toBeNull();
    expect(parseFilesEditorLocation("12:3:4")).toBeNull();
  });
});
