import {
  createFilesLspHoverModel,
  displayFilesLspPath,
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
