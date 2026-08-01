import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  createFilesLspHoverModel,
  displayFilesLspPath,
  filesLspHoverCandidateAtPosition,
  filesLspHoverRangeContains,
  filesLspStringRangeAt,
  preferFilesLspHoverCandidateRange,
  sameFilesLspHoverCandidate,
} from "@plugins/builtin/files/renderer/lsp/hover-data.ts";
import { describe, expect, it, vi } from "vitest";

const labels = {
  contentTruncated: "Content truncated",
  definitionsTitle: "Definitions",
  definitionsTruncated: "Definitions truncated",
  documentationTitle: "Documentation",
  goToDefinitionFailed: "Unable to open that definition.",
  goToDefinitionUnavailable: "Go to Definition is unavailable here.",
  lineTruncated: "Line truncated",
  noInformation: "No information",
  previewUnavailable: "Preview unavailable",
  symbolTitle: "Symbol",
  unavailable: "Unavailable",
};

describe("files LSP hover data", () => {
  it("preserves a Windows UNC file URI as exactly two leading slashes", () => {
    expect(displayFilesLspPath("file://server/share/path.ts")).toBe(
      "//server/share/path.ts"
    );
  });

  it("treats half-open ranges and empty positions for coverage checks", () => {
    expect(filesLspHoverRangeContains(10, 20, 10)).toBe(true);
    expect(filesLspHoverRangeContains(10, 20, 19)).toBe(true);
    expect(filesLspHoverRangeContains(10, 20, 20)).toBe(false);
    expect(filesLspHoverRangeContains(10, 10, 10)).toBe(true);
    expect(filesLspHoverRangeContains(10, 10, 11)).toBe(false);
  });

  it("expands import path probes to the full string literal, not word pieces", () => {
    const doc = 'import { applyTokens } from "@/lib/theme/apply-tokens.ts";';
    const state = EditorState.create({
      doc,
      extensions: [javascript()],
    });
    const applyInPath = doc.indexOf("apply-tokens") + 2;
    const tokensInPath = doc.indexOf("tokens");
    const slash = doc.indexOf("@/lib") + 1;

    const stringRange = filesLspStringRangeAt(state, applyInPath);
    expect(stringRange).not.toBeNull();
    expect(doc.slice(stringRange?.from ?? 0, stringRange?.to ?? 0)).toBe(
      '"@/lib/theme/apply-tokens.ts"'
    );

    const view = new EditorView({ state });
    const onApply = filesLspHoverCandidateAtPosition(view, applyInPath);
    const onTokens = filesLspHoverCandidateAtPosition(view, tokensInPath);
    const onSlash = filesLspHoverCandidateAtPosition(view, slash);
    view.destroy();

    expect(onApply.from).toBe(onTokens.from);
    expect(onApply.to).toBe(onTokens.to);
    expect(onSlash.from).toBe(onApply.from);
    expect(onSlash.to).toBe(onApply.to);
    // Must not collapse to the word "apply" only.
    expect(onApply.to - onApply.from).toBeGreaterThan("apply".length);
  });

  it("does not expand template interpolations to the outer template string", () => {
    // Build with concatenation so Biome does not rewrite `${…}` as a real template.
    const doc = ["const x = `pre-${", "identifier", "}-post`;"].join("");
    const state = EditorState.create({
      doc,
      extensions: [javascript()],
    });
    const idPos = doc.indexOf("identifier") + 2;
    expect(filesLspStringRangeAt(state, idPos)).toBeNull();

    const view = new EditorView({ state });
    const candidate = filesLspHoverCandidateAtPosition(view, idPos);
    view.destroy();
    expect(doc.slice(candidate.from, candidate.to)).toBe("identifier");
  });

  it("keeps the same candidate after server range expand over a word probe", () => {
    const word = { from: 41, position: 43, to: 46 };
    const expanded = { from: 28, position: 43, to: 57 };
    // Anchor already expanded: smaller word probe still counts as same symbol.
    expect(sameFilesLspHoverCandidate(expanded, word)).toBe(true);
    // Pointer left the small word: not the same as the narrow anchor.
    expect(
      sameFilesLspHoverCandidate(word, { ...expanded, position: 50 })
    ).toBe(false);
    expect(preferFilesLspHoverCandidateRange(expanded, word)).toEqual({
      from: 28,
      position: 43,
      to: 57,
    });
  });

  it("reports rendered and uncapped definition counts explicitly", () => {
    const definitions = Array.from({ length: 8 }, (_, index) => ({
      path: `/repo/target-${index}.ts`,
      range: {
        end: { character: 1, line: index },
        start: { character: 0, line: index },
      },
      uri: `file:///repo/target-${index}.ts`,
    }));

    const model = createFilesLspHoverModel({
      definitions,
      definitionsTotal: 12,
      definitionsTruncated: true,
      error: false,
      hoverInput: {
        documentId: "document-1",
        getLabels: () => labels,
        ownerId: "owner-1",
        readDocument: vi.fn(),
        prepareForManual: vi.fn(() => "ready" as const),
        rootPath: "/repo",
      },
      hoverResult: null,
      mode: "definition",
      plugin: {
        docToHTML: vi.fn(() => ""),
        uri: "file:///repo/current.ts",
      },
    });

    expect(model.definitionsShown).toBe(8);
    expect(model.definitionsTotal).toBe(12);
    expect(model.activePreviewTarget).toBeNull();
  });
});
