import { javascript } from "@codemirror/lang-javascript";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import type { FileDocumentReadResult } from "@shared/contracts/file.ts";
import { EditorView } from "codemirror";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";

const lspPluginGetMock = vi.hoisted(() => vi.fn());
const ORIGINAL_PLATFORM_DESCRIPTOR = Object.getOwnPropertyDescriptor(
  navigator,
  "platform"
);

vi.mock("@codemirror/lsp-client", () => ({
  LSPPlugin: { get: lspPluginGetMock },
}));

import {
  cancelQueuedFilesLspHover,
  clearFilesLspHover,
  filesLspHoverExtension,
  showFilesLspHover,
} from "../../../../../src/plugins/builtin/files/renderer/lsp/hover.ts";

interface LspParams {
  position: { character: number; line: number };
  textDocument: { uri: string };
}

interface DefinitionTarget {
  originSelectionRange?: LspRange;
  range?: LspRange;
  targetRange?: LspRange;
  targetSelectionRange?: LspRange;
  targetUri?: string;
  uri?: string;
}

interface LspRange {
  end: { character: number; line: number };
  start: { character: number; line: number };
}

type RequestResponder = (params: LspParams) => unknown;

interface MappingMock {
  destroy: Mock<() => void>;
  getMapping: Mock<(uri?: string) => { mapped: boolean } | null>;
  mapPosition: Mock<
    (uri: string, position: { character: number; line: number }) => number
  >;
}

interface ClientMock {
  cancelRequest: Mock<(params: LspParams) => void>;
  hasCapability: Mock<(name: string) => boolean>;
  request: Mock<(method: string, params: LspParams) => unknown>;
  sync: Mock<() => void>;
  workspace: WorkspaceMock;
  workspaceMapping: Mock<() => MappingMock>;
}

interface PluginMock {
  client: ClientMock;
  docToHTML: Mock<(contents: string | { value?: string }) => string>;
  fromPosition: Mock<
    (position: { character: number }, doc?: unknown) => number
  >;
  reportError: Mock<() => void>;
  toPosition: Mock<(position: number) => { character: number; line: number }>;
  uri: string;
}

interface WorkspaceMock {
  displayFile: Mock<(uri: string) => unknown>;
}

interface LspHarness {
  client: ClientMock;
  mappings: MappingMock[];
  order: string[];
  plugin: PluginMock;
  responders: Map<string, RequestResponder>;
  workspace: WorkspaceMock;
}

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

const SOURCE = "const alpha = beta;\nconst gamma = alpha;";
const SOURCE_URI = "file:///repo/main.ts";

function range(start: number, end: number, line = 0): LspRange {
  return {
    end: { character: end, line },
    start: { character: start, line },
  };
}

function location(uri: string, start = 0, end = 5): DefinitionTarget {
  return { range: range(start, end), uri };
}

function locationLink(
  targetUri: string,
  start: number,
  end: number
): DefinitionTarget {
  return {
    originSelectionRange: range(6, 11),
    targetRange: range(0, end + 3),
    targetSelectionRange: range(start, end),
    targetUri,
  };
}

function hover(value: string) {
  return {
    contents: { kind: "markdown", value },
    range: range(6, 11),
  };
}

type PreviewTextDocument = Extract<FileDocumentReadResult, { kind: "text" }>;

function textDocument(
  canonicalPath: string,
  contents: string,
  root = "/repo"
): PreviewTextDocument {
  return {
    canonicalPath,
    contents,
    eol: "lf",
    format: { bom: false, encoding: "utf8" },
    kind: "text",
    mode: null,
    mtimeMs: 1,
    path: canonicalPath,
    revision: `revision-${canonicalPath}`,
    root,
    size: contents.length,
    writable: true,
  };
}

function setPlatform(platform: string): void {
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: platform === "darwin" ? "MacIntel" : "Linux x86_64",
  });
}

function createLspHarness(uri = SOURCE_URI, order: string[] = []): LspHarness {
  const responders = new Map<string, RequestResponder>();
  const mappings: MappingMock[] = [];
  const workspace = { displayFile: vi.fn() };
  const client = {
    cancelRequest: vi.fn((params: LspParams) => {
      order.push(`cancel:${params.textDocument.uri}`);
    }),
    hasCapability: vi.fn(() => true),
    request: vi.fn((method: string, params: LspParams) => {
      order.push(`request:${method}`);
      return responders.get(method)?.(params) ?? Promise.resolve(null);
    }),
    sync: vi.fn(() => {
      order.push("sync");
    }),
    workspace,
    workspaceMapping: vi.fn(() => {
      order.push("mapping");
      const mapping: MappingMock = {
        destroy: vi.fn(() => {
          order.push("mapping.destroy");
        }),
        getMapping: vi.fn(() => ({ mapped: true })),
        mapPosition: vi.fn(
          (_uri: string, position: { character: number; line: number }) =>
            position.character
        ),
      };
      mappings.push(mapping);
      return mapping;
    }),
  };
  const plugin = {
    client,
    docToHTML: vi.fn((contents: string | { value?: string }) => {
      const value =
        typeof contents === "string" ? contents : (contents.value ?? "");
      return `<p>${value}</p>`;
    }),
    fromPosition: vi.fn(
      (position: { character: number }, _doc?: unknown) => position.character
    ),
    reportError: vi.fn(),
    toPosition: vi.fn((position: number) => {
      order.push(`params:${position}`);
      return { character: position, line: 0 };
    }),
    uri,
  };

  return { client, mappings, order, plugin, responders, workspace };
}

interface MountedHover {
  setPointerPosition(position: number): void;
  view: EditorView;
}

type HoverExtensionInput = Parameters<typeof filesLspHoverExtension>[0];

type HoverExtensionOverrides = Partial<
  Pick<
    HoverExtensionInput,
    | "documentId"
    | "notifyError"
    | "ownerId"
    | "prepareForManual"
    | "readDocument"
    | "rootPath"
  >
>;

function extensionInput(
  overrides: HoverExtensionOverrides = {}
): HoverExtensionInput {
  return {
    documentId: overrides.documentId ?? "document-main",
    getLabels: () => LABELS,
    ...(overrides.notifyError === undefined
      ? {}
      : { notifyError: overrides.notifyError }),
    ownerId: overrides.ownerId ?? "editor-main",
    prepareForManual: overrides.prepareForManual ?? (() => "ready"),
    readDocument:
      overrides.readDocument ??
      vi.fn(async ({ path, root }) =>
        textDocument(
          path,
          "export const first = 1;\nexport const second = 2;",
          root
        )
      ),
    rootPath: overrides.rootPath ?? "/repo",
  };
}

let host: HTMLDivElement;
let mountedViews: Set<EditorView>;

function mountHover(
  harness: LspHarness,
  options: {
    compartment?: Compartment;
    documentId?: string;
    doc?: string;
    extensions?: Extension[];
    notifyError?: HoverExtensionInput["notifyError"];
    pointerPosition?: number;
    prepareForManual?: HoverExtensionInput["prepareForManual"];
    readDocument?: Parameters<typeof filesLspHoverExtension>[0]["readDocument"];
  } = {}
): MountedHover {
  let pointerPosition = options.pointerPosition ?? 7;
  const hoverExtension = filesLspHoverExtension(
    extensionInput({
      ...(options.documentId === undefined
        ? {}
        : { documentId: options.documentId }),
      ...(options.notifyError === undefined
        ? {}
        : { notifyError: options.notifyError }),
      ...(options.prepareForManual === undefined
        ? {}
        : { prepareForManual: options.prepareForManual }),
      ...(options.readDocument === undefined
        ? {}
        : { readDocument: options.readDocument }),
    })
  );
  const extension = options.compartment
    ? options.compartment.of(hoverExtension)
    : hoverExtension;
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: options.doc ?? SOURCE,
      extensions: [...(options.extensions ?? []), extension],
      selection: { anchor: 7 },
    }),
  });
  vi.spyOn(view, "posAtCoords").mockImplementation(() => pointerPosition);
  mountedViews.add(view);
  lspPluginGetMock.mockImplementation((candidateView: EditorView) =>
    candidateView === view ? harness.plugin : null
  );
  return {
    setPointerPosition(position: number) {
      pointerPosition = position;
    },
    view,
  };
}

function movePointer(
  view: EditorView,
  modifiers: {
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  } = {}
): void {
  view.contentDOM.dispatchEvent(
    new MouseEvent("mousemove", {
      bubbles: true,
      clientX: 12,
      clientY: 8,
      ...modifiers,
    })
  );
}

/** Scheme Z: open multi-target definition UI via Cmd/Ctrl+mousedown (not hover). */
function definitionMouseDown(
  view: EditorView,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean } = { metaKey: true }
): void {
  view.contentDOM.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      cancelable: true,
      clientX: 12,
      clientY: 8,
      ...modifiers,
    })
  );
}

function modifierEvent(
  view: EditorView,
  type: "keydown" | "keyup",
  options: {
    altKey?: boolean;
    ctrlKey?: boolean;
    key: string;
    metaKey?: boolean;
    shiftKey?: boolean;
  }
): KeyboardEvent {
  const event = new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    ...options,
  });
  view.contentDOM.dispatchEvent(event);
  return event;
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

function requestParams(
  harness: LspHarness,
  method: string
): LspParams | undefined {
  return harness.client.request.mock.calls.find(
    ([requestedMethod]) => requestedMethod === method
  )?.[1];
}

function destroyMountedView(view: EditorView): void {
  if (mountedViews.delete(view)) {
    view.destroy();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  setPlatform("darwin");
  lspPluginGetMock.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  mountedViews = new Set();
});

afterEach(() => {
  for (const view of mountedViews) {
    view.destroy();
  }
  mountedViews.clear();
  host.remove();
  if (ORIGINAL_PLATFORM_DESCRIPTOR) {
    Object.defineProperty(navigator, "platform", ORIGINAL_PLATFORM_DESCRIPTOR);
  } else {
    Reflect.deleteProperty(navigator, "platform");
  }
  vi.useRealTimers();
});

describe("filesLspHoverExtension", () => {
  it("waits exactly 300ms for ordinary documentation hover", async () => {
    const harness = createLspHarness();
    harness.responders.set("textDocument/hover", () =>
      Promise.resolve(hover("Alpha documentation"))
    );
    const { view } = mountHover(harness);

    movePointer(view);
    await vi.advanceTimersByTimeAsync(299);
    expect(harness.client.request).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.client.request).toHaveBeenCalledOnce();
    expect(harness.client.request).toHaveBeenCalledWith("textDocument/hover", {
      position: { character: 7, line: 0 },
      textDocument: { uri: SOURCE_URI },
    });
    await flushAsyncWork();
    expect(view.dom.querySelector('[role="region"]')?.textContent).toContain(
      "Alpha documentation"
    );
  });

  // Scheme Z: Cmd/Ctrl+hover preflights definition (no preview card / no hover).
  it.each([
    ["darwin", { metaKey: true }],
    ["linux", { ctrlKey: true }],
  ] as const)("preflights definition without a card on %s definition-modifier hover", async (platform, modifiers) => {
    setPlatform(platform);
    const harness = createLspHarness();
    harness.responders.set("textDocument/definition", () =>
      Promise.resolve([location("file:///repo/alpha.ts")])
    );
    harness.responders.set("textDocument/hover", () =>
      Promise.resolve(hover("Should not open"))
    );
    const { view } = mountHover(harness);

    movePointer(view, modifiers);
    await vi.advanceTimersByTimeAsync(300);
    await flushAsyncWork();

    expect(harness.client.request.mock.calls.map(([method]) => method)).toEqual(
      ["textDocument/definition"]
    );
    expect(
      view.dom.querySelector('[data-slot="files-lsp-hover-card"]')
    ).toBeNull();
    expect(
      view.dom.querySelector(".cm-lsp-definition-affordance")
    ).not.toBeNull();
  });

  it.each([
    ["darwin", { ctrlKey: true }],
    ["darwin", { metaKey: true, shiftKey: true }],
    ["linux", { metaKey: true }],
    ["linux", { altKey: true, ctrlKey: true }],
  ] as const)("rejects non-exact definition modifiers on %s without documentation hover", async (platform, modifiers) => {
    setPlatform(platform);
    const harness = createLspHarness();
    const { view } = mountHover(harness);

    movePointer(view, modifiers);
    await vi.advanceTimersByTimeAsync(299);

    expect(harness.client.request).not.toHaveBeenCalled();
  });

  it("cancels an in-flight documentation hover when the definition modifier is pressed", async () => {
    const documentation = Promise.withResolvers<unknown>();
    const harness = createLspHarness();
    harness.responders.set("textDocument/hover", () => documentation.promise);
    harness.responders.set("textDocument/definition", () =>
      Promise.resolve([location("file:///repo/alpha.ts")])
    );
    const { view } = mountHover(harness);

    movePointer(view);
    await vi.advanceTimersByTimeAsync(300);
    const documentationParams = requestParams(harness, "textDocument/hover");
    expect(documentationParams).toBeDefined();

    // Capture-phase listener is on window (same as product); contentDOM alone
    // is not enough in jsdom for the definition-modifier preflight path.
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Meta",
        metaKey: true,
      })
    );
    await flushAsyncWork();

    expect(harness.client.cancelRequest).toHaveBeenCalled();
    expect(harness.client.cancelRequest.mock.calls[0]?.[0]).toBe(
      documentationParams
    );
    expect(harness.client.request.mock.calls.map(([method]) => method)).toEqual(
      ["textDocument/hover", "textDocument/definition"]
    );

    documentation.resolve(hover("Stale documentation"));
    await flushAsyncWork();

    expect(
      view.dom.querySelector('[data-slot="files-lsp-hover-card"]')
    ).toBeNull();
  });

  it("cancels the ordinary documentation timer when the definition modifier is pressed", async () => {
    const harness = createLspHarness();
    harness.responders.set("textDocument/hover", () =>
      Promise.resolve(hover("late"))
    );
    harness.responders.set("textDocument/definition", () =>
      Promise.resolve([location("file:///repo/alpha.ts")])
    );
    const { view } = mountHover(harness);

    movePointer(view);
    await vi.advanceTimersByTimeAsync(299);
    modifierEvent(view, "keydown", { key: "Meta", metaKey: true });
    await vi.advanceTimersByTimeAsync(1);
    await flushAsyncWork();

    expect(harness.client.request.mock.calls.map(([method]) => method)).toEqual(
      ["textDocument/definition"]
    );
  });

  it("restarts a full documentation delay when the definition modifier is released", async () => {
    const harness = createLspHarness();
    harness.responders.set("textDocument/hover", () =>
      Promise.resolve(hover("After release"))
    );
    harness.responders.set("textDocument/definition", () =>
      Promise.resolve([location("file:///repo/alpha.ts")])
    );
    const { view } = mountHover(harness);

    movePointer(view, { metaKey: true });
    await flushAsyncWork();
    expect(harness.client.request.mock.calls.map(([method]) => method)).toEqual(
      ["textDocument/definition"]
    );

    modifierEvent(view, "keyup", { key: "Meta" });
    await vi.advanceTimersByTimeAsync(299);
    expect(harness.client.request.mock.calls.map(([method]) => method)).toEqual(
      ["textDocument/definition"]
    );

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.client.request.mock.calls.map(([method]) => method)).toEqual(
      ["textDocument/definition", "textDocument/hover"]
    );
  });

  it("does not reset the debounce for repeated movement over the same candidate", async () => {
    const harness = createLspHarness();
    harness.responders.set("textDocument/hover", () =>
      Promise.resolve(hover("Stable"))
    );
    const { view } = mountHover(harness);

    movePointer(view);
    await vi.advanceTimersByTimeAsync(200);
    movePointer(view);
    await vi.advanceTimersByTimeAsync(99);
    expect(harness.client.request).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(harness.client.request).toHaveBeenCalledOnce();
    movePointer(view);
    await vi.advanceTimersByTimeAsync(300);
    expect(harness.client.request).toHaveBeenCalledOnce();
  });

  it("underlines the full import string on Cmd+hover after definition preflight", async () => {
    const harness = createLspHarness();
    const doc = 'import { applyTokens } from "@/lib/theme/apply-tokens.ts";';
    const applyInPath = doc.indexOf("apply-tokens") + 2;
    const stringFrom = doc.indexOf('"@/lib/theme/apply-tokens.ts"');
    const stringTo = stringFrom + '"@/lib/theme/apply-tokens.ts"'.length;
    harness.responders.set("textDocument/definition", () =>
      Promise.resolve([
        {
          originSelectionRange: range(stringFrom, stringTo),
          targetRange: range(0, 5),
          targetSelectionRange: range(0, 5),
          targetUri: "file:///repo/lib/theme/apply-tokens.ts",
        },
      ])
    );
    const { view } = mountHover(harness, {
      doc,
      extensions: [javascript()],
      pointerPosition: applyInPath,
    });

    movePointer(view, { metaKey: true });
    await flushAsyncWork();
    view.requestMeasure();
    await flushAsyncWork();

    const mark = view.dom.querySelector(".cm-lsp-definition-affordance");
    expect(mark).not.toBeNull();
    expect(mark?.textContent).toBe('"@/lib/theme/apply-tokens.ts"');
    // Continuous underline uses a rectangle layer (not per-token text-decoration).
    expect(
      view.dom.querySelector(".cm-lsp-definition-affordance-layer")
    ).not.toBeNull();
    expect(harness.client.request.mock.calls.map(([method]) => method)).toEqual(
      ["textDocument/definition"]
    );
  });

  it("does not underline on Cmd+hover when definition returns empty", async () => {
    const harness = createLspHarness();
    harness.responders.set("textDocument/definition", () =>
      Promise.resolve([])
    );
    const { view } = mountHover(harness);

    movePointer(view, { metaKey: true });
    await flushAsyncWork();

    expect(harness.client.request.mock.calls.map(([method]) => method)).toEqual(
      ["textDocument/definition"]
    );
    expect(view.dom.querySelector(".cm-lsp-definition-affordance")).toBeNull();
    expect(
      view.dom.querySelector('[data-slot="files-lsp-hover-card"]')
    ).toBeNull();
  });

  it("does not underline on Cmd+hover without a definition provider", async () => {
    const harness = createLspHarness();
    harness.client.hasCapability.mockImplementation(
      (name: string) => name !== "definitionProvider"
    );
    harness.responders.set("textDocument/definition", () =>
      Promise.resolve([location("file:///repo/alpha.ts")])
    );
    const { view } = mountHover(harness);

    movePointer(view, { metaKey: true });
    await flushAsyncWork();

    expect(harness.client.request).not.toHaveBeenCalled();
    expect(view.dom.querySelector(".cm-lsp-definition-affordance")).toBeNull();
  });

  it("does not underline on Cmd+hover when language service is absent", async () => {
    const harness = createLspHarness();
    harness.responders.set("textDocument/definition", () =>
      Promise.resolve([location("file:///repo/alpha.ts")])
    );
    const { view } = mountHover(harness);
    lspPluginGetMock.mockReturnValue(null);

    movePointer(view, { metaKey: true });
    await flushAsyncWork();

    expect(harness.client.request).not.toHaveBeenCalled();
    expect(view.dom.querySelector(".cm-lsp-definition-affordance")).toBeNull();
  });

  it("reuses ready preflight targets on Cmd+click without a second definition request", async () => {
    const harness = createLspHarness();
    const targetUri = "file:///repo/alpha.ts";
    harness.responders.set("textDocument/definition", () =>
      Promise.resolve([location(targetUri)])
    );
    const { view } = mountHover(harness);
    const targetView = new EditorView({
      parent: host,
      state: EditorState.create({ doc: "export const alpha = 1;" }),
    });
    mountedViews.add(targetView);
    harness.workspace.displayFile.mockResolvedValue(targetView);
    const dispatch = vi.spyOn(targetView, "dispatch");

    movePointer(view, { metaKey: true });
    await flushAsyncWork();
    expect(harness.client.request).toHaveBeenCalledOnce();
    expect(
      view.dom.querySelector(".cm-lsp-definition-affordance")
    ).not.toBeNull();

    definitionMouseDown(view);
    await flushAsyncWork();

    expect(harness.client.request).toHaveBeenCalledOnce();
    expect(harness.client.request.mock.calls.map(([method]) => method)).toEqual(
      ["textDocument/definition"]
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        userEvent: "select.definition",
      })
    );
  });

  it("Cmd+click after empty preflight is a silent no-op without a second request", async () => {
    const harness = createLspHarness();
    const notifyError = vi.fn();
    harness.responders.set("textDocument/definition", () =>
      Promise.resolve([])
    );
    const { view } = mountHover(harness, { notifyError });

    movePointer(view, { metaKey: true });
    await flushAsyncWork();
    expect(harness.client.request).toHaveBeenCalledOnce();

    definitionMouseDown(view);
    await flushAsyncWork();

    expect(harness.client.request).toHaveBeenCalledOnce();
    expect(notifyError).not.toHaveBeenCalled();
    expect(
      view.dom.querySelector('[data-slot="files-lsp-hover-card"]')
    ).toBeNull();
  });

  it("Cmd+click after failed preflight re-requests and reports request failure", async () => {
    const harness = createLspHarness();
    const notifyError = vi.fn();
    let definitionCalls = 0;
    harness.responders.set("textDocument/definition", () => {
      definitionCalls += 1;
      return Promise.reject(new Error("definition transport failed"));
    });
    const { view } = mountHover(harness, { notifyError });

    movePointer(view, { metaKey: true });
    await flushAsyncWork();
    expect(definitionCalls).toBe(1);
    expect(view.dom.querySelector(".cm-lsp-definition-affordance")).toBeNull();

    definitionMouseDown(view);
    await flushAsyncWork();

    expect(definitionCalls).toBe(2);
    expect(notifyError).toHaveBeenCalledWith(LABELS.goToDefinitionFailed);
  });

  it("cancels in-flight definition preflight when the definition modifier is released", async () => {
    const definition = Promise.withResolvers<unknown>();
    const harness = createLspHarness();
    harness.responders.set("textDocument/definition", () => definition.promise);
    const { view } = mountHover(harness);

    movePointer(view, { metaKey: true });
    await flushAsyncWork();
    const params = requestParams(harness, "textDocument/definition");
    expect(params).toBeDefined();

    modifierEvent(view, "keyup", { key: "Meta" });
    expect(harness.client.cancelRequest).toHaveBeenCalledWith(params);

    definition.resolve([location("file:///repo/alpha.ts")]);
    await flushAsyncWork();
    expect(view.dom.querySelector(".cm-lsp-definition-affordance")).toBeNull();
  });

  it("does not clear documentation when Hover.range expands beyond the word probe", async () => {
    const harness = createLspHarness();
    // Wider than word "beta" so post-response identity cannot rely on from/to equality.
    harness.responders.set("textDocument/hover", () =>
      Promise.resolve({
        contents: { kind: "markdown", value: "Wide range" },
        range: range(0, 18),
      })
    );
    const beta = SOURCE.indexOf("beta");
    const { setPointerPosition, view } = mountHover(harness, {
      pointerPosition: beta + 1,
    });

    movePointer(view);
    await vi.advanceTimersByTimeAsync(300);
    await flushAsyncWork();

    expect(
      view.dom.querySelector('[data-slot="files-lsp-hover-card"]')
    ).not.toBeNull();
    expect(harness.client.request).toHaveBeenCalledOnce();

    // Stay on the same word fragment inside the expanded range.
    setPointerPosition(beta + 2);
    movePointer(view);
    await vi.advanceTimersByTimeAsync(300);
    await flushAsyncWork();

    expect(harness.client.request).toHaveBeenCalledOnce();
    expect(
      view.dom.querySelector('[data-slot="files-lsp-hover-card"]')
    ).not.toBeNull();
  });

  it("does not mount a documentation card when hover returns no content", async () => {
    const harness = createLspHarness();
    harness.responders.set("textDocument/hover", () => Promise.resolve(null));
    const { view } = mountHover(harness);

    movePointer(view);
    await vi.advanceTimersByTimeAsync(300);
    await flushAsyncWork();

    expect(
      view.dom.querySelector('[data-slot="files-lsp-hover-card"]')
    ).toBeNull();
  });

  it("syncs an edit before calculating hover params for documentation", async () => {
    const order: string[] = [];
    const harness = createLspHarness(SOURCE_URI, order);
    const pendingHover = Promise.withResolvers<unknown>();
    harness.responders.set("textDocument/hover", () => pendingHover.promise);
    const { view } = mountHover(harness);
    order.length = 0;
    view.dispatch({ changes: { from: 0, insert: "updated " } });

    movePointer(view);
    await vi.advanceTimersByTimeAsync(300);

    expect(order.slice(0, 3)).toEqual([
      "sync",
      "params:7",
      "request:textDocument/hover",
    ]);
    expect(harness.client.sync).toHaveBeenCalledOnce();
  });

  it("syncs once and starts hover and definition in parallel for manual symbol information", async () => {
    const documentation = Promise.withResolvers<unknown>();
    const definition = Promise.withResolvers<unknown>();
    const order: string[] = [];
    const harness = createLspHarness(SOURCE_URI, order);
    harness.responders.set("textDocument/hover", () => documentation.promise);
    harness.responders.set("textDocument/definition", () => definition.promise);
    const { view } = mountHover(harness);
    order.length = 0;
    view.dispatch({ changes: { from: 0, insert: "updated " } });

    const result = showFilesLspHover(view);
    await Promise.resolve();

    expect(harness.client.sync).toHaveBeenCalledOnce();
    expect(harness.client.request.mock.calls.map(([method]) => method)).toEqual(
      ["textDocument/hover", "textDocument/definition"]
    );
    const syncIndex = order.indexOf("sync");
    const mappingIndex = order.indexOf("mapping");
    const hoverRequestIndex = order.indexOf("request:textDocument/hover");
    const definitionRequestIndex = order.indexOf(
      "request:textDocument/definition"
    );
    expect(syncIndex).toBe(0);
    expect(
      order.indexOf(`params:${view.state.selection.main.head}`)
    ).toBeGreaterThan(syncIndex);
    expect(mappingIndex).toBeGreaterThan(syncIndex);
    expect(hoverRequestIndex).toBeGreaterThan(syncIndex);
    expect(definitionRequestIndex).toBeGreaterThan(syncIndex);
    expect(requestParams(harness, "textDocument/hover")).not.toBe(
      requestParams(harness, "textDocument/definition")
    );

    documentation.resolve(hover("Manual documentation"));
    definition.resolve([location("file:///repo/alpha.ts")]);
    await expect(result).resolves.toBe("shown");
    await flushAsyncWork();
    expect(
      view.dom.querySelector('[data-slot="files-lsp-hover-card"]')?.textContent
    ).toContain("Manual documentation");
  });

  it("ignores and cancels a hover response after an edit", async () => {
    const response = Promise.withResolvers<unknown>();
    const harness = createLspHarness();
    harness.responders.set("textDocument/hover", () => response.promise);
    const { view } = mountHover(harness);
    movePointer(view);
    await vi.advanceTimersByTimeAsync(300);
    const params = requestParams(harness, "textDocument/hover");

    view.dispatch({ changes: { from: 0, to: 5, insert: "let" } });

    expect(harness.client.cancelRequest.mock.calls[0]?.[0]).toBe(params);
    response.resolve(hover("Stale after edit"));
    await flushAsyncWork();
    expect(view.dom.querySelector('[role="region"]')).toBeNull();
  });

  it("ignores and cancels both manual responses after the selection changes", async () => {
    const documentation = Promise.withResolvers<unknown>();
    const definition = Promise.withResolvers<unknown>();
    const harness = createLspHarness();
    harness.responders.set("textDocument/hover", () => documentation.promise);
    harness.responders.set("textDocument/definition", () => definition.promise);
    const { view } = mountHover(harness);
    const result = showFilesLspHover(view);
    await Promise.resolve();
    const hoverParams = requestParams(harness, "textDocument/hover");
    const definitionParams = requestParams(harness, "textDocument/definition");

    view.dispatch({ selection: { anchor: 15 } });

    expect(harness.client.cancelRequest.mock.calls[0]?.[0]).toBe(hoverParams);
    expect(harness.client.cancelRequest.mock.calls[1]?.[0]).toBe(
      definitionParams
    );
    documentation.resolve(hover("Stale after selection"));
    definition.resolve([location("file:///repo/stale.ts")]);
    await result;
    await flushAsyncWork();
    expect(
      view.dom.querySelector('[data-slot="files-lsp-hover-card"]')
    ).toBeNull();
    expect(harness.mappings[0]?.destroy).toHaveBeenCalledOnce();
  });

  it("drops a response when the current LSP document identity changes", async () => {
    const response = Promise.withResolvers<unknown>();
    const first = createLspHarness();
    const second = createLspHarness("file:///repo/replacement.ts");
    first.responders.set("textDocument/hover", () => response.promise);
    const mounted = mountHover(first);
    const { view } = mounted;
    movePointer(view);
    await vi.advanceTimersByTimeAsync(300);

    lspPluginGetMock.mockImplementation((candidateView: EditorView) =>
      candidateView === view ? second.plugin : null
    );
    response.resolve(hover("Wrong document"));
    await flushAsyncWork();

    expect(view.dom.querySelector('[role="region"]')).toBeNull();
    mounted.setPointerPosition(15);
    movePointer(view);
    await vi.advanceTimersByTimeAsync(300);
    expect(second.client.request).toHaveBeenCalledWith(
      "textDocument/hover",
      expect.objectContaining({ textDocument: { uri: second.plugin.uri } })
    );
  });

  it("clears the active card and prepared mapping when the plugin is replaced", async () => {
    const first = createLspHarness();
    const second = createLspHarness("file:///repo/replacement.ts");
    first.responders.set("textDocument/definition", () =>
      Promise.resolve([
        location("file:///repo/alpha.ts"),
        location("file:///repo/beta.ts"),
      ])
    );
    const { view } = mountHover(first);
    definitionMouseDown(view);
    await flushAsyncWork();
    expect(
      view.dom.querySelector('[data-slot="files-lsp-hover-card"]')
    ).not.toBeNull();

    lspPluginGetMock.mockImplementation((candidateView: EditorView) =>
      candidateView === view ? second.plugin : null
    );
    view.dispatch({});
    await flushAsyncWork();

    expect(
      view.dom.querySelector('[data-slot="files-lsp-hover-card"]')
    ).toBeNull();
    expect(first.mappings[0]?.destroy).toHaveBeenCalledOnce();
  });

  it("cancels and rejects a stale response after the plugin is removed", async () => {
    const response = Promise.withResolvers<unknown>();
    const harness = createLspHarness();
    harness.responders.set("textDocument/definition", () => response.promise);
    const { view } = mountHover(harness);
    definitionMouseDown(view);
    await flushAsyncWork();
    const params = requestParams(harness, "textDocument/definition");

    lspPluginGetMock.mockReturnValue(null);
    view.dispatch({});

    expect(harness.client.cancelRequest).toHaveBeenCalledWith(params);
    expect(harness.mappings[0]?.destroy).toHaveBeenCalledOnce();
    response.resolve([
      location("file:///repo/stale.ts"),
      location("file:///repo/other.ts"),
    ]);
    await flushAsyncWork();
    expect(
      view.dom.querySelector('[data-slot="files-lsp-hover-card"]')
    ).toBeNull();
    expect(harness.mappings[0]?.destroy).toHaveBeenCalledOnce();
  });

  it("cancels and rejects stale work when the hover extension document is replaced", async () => {
    const response = Promise.withResolvers<unknown>();
    const harness = createLspHarness();
    harness.responders.set("textDocument/hover", () => response.promise);
    const compartment = new Compartment();
    const { view } = mountHover(harness, {
      compartment,
      documentId: "document-one",
    });
    movePointer(view);
    await vi.advanceTimersByTimeAsync(300);
    const params = requestParams(harness, "textDocument/hover");

    view.dispatch({
      effects: compartment.reconfigure(
        filesLspHoverExtension(extensionInput({ documentId: "document-two" }))
      ),
    });

    expect(harness.client.cancelRequest.mock.calls[0]?.[0]).toBe(params);
    response.resolve(hover("Replaced document"));
    await flushAsyncWork();
    expect(view.dom.querySelector('[role="region"]')).toBeNull();
  });

  it("cancels a transient request when focus leaves the editor and card", async () => {
    const response = Promise.withResolvers<unknown>();
    const harness = createLspHarness();
    harness.responders.set("textDocument/hover", () => response.promise);
    const { view } = mountHover(harness);
    const outside = document.createElement("button");
    host.append(outside);
    view.focus();
    movePointer(view);
    await vi.advanceTimersByTimeAsync(300);
    const params = requestParams(harness, "textDocument/hover");

    outside.focus();
    await flushAsyncWork();

    expect(harness.client.cancelRequest.mock.calls[0]?.[0]).toBe(params);
    response.resolve(hover("Blurred response"));
    await flushAsyncWork();
    expect(view.dom.querySelector('[role="region"]')).toBeNull();
  });

  it("does not reuse pointer coordinates after focus leaves the hover surface", async () => {
    const harness = createLspHarness();
    const { view } = mountHover(harness);
    const outside = document.createElement("button");
    host.append(outside);
    view.focus();
    movePointer(view);

    outside.focus();
    await flushAsyncWork();
    outside.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Meta",
        metaKey: true,
      })
    );
    await vi.advanceTimersByTimeAsync(300);

    expect(harness.client.request).not.toHaveBeenCalled();
  });

  it("lets the same pointer candidate retry after the plugin becomes available", async () => {
    const harness = createLspHarness();
    const { view } = mountHover(harness);
    lspPluginGetMock.mockReturnValue(null);

    movePointer(view);
    await vi.advanceTimersByTimeAsync(300);
    expect(harness.client.request).not.toHaveBeenCalled();

    lspPluginGetMock.mockReturnValue(harness.plugin);
    movePointer(view);
    await vi.advanceTimersByTimeAsync(300);

    expect(harness.client.request).toHaveBeenCalledWith(
      "textDocument/hover",
      expect.any(Object)
    );
  });

  it("cancels pending work and ignores its result after destroy", async () => {
    const response = Promise.withResolvers<unknown>();
    const harness = createLspHarness();
    harness.responders.set("textDocument/definition", () => response.promise);
    const { view } = mountHover(harness);
    definitionMouseDown(view);
    await flushAsyncWork();
    const params = requestParams(harness, "textDocument/definition");

    destroyMountedView(view);

    expect(harness.client.cancelRequest.mock.calls[0]?.[0]).toBe(params);
    expect(harness.mappings[0]?.destroy).toHaveBeenCalledOnce();
    response.resolve([
      location("file:///repo/late.ts"),
      location("file:///repo/other.ts"),
    ]);
    await flushAsyncWork();
    expect(
      view.dom.querySelector('[data-slot="files-lsp-hover-card"]')
    ).toBeNull();
    expect(harness.mappings[0]?.destroy).toHaveBeenCalledOnce();
  });

  it("renders distinct no-result and rejected-request states", async () => {
    const noResultHarness = createLspHarness();
    noResultHarness.responders.set("textDocument/hover", () =>
      Promise.resolve(null)
    );
    noResultHarness.responders.set("textDocument/definition", () =>
      Promise.resolve([])
    );
    const noResultView = mountHover(noResultHarness).view;

    await expect(showFilesLspHover(noResultView)).resolves.toBe("shown");
    await flushAsyncWork();
    expect(
      noResultView.dom.querySelector('[data-slot="files-lsp-hover-card"]')
        ?.textContent
    ).toContain(LABELS.noInformation);

    destroyMountedView(noResultView);
    const rejectedHarness = createLspHarness();
    rejectedHarness.responders.set("textDocument/hover", () =>
      Promise.reject(new Error("hover transport failed"))
    );
    rejectedHarness.responders.set("textDocument/definition", () =>
      Promise.reject(new Error("definition transport failed"))
    );
    const rejectedView = mountHover(rejectedHarness).view;

    await expect(showFilesLspHover(rejectedView)).resolves.toBe("shown");
    await flushAsyncWork();
    expect(
      rejectedView.dom.querySelector('[data-slot="files-lsp-hover-card"]')
        ?.textContent
    ).toContain(LABELS.unavailable);
  });

  it("creates one mapping for a multi-target definition click and destroys it once", async () => {
    const harness = createLspHarness();
    harness.responders.set("textDocument/definition", () =>
      Promise.resolve([
        location("file:///repo/alpha.ts"),
        location("file:///repo/beta.ts"),
      ])
    );
    const { view } = mountHover(harness);
    definitionMouseDown(view);
    await flushAsyncWork();

    expect(harness.client.workspaceMapping).toHaveBeenCalledOnce();
    expect(harness.mappings).toHaveLength(1);
    clearFilesLspHover(view);
    clearFilesLspHover(view);
    destroyMountedView(view);

    expect(harness.mappings[0]?.destroy).toHaveBeenCalledOnce();
  });

  it("loads only the active definition preview and caches focused and hovered revisits", async () => {
    const firstUri = "file:///repo/first.ts";
    const secondUri = "file:///repo/second.ts";
    const readDocument = vi.fn<
      Parameters<typeof filesLspHoverExtension>[0]["readDocument"]
    >(async ({ path }) =>
      path === "first.ts"
        ? textDocument(path, "first preview")
        : textDocument(path, "second preview")
    );
    const harness = createLspHarness();
    harness.responders.set("textDocument/definition", () =>
      Promise.resolve([location(firstUri), location(secondUri)])
    );
    const { view } = mountHover(harness, { readDocument });

    definitionMouseDown(view);
    await flushAsyncWork();

    const dialog = view.dom.querySelector<HTMLElement>(
      '[data-slot="files-lsp-hover-card"]'
    );
    const targets = Array.from(
      dialog?.querySelectorAll<HTMLButtonElement>("button") ?? []
    );
    const firstTarget = targets.find((button) =>
      button.textContent?.includes("first.ts")
    );
    const secondTarget = targets.find((button) =>
      button.textContent?.includes("second.ts")
    );
    expect(dialog).not.toBeNull();
    expect(firstTarget).toBeDefined();
    expect(secondTarget).toBeDefined();
    if (!(firstTarget && secondTarget)) {
      throw new Error("Expected both definition preview targets");
    }
    expect(readDocument).toHaveBeenCalledOnce();
    expect(readDocument).toHaveBeenLastCalledWith({
      path: "first.ts",
      root: "/repo",
    });
    expect(dialog?.textContent).toContain("first preview");
    expect(dialog?.textContent).not.toContain("second preview");
    expect(
      dialog?.querySelectorAll('[data-slot="files-lsp-definition-preview"]')
    ).toHaveLength(1);

    secondTarget.focus();
    await flushAsyncWork();

    expect(readDocument).toHaveBeenCalledTimes(2);
    expect(readDocument).toHaveBeenLastCalledWith({
      path: "second.ts",
      root: "/repo",
    });
    expect(dialog?.textContent).toContain("second preview");
    expect(dialog?.textContent).not.toContain("first preview");
    expect(
      dialog?.querySelectorAll('[data-slot="files-lsp-definition-preview"]')
    ).toHaveLength(1);

    firstTarget.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    await flushAsyncWork();
    expect(dialog?.textContent).toContain("first preview");
    expect(dialog?.textContent).not.toContain("second preview");
    secondTarget.dispatchEvent(
      new MouseEvent("pointerover", { bubbles: true })
    );
    await flushAsyncWork();
    expect(dialog?.textContent).toContain("second preview");
    expect(dialog?.textContent).not.toContain("first preview");
    expect(readDocument).toHaveBeenCalledTimes(2);
  });

  it("caches late preview results without reopening a stale pane", async () => {
    const firstPreview = Promise.withResolvers<PreviewTextDocument>();
    const secondPreview = Promise.withResolvers<PreviewTextDocument>();
    const readDocument = vi.fn<
      Parameters<typeof filesLspHoverExtension>[0]["readDocument"]
    >(({ path }) =>
      path === "first.ts" ? firstPreview.promise : secondPreview.promise
    );
    const harness = createLspHarness();
    harness.responders.set("textDocument/definition", () =>
      Promise.resolve([
        location("file:///repo/first.ts"),
        location("file:///repo/second.ts"),
      ])
    );
    const { view } = mountHover(harness, { readDocument });

    definitionMouseDown(view);
    await flushAsyncWork();
    const dialog = view.dom.querySelector<HTMLElement>(
      '[data-slot="files-lsp-hover-card"]'
    );
    const targets = Array.from(
      dialog?.querySelectorAll<HTMLButtonElement>("button") ?? []
    );
    const firstTarget = targets.find((button) =>
      button.textContent?.includes("first.ts")
    );
    const secondTarget = targets.find((button) =>
      button.textContent?.includes("second.ts")
    );
    expect(dialog).not.toBeNull();
    expect(readDocument).toHaveBeenCalledOnce();
    expect(firstTarget).toBeDefined();
    expect(secondTarget).toBeDefined();
    if (!(firstTarget && secondTarget)) {
      throw new Error("Expected both definition preview targets");
    }

    secondTarget.focus();
    await flushAsyncWork();
    expect(readDocument).toHaveBeenCalledTimes(2);

    firstPreview.resolve(textDocument("first.ts", "late first preview"));
    await flushAsyncWork();
    expect(dialog?.textContent).not.toContain("late first preview");

    firstTarget.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    await flushAsyncWork();
    expect(dialog?.textContent).toContain("late first preview");
    expect(dialog?.textContent).not.toContain("active second preview");
    expect(readDocument).toHaveBeenCalledTimes(2);

    secondPreview.resolve(textDocument("second.ts", "active second preview"));
    await flushAsyncWork();
    expect(dialog?.textContent).toContain("late first preview");
    expect(dialog?.textContent).not.toContain("active second preview");

    secondTarget.dispatchEvent(
      new MouseEvent("pointerover", { bubbles: true })
    );
    await flushAsyncWork();
    expect(dialog?.textContent).toContain("active second preview");
    expect(dialog?.textContent).not.toContain("late first preview");
    expect(readDocument).toHaveBeenCalledTimes(2);
  });

  it("ignores a preview that resolves after the card is cleared", async () => {
    const secondPreview = Promise.withResolvers<PreviewTextDocument>();
    const readDocument = vi.fn<
      Parameters<typeof filesLspHoverExtension>[0]["readDocument"]
    >(({ path }) =>
      path === "first.ts"
        ? Promise.resolve(textDocument(path, "first preview"))
        : secondPreview.promise
    );
    const harness = createLspHarness();
    harness.responders.set("textDocument/definition", () =>
      Promise.resolve([
        location("file:///repo/first.ts"),
        location("file:///repo/second.ts"),
      ])
    );
    const { view } = mountHover(harness, { readDocument });

    definitionMouseDown(view);
    await flushAsyncWork();
    const secondTarget = Array.from(
      view.dom.querySelectorAll<HTMLButtonElement>(
        '[data-slot="files-lsp-hover-card"] button'
      )
    ).find((button) => button.textContent?.includes("second.ts"));
    expect(secondTarget).toBeDefined();
    if (!secondTarget) {
      throw new Error("Expected the second definition preview target");
    }
    secondTarget.focus();
    await flushAsyncWork();
    expect(readDocument).toHaveBeenCalledTimes(2);

    clearFilesLspHover(view);
    await flushAsyncWork();
    secondPreview.resolve(textDocument("second.ts", "late second preview"));
    await flushAsyncWork();

    expect(
      view.dom.querySelector('[data-slot="files-lsp-hover-card"]')
    ).toBeNull();
    expect(view.dom.textContent).not.toContain("late second preview");
  });

  it("opens a selected prepared LocationLink with mapping and never requeries", async () => {
    const firstUri = "file:///repo/first.ts";
    const secondUri = "file:///repo/second.ts";
    const harness = createLspHarness();
    harness.responders.set("textDocument/definition", () =>
      Promise.resolve([
        locationLink(firstUri, 2, 7),
        locationLink(secondUri, 9, 15),
      ])
    );
    const targetView = new EditorView({
      parent: host,
      state: EditorState.create({ doc: "export const second = true;" }),
    });
    mountedViews.add(targetView);
    const dispatch = vi.spyOn(targetView, "dispatch");
    harness.workspace.displayFile.mockResolvedValue(targetView);
    const { view } = mountHover(harness);

    definitionMouseDown(view);
    await flushAsyncWork();
    const dialog = view.dom.querySelector<HTMLElement>(
      '[data-slot="files-lsp-hover-card"]'
    );
    const secondTarget = Array.from(
      dialog?.querySelectorAll<HTMLButtonElement>("button") ?? []
    ).find((button) => button.textContent?.includes("second.ts"));
    expect(secondTarget).toBeDefined();
    if (!secondTarget) {
      throw new Error("Expected the second definition target");
    }

    secondTarget.click();
    await flushAsyncWork();

    expect(harness.client.request).toHaveBeenCalledOnce();
    expect(harness.workspace.displayFile).toHaveBeenCalledWith(secondUri);
    expect(harness.mappings[0]?.getMapping).toHaveBeenCalledWith(secondUri);
    expect(harness.mappings[0]?.mapPosition).toHaveBeenCalledWith(secondUri, {
      character: 9,
      line: 0,
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        scrollIntoView: true,
        selection: { anchor: 9, head: 15 },
        userEvent: "select.definition",
      })
    );
    expect(harness.mappings[0]?.destroy).toHaveBeenCalledOnce();
  });

  it("clears an active card through the public API and ignores repeated clears", async () => {
    const harness = createLspHarness();
    harness.responders.set("textDocument/definition", () =>
      Promise.resolve([
        location("file:///repo/alpha.ts"),
        location("file:///repo/beta.ts"),
      ])
    );
    const { view } = mountHover(harness);
    definitionMouseDown(view);
    await flushAsyncWork();
    expect(
      view.dom.querySelector('[data-slot="files-lsp-hover-card"]')
    ).not.toBeNull();

    clearFilesLspHover(view);
    await flushAsyncWork();
    expect(
      view.dom.querySelector('[data-slot="files-lsp-hover-card"]')
    ).toBeNull();
    clearFilesLspHover(view);
    expect(harness.mappings[0]?.destroy).toHaveBeenCalledOnce();
  });

  it("handles Escape only for an active card and restores editor focus", async () => {
    const harness = createLspHarness();
    harness.responders.set("textDocument/hover", () =>
      Promise.resolve(hover("Docs"))
    );
    const { view } = mountHover(harness);
    const inactiveEscape = modifierEvent(view, "keydown", { key: "Escape" });
    expect(inactiveEscape.defaultPrevented).toBe(false);

    movePointer(view);
    await vi.advanceTimersByTimeAsync(300);
    await flushAsyncWork();
    const dialog = view.dom.querySelector<HTMLElement>(
      '[data-slot="files-lsp-hover-card"]'
    );
    expect(dialog).not.toBeNull();
    view.focus();
    const activeEscape = modifierEvent(view, "keydown", { key: "Escape" });
    await flushAsyncWork();

    expect(activeEscape.defaultPrevented).toBe(true);
    expect(
      view.dom.querySelector('[data-slot="files-lsp-hover-card"]')
    ).toBeNull();
    expect(view.hasFocus).toBe(true);
  });

  it("queues manual intent before a resume transaction installs the plugin", async () => {
    const harness = createLspHarness();
    let view: EditorView | null = null;
    const prepareForManual = vi.fn(() => {
      lspPluginGetMock.mockReturnValue(harness.plugin);
      view?.dispatch({});
      return "pending" as const;
    });
    ({ view } = mountHover(harness, { prepareForManual }));
    lspPluginGetMock.mockReturnValue(null);

    const result = showFilesLspHover(view);
    await flushAsyncWork();

    await expect(result).resolves.toBe("shown");
    expect(prepareForManual).toHaveBeenCalledOnce();
    expect(harness.client.request.mock.calls.map(([method]) => method)).toEqual(
      ["textDocument/hover", "textDocument/definition"]
    );
  });

  it("reports terminal manual availability without using a stale plugin", async () => {
    const harness = createLspHarness();
    const prepareForManual = vi.fn(() => "unavailable" as const);
    const { view } = mountHover(harness, { prepareForManual });

    await expect(showFilesLspHover(view)).resolves.toBe("unavailable");

    expect(prepareForManual).toHaveBeenCalledOnce();
    expect(harness.client.request).not.toHaveBeenCalled();
  });

  it("cancels queued manual intent only for its owning editor view", async () => {
    const first = createLspHarness();
    const second = createLspHarness();
    const firstMounted = mountHover(first, {
      documentId: "shared-document",
      prepareForManual: () => "pending",
    });
    const secondMounted = mountHover(second, {
      documentId: "shared-document",
      prepareForManual: () => "pending",
    });
    lspPluginGetMock.mockReturnValue(null);

    await expect(showFilesLspHover(firstMounted.view)).resolves.toBe("queued");
    await expect(showFilesLspHover(secondMounted.view)).resolves.toBe("queued");
    cancelQueuedFilesLspHover(firstMounted.view);

    lspPluginGetMock.mockImplementation((candidateView: EditorView) => {
      if (candidateView === firstMounted.view) {
        return first.plugin;
      }
      return candidateView === secondMounted.view ? second.plugin : null;
    });
    firstMounted.view.dispatch({});
    secondMounted.view.dispatch({});
    await flushAsyncWork();

    expect(first.client.request).not.toHaveBeenCalled();
    expect(second.client.request.mock.calls.map(([method]) => method)).toEqual([
      "textDocument/hover",
      "textDocument/definition",
    ]);
  });

  it("reports manual hover availability and lets clear cancel its exact requests", async () => {
    const documentation = Promise.withResolvers<unknown>();
    const definition = Promise.withResolvers<unknown>();
    const harness = createLspHarness();
    harness.responders.set("textDocument/hover", () => documentation.promise);
    harness.responders.set("textDocument/definition", () => definition.promise);
    const { view } = mountHover(harness);
    const shown = showFilesLspHover(view);
    await Promise.resolve();
    const params = harness.client.request.mock.calls.map((call) => call[1]);

    clearFilesLspHover(view);
    expect(harness.client.cancelRequest.mock.calls).toHaveLength(2);
    expect(harness.client.cancelRequest.mock.calls[0]?.[0]).toBe(params[0]);
    expect(harness.client.cancelRequest.mock.calls[1]?.[0]).toBe(params[1]);
    documentation.resolve(null);
    definition.resolve([]);
    await expect(shown).resolves.toBe("shown");

    const plainView = new EditorView({
      parent: host,
      state: EditorState.create({ doc: SOURCE }),
    });
    mountedViews.add(plainView);
    await expect(showFilesLspHover(plainView)).resolves.toBe("unavailable");
    expect(() => clearFilesLspHover(plainView)).not.toThrow();
  });
});
