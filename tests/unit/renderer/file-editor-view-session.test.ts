import { LSPPlugin } from "@codemirror/lsp-client";
import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { FileEditorViewSession } from "@plugins/builtin/files/renderer/file-editor-view-session.ts";
import type { FilesDocument } from "@plugins/builtin/files/renderer/files-document-types.ts";
import type { FilesEditorPrefs } from "@plugins/builtin/files/renderer/files-editor-prefs.ts";
import {
  clearFilesLanguageServiceStatusOwner,
  getFilesLanguageServiceStatus,
  publishFilesLanguageServiceStatus,
  resetFilesLanguageServiceStatusForTests,
} from "@plugins/builtin/files/renderer/files-language-service-status.ts";
import type * as FilesLspClientModule from "@plugins/builtin/files/renderer/files-lsp-client.ts";
import type * as FilesLspHoverModule from "@plugins/builtin/files/renderer/files-lsp-hover.ts";
import {
  clearFilesLspHover,
  filesLspHoverExtension,
  showFilesLspHover,
} from "@plugins/builtin/files/renderer/files-lsp-hover.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lspLifecycle = vi.hoisted(() => ({
  mounted: vi.fn(),
  unmounted: vi.fn(),
}));

const hoverLifecycle = vi.hoisted(() => ({
  order: [] as string[],
}));

interface MockLspInput {
  documentId: string;
  ownerId: string;
  panelContext?: PanelContext;
}

vi.mock(
  "@plugins/builtin/files/renderer/files-lsp-hover.ts",
  async (importOriginal) => {
    const actual = await importOriginal<typeof FilesLspHoverModule>();
    return {
      ...actual,
      clearFilesLspHover: vi.fn((view: EditorView) => {
        hoverLifecycle.order.push("hover.clear");
        actual.clearFilesLspHover(view);
      }),
    };
  }
);

vi.mock(
  "@plugins/builtin/files/renderer/files-lsp-client.ts",
  async (importOriginal) => {
    const actual = await importOriginal<typeof FilesLspClientModule>();
    return {
      ...actual,
      filesLspEditorExtensions: (input: MockLspInput) => {
        const publish = (status: { state: "starting" } | null): void => {
          if (status) {
            publishFilesLanguageServiceStatus(
              input.ownerId,
              input.documentId,
              status
            );
          } else {
            clearFilesLanguageServiceStatusOwner(input.ownerId);
          }
        };
        return ViewPlugin.fromClass(
          class {
            constructor() {
              publish({ state: "starting" });
              lspLifecycle.mounted(input.panelContext);
            }

            destroy(): void {
              publish(null);
              lspLifecycle.unmounted();
              hoverLifecycle.order.push("view.destroy");
            }
          }
        );
      },
    };
  }
);

beforeEach(() => {
  lspLifecycle.mounted.mockClear();
  lspLifecycle.unmounted.mockClear();
  vi.mocked(clearFilesLspHover).mockClear();
  hoverLifecycle.order.length = 0;
  resetFilesLanguageServiceStatusForTests();
});

const initialPrefs: FilesEditorPrefs = {
  defaultLanguage: null,
  lspEnabled: true,
  tabSize: 2,
  wordWrap: false,
};

const panelContextA = {
  contextId: "context-a",
  projectRootPath: "/repo/a",
  updatedAt: 1,
} satisfies PanelContext;

const panelContextB = {
  contextId: "context-b",
  projectRootPath: "/repo/b",
  updatedAt: 2,
} satisfies PanelContext;

const document: FilesDocument = {
  baseMtimeMs: 1,
  canonicalPath: "/repo/src/file.ts",
  capabilities: ["save"],
  conflictDiskContents: null,
  createdEmptyEol: null,
  currentContents: "const value = 'a long line';\n",
  deletedOnDisk: false,
  dirty: false,
  diskConflict: false,
  durabilityUnknown: false,
  eol: "lf",
  error: null,
  format: { bom: false, encoding: "utf8" },
  hasBackingStore: true,
  id: "document-1",
  language: "typescript",
  loadState: "loaded",
  mime: null,
  mode: 0o644,
  name: "file.ts",
  needsSaveAs: false,
  preview: null,
  readOnly: false,
  readOnlyReason: null,
  revision: "revision-1",
  savedContents: "const value = 'a long line';\n",
  saveState: "idle",
  size: 29,
  source: { kind: "disk", path: "src/file.ts", root: "/repo" },
};

const untitledDocument: FilesDocument = {
  ...document,
  canonicalPath: null,
  capabilities: ["saveAs"],
  hasBackingStore: false,
  name: "Untitled-1",
  needsSaveAs: true,
  source: {
    id: document.id,
    kind: "untitled",
    language: "typescript",
    name: "Untitled-1",
  },
};

const viewPresentationDefaults = {
  onOpenSearch: vi.fn(),
  onSearchStateChange: vi.fn(),
  openExternal: () => undefined,
};

const sessionHoverLabels = {
  contentTruncated: "Content truncated",
  definitionsTitle: "Definitions",
  definitionsTruncated: "Definitions truncated",
  documentationTitle: "Documentation",
  goToDefinitionFailed: "Unable to open that definition.",
  goToDefinitionUnavailable: "Go to Definition is unavailable here.",
  lineTruncated: "Line truncated",
  noInformation: "No symbol information",
  previewUnavailable: "Preview unavailable",
  symbolTitle: "Symbol information",
  unavailable: "Temporarily unavailable",
};

function findView(parent: HTMLElement): EditorView {
  const element = parent.querySelector(".cm-editor");
  expect(element).toBeInstanceOf(HTMLElement);
  const view = EditorView.findFromDOM(element as HTMLElement);
  expect(view).not.toBeNull();
  return view as EditorView;
}

describe("FileEditorViewSession detached preferences", () => {
  it("applies wrap and tab changes before remount without restarting disabled LSP", () => {
    const session = new FileEditorViewSession({
      documentId: document.id,
      editorPrefs: initialPrefs,
      editorSessionId: "session-1",
      minimapEnabled: false,
      onChange: vi.fn(),
      presentation: {
        ...viewPresentationDefaults,
        ariaLabel: "File editor",
      },
    });
    const firstParent = documentNode();
    session.mount(firstParent, document);
    expect(lspLifecycle.mounted).toHaveBeenCalledTimes(1);

    session.detach(firstParent);
    expect(lspLifecycle.unmounted).toHaveBeenCalledTimes(1);
    session.setEditorPrefs({
      ...initialPrefs,
      lspEnabled: false,
      tabSize: 8,
      wordWrap: true,
    });

    const secondParent = documentNode();
    session.mount(secondParent, document);
    const remountedView = findView(secondParent);
    expect(remountedView.state.facet(EditorState.tabSize)).toBe(8);
    expect(remountedView.contentDOM.classList).toContain("cm-lineWrapping");
    expect(lspLifecycle.mounted).toHaveBeenCalledTimes(1);

    session.dispose();
  });

  it("uses panel context changed while detached when remounting the same document", () => {
    const session = new FileEditorViewSession({
      documentId: document.id,
      editorPrefs: initialPrefs,
      editorSessionId: "session-panel-context",
      minimapEnabled: false,
      onChange: vi.fn(),
      panelContext: panelContextA,
      presentation: {
        ...viewPresentationDefaults,
        ariaLabel: "File editor",
      },
    });
    const firstParent = documentNode();
    session.mount(firstParent, document);
    expect(lspLifecycle.mounted).toHaveBeenLastCalledWith(panelContextA);

    session.detach(firstParent);
    session.setPanelContext(panelContextB);
    session.mount(documentNode(), document);

    expect(lspLifecycle.mounted).toHaveBeenCalledTimes(2);
    expect(lspLifecycle.mounted).toHaveBeenLastCalledWith(panelContextB);
    session.dispose();
  });

  it("clears an active hover before saving and destroying a preview-style detached view", async () => {
    const session = new FileEditorViewSession({
      documentId: document.id,
      editorPrefs: initialPrefs,
      editorSessionId: "session-hover-detach",
      minimapEnabled: false,
      onChange: vi.fn(),
      presentation: {
        ...viewPresentationDefaults,
        ariaLabel: "File editor",
      },
    });
    const sourceParent = documentNode();
    session.mount(sourceParent, document);
    const sourceView = findView(sourceParent);
    sourceView.dispatch({
      effects: StateEffect.appendConfig.of(
        filesLspHoverExtension({
          documentId: document.id,
          getLabels: () => sessionHoverLabels,
          ownerId: "session-hover-detach",
          prepareForManual: () => "ready",
          readDocument: vi.fn(),
          rootPath: "/repo",
        })
      ),
    });
    const mapping = {
      destroy: vi.fn(),
      getMapping: vi.fn(() => ({ mapped: true })),
      mapPosition: vi.fn(() => 0),
    };
    const plugin = {
      client: {
        cancelRequest: vi.fn(),
        request: vi.fn(async (method: string) =>
          method === "textDocument/hover"
            ? {
                contents: {
                  kind: "markdown",
                  value: "Mounted symbol documentation",
                },
              }
            : [
                {
                  range: {
                    end: { character: 5, line: 0 },
                    start: { character: 0, line: 0 },
                  },
                  uri: "file:///repo/src/file.ts",
                },
              ]
        ),
        sync: vi.fn(),
        workspace: { displayFile: vi.fn() },
        workspaceMapping: vi.fn(() => mapping),
      },
      docToHTML: vi.fn(() => "<p>Mounted symbol documentation</p>"),
      fromPosition: vi.fn(({ character }: { character: number }) => character),
      reportError: vi.fn(),
      toPosition: vi.fn((character: number) => ({ character, line: 0 })),
      uri: "file:///repo/src/file.ts",
    };
    const getLspPlugin = vi
      .spyOn(LSPPlugin, "get")
      .mockImplementation((view) =>
        view === sourceView ? (plugin as never) : null
      );

    vi.useFakeTimers();
    try {
      await expect(showFilesLspHover(sourceView)).resolves.toBe("shown");
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(sourceParent.querySelector('[role="dialog"]')).not.toBeNull();

      expect(session.detach(sourceParent)).toBe(true);

      expect(clearFilesLspHover).toHaveBeenCalledOnce();
      expect(hoverLifecycle.order).toEqual(["hover.clear", "view.destroy"]);

      const previewParent = documentNode();
      session.mount(previewParent, document);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);

      expect(previewParent.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      session.dispose();
      getLspPlugin.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("FileEditorViewSession language status ownership", () => {
  it.each([
    [
      "disabled/editor-disabled",
      (session: FileEditorViewSession) =>
        session.setEditorPrefs({ ...initialPrefs, lspEnabled: false }),
      { state: "disabled", reason: "editor-disabled" },
    ],
    [
      "unsupported/non-disk",
      (session: FileEditorViewSession) =>
        session.syncDocument(untitledDocument),
      { state: "unsupported", reason: "non-disk" },
    ],
  ] as const)("preserves replacement %s status when the old LSP extension publishes null on destroy", (_label, replace, expected) => {
    const ownerId = `session-replacement-${_label}`;
    const session = new FileEditorViewSession({
      documentId: document.id,
      editorPrefs: initialPrefs,
      editorSessionId: ownerId,
      minimapEnabled: false,
      onChange: vi.fn(),
      presentation: {
        ...viewPresentationDefaults,
        ariaLabel: "File editor",
      },
    });
    session.mount(documentNode(), document);
    expect(getFilesLanguageServiceStatus(ownerId, document.id)).toEqual({
      state: "starting",
    });

    replace(session);

    expect(getFilesLanguageServiceStatus(ownerId, document.id)).toEqual(
      expected
    );
    session.dispose();
  });
  it("clears every status owned by editorSessionId on dispose", () => {
    const ownerId = "session-owner";
    const session = new FileEditorViewSession({
      documentId: document.id,
      editorPrefs: { ...initialPrefs, lspEnabled: false },
      editorSessionId: ownerId,
      minimapEnabled: false,
      onChange: vi.fn(),
      presentation: {
        ...viewPresentationDefaults,
        ariaLabel: "File editor",
      },
    });
    session.mount(documentNode(), document);
    publishFilesLanguageServiceStatus(ownerId, "stale-document", {
      state: "ready",
      serverId: "server-1",
    });
    expect(getFilesLanguageServiceStatus(ownerId, document.id)).toEqual({
      state: "disabled",
      reason: "editor-disabled",
    });

    session.dispose();

    expect(getFilesLanguageServiceStatus(ownerId, document.id)).toBeNull();
    expect(getFilesLanguageServiceStatus(ownerId, "stale-document")).toBeNull();
  });
});

function documentNode(): HTMLDivElement {
  const node = window.document.createElement("div");
  window.document.body.appendChild(node);
  return node;
}
