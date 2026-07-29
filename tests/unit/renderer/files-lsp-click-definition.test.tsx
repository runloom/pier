import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "codemirror";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lspPluginGetMock = vi.hoisted(() => vi.fn());

vi.mock("@codemirror/lsp-client", () => ({
  LSPPlugin: { get: lspPluginGetMock },
}));

import { filesLspHoverExtension } from "../../../src/plugins/builtin/files/renderer/files-lsp-hover.ts";

const SOURCE = "const alpha = beta;";
const SOURCE_URI = "file:///repo/main.ts";

const LABELS = {
  contentTruncated: "Documentation was truncated",
  definitionsTitle: "Definitions",
  definitionsTruncated: "Only the first definitions are shown",
  documentationTitle: "Documentation",
  goToDefinitionFailed: "Unable to open that definition.",
  goToDefinitionUnavailable: "Go to Definition is unavailable here.",
  lineTruncated: "Line truncated",
  noInformation: "No symbol information is available here",
  previewUnavailable: "Preview unavailable",
  symbolTitle: "Symbol information",
  unavailable: "Symbol information is temporarily unavailable",
};

function range(start: number, end: number) {
  return {
    end: { character: end, line: 0 },
    start: { character: start, line: 0 },
  };
}

describe("files LSP Cmd/Ctrl+Click definition", () => {
  let host: HTMLDivElement;
  let view: EditorView | null = null;

  beforeEach(() => {
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    });
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    view?.destroy();
    view = null;
    host.remove();
    lspPluginGetMock.mockReset();
  });

  function mountWithDefinition(response: unknown) {
    const displayFile = vi.fn(async (): Promise<EditorView | null> => null);
    const notifyError = vi.fn();
    const mapping = {
      destroy: vi.fn(),
      getMapping: vi.fn((): { mapped: boolean } | null => null),
      mapPosition: vi.fn(
        (_uri: string, position: { character: number }) => position.character
      ),
    };
    const client = {
      cancelRequest: vi.fn(),
      hasCapability: vi.fn(() => true),
      request: vi.fn(async () => response),
      sync: vi.fn(),
      workspace: { displayFile },
      workspaceMapping: vi.fn(() => mapping),
    };
    const plugin = {
      client,
      docToHTML: vi.fn(() => "<p>x</p>"),
      fromPosition: vi.fn(
        (position: { character: number }) => position.character
      ),
      reportError: vi.fn(),
      toPosition: vi.fn((position: number) => ({
        character: position,
        line: 0,
      })),
      uri: SOURCE_URI,
    };
    const extension = filesLspHoverExtension({
      documentId: "doc",
      getLabels: () => LABELS,
      notifyError,
      ownerId: "owner",
      prepareForManual: () => "ready",
      readDocument: vi.fn(async () => {
        throw new Error("unused");
      }),
      rootPath: "/repo",
    });
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: SOURCE,
        extensions: [new Compartment().of(extension)],
        selection: { anchor: 7 },
      }),
    });
    vi.spyOn(view, "posAtCoords").mockReturnValue(7);
    lspPluginGetMock.mockImplementation((candidate: EditorView) =>
      candidate === view ? plugin : null
    );
    return { client, displayFile, mapping, notifyError, plugin, view };
  }

  it("jumps on Meta+mousedown for a single LocationLink", async () => {
    const targetUri = "file:///repo/alpha.ts";
    const {
      client,
      displayFile,
      mapping,
      view: editor,
    } = mountWithDefinition([
      {
        targetRange: range(0, 10),
        targetSelectionRange: range(2, 7),
        targetUri,
      },
    ]);
    const targetView = new EditorView({
      parent: host,
      state: EditorState.create({ doc: "export const alpha = 1;" }),
    });
    const dispatch = vi.spyOn(targetView, "dispatch");
    displayFile.mockResolvedValue(targetView);
    mapping.getMapping.mockReturnValue({ mapped: true });
    mapping.mapPosition.mockImplementation(
      (_uri: string, position: { character: number }) => position.character
    );

    editor.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX: 12,
        clientY: 8,
        metaKey: true,
      })
    );
    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          selection: { anchor: 2, head: 7 },
          userEvent: "select.definition",
        })
      );
    });

    expect(client.request).toHaveBeenCalledWith(
      "textDocument/definition",
      expect.any(Object)
    );
    expect(client.workspace.displayFile).toHaveBeenCalledWith(targetUri);
    targetView.destroy();
  });

  it("shows a multi-target card instead of jumping when many definitions exist", async () => {
    const { view: editor } = mountWithDefinition([
      { range: range(0, 3), uri: "file:///repo/a.ts" },
      { range: range(4, 8), uri: "file:///repo/b.ts" },
    ]);

    editor.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX: 12,
        clientY: 8,
        metaKey: true,
      })
    );
    await vi.waitFor(() => {
      expect(
        editor.dom.querySelector('[data-slot="files-lsp-hover-card"]')
      ).not.toBeNull();
    });

    // Multi-target definition preview is a region (not a modal dialog).
    expect(editor.dom.querySelector('[role="dialog"]')).toBeNull();
  });

  it("ignores mousedown without the exact definition modifier", async () => {
    const { client, view: editor } = mountWithDefinition([
      { range: range(0, 3), uri: "file:///repo/a.ts" },
    ]);

    editor.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        cancelable: true,
        clientX: 12,
        clientY: 8,
      })
    );
    await Promise.resolve();

    expect(client.request).not.toHaveBeenCalled();
  });
});
