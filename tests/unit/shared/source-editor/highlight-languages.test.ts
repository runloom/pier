import type { BuiltinFilesDocumentLanguage } from "@plugins/builtin/files/renderer/document/types.ts";
import {
  cmLanguageExtension,
  LANGUAGE_LABELS,
} from "@plugins/builtin/files/renderer/editor/cm-language.ts";
import { filesLspHighlightLanguage } from "@plugins/builtin/files/renderer/lsp/highlight-language.ts";
import { pierHighlightLanguage } from "@shared/source-editor/fenced-languages.ts";
import { describe, expect, it } from "vitest";

const FENCE_SKIP = new Set<BuiltinFilesDocumentLanguage>(["canvas", "text"]);

describe("highlight pipeline lockstep", () => {
  it("resolves hover/fence languages for every builtin editor id except canvas/text", () => {
    for (const id of Object.keys(
      LANGUAGE_LABELS
    ) as BuiltinFilesDocumentLanguage[]) {
      if (FENCE_SKIP.has(id)) {
        continue;
      }
      expect(pierHighlightLanguage(id), `catalog miss: ${id}`).not.toBeNull();
      expect(filesLspHighlightLanguage(id), `hover miss: ${id}`).not.toBeNull();
    }
  });

  it("keeps filesLspHighlightLanguage as the catalog wrapper", () => {
    expect(filesLspHighlightLanguage("graphql")).toBe(
      pierHighlightLanguage("graphql")
    );
    expect(filesLspHighlightLanguage("terraform")).toBe(
      pierHighlightLanguage("hcl")
    );
    expect(filesLspHighlightLanguage("")).toBeNull();
    expect(filesLspHighlightLanguage("not-a-lang")).toBeNull();
  });
});

describe("cmLanguageExtension coverage", () => {
  it("returns a highlighter for every builtin language except text", () => {
    for (const id of Object.keys(
      LANGUAGE_LABELS
    ) as BuiltinFilesDocumentLanguage[]) {
      if (id === "text") {
        expect(cmLanguageExtension(id)).toBeNull();
        continue;
      }
      expect(cmLanguageExtension(id), `editor miss: ${id}`).not.toBeNull();
    }
  });
});
