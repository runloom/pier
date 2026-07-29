import { describe, expect, it } from "vitest";
import { filesLspHighlightLanguage } from "../../../src/plugins/builtin/files/renderer/files-lsp-highlight-language.ts";

describe("filesLspHighlightLanguage", () => {
  it("resolves common TypeScript and JavaScript tags", () => {
    expect(filesLspHighlightLanguage("typescript")).not.toBeNull();
    expect(filesLspHighlightLanguage("ts")).not.toBeNull();
    expect(filesLspHighlightLanguage("tsx")).not.toBeNull();
    expect(filesLspHighlightLanguage("javascript")).not.toBeNull();
  });

  it("resolves python / rust / go", () => {
    expect(filesLspHighlightLanguage("python")).not.toBeNull();
    expect(filesLspHighlightLanguage("rust")).not.toBeNull();
    expect(filesLspHighlightLanguage("go")).not.toBeNull();
  });

  it("returns null for unknown languages", () => {
    expect(filesLspHighlightLanguage("")).toBeNull();
    expect(filesLspHighlightLanguage("not-a-lang")).toBeNull();
  });
});
