import { ChangeSet, EditorState, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";

interface TestWorkspaceFile {
  doc: Text;
  getView: (main?: EditorView) => EditorView | null;
  uri: string;
  version: number;
}

interface TestWorkspace {
  closeFile: (uri: string, view: EditorView) => void;
  files: TestWorkspaceFile[];
  getFile: (uri: string) => TestWorkspaceFile | null;
  openFile: (uri: string, languageId: string, view: EditorView) => void;
  syncFiles: () => readonly unknown[];
}

interface TestEditorPlugin {
  clear: Mock;
  unsyncedChanges: ChangeSet;
}

const lspMocks = vi.hoisted(() => ({
  didClose: vi.fn(),
  didOpen: vi.fn(),
  getPlugin: vi.fn(),
  workspace: null as unknown,
}));

vi.mock("@codemirror/lsp-client", () => {
  class MockWorkspace {
    readonly client: unknown;
    files: Array<{ uri: string }> = [];

    constructor(client: unknown) {
      this.client = client;
    }

    getFile(uri: string) {
      return this.files.find((file) => file.uri === uri) ?? null;
    }
  }

  class MockLspClient {
    readonly initializing = Promise.resolve();
    readonly workspace: unknown;

    constructor(config: {
      workspace: (client: MockLspClient) => unknown;
    }) {
      this.workspace = config.workspace(this);
      lspMocks.workspace = this.workspace;
    }

    connect() {}
    didClose = lspMocks.didClose;
    didOpen = lspMocks.didOpen;
    disconnect() {}
    plugin() {
      return [];
    }
  }

  return {
    findReferencesKeymap: [],
    formatKeymap: [],
    jumpToDefinitionKeymap: [],
    LSPClient: MockLspClient,
    LSPPlugin: { get: lspMocks.getPlugin },
    renameKeymap: [],
    serverCompletion: () => [],
    serverDiagnostics: () => [],
    signatureHelp: () => [],
    Workspace: MockWorkspace,
  };
});

import {
  filesLspEditorExtensions as productionFilesLspEditorExtensions,
  resetLspClientCacheForTests,
} from "../../../../../src/plugins/builtin/files/renderer/lsp/client.ts";

type TestFilesLspExtensionInput = Omit<
  Parameters<typeof productionFilesLspEditorExtensions>[0],
  "documentId" | "getOpenExternal" | "ownerId"
> & {
  documentId?: string;
  ownerId?: string;
};

const openExternal = () => undefined;
const getOpenExternal = () => openExternal;

function filesLspEditorExtensions(input: TestFilesLspExtensionInput) {
  const {
    absolutePath,
    documentId = absolutePath,
    ownerId = absolutePath,
    ...options
  } = input;
  return productionFilesLspEditorExtensions({
    ...options,
    absolutePath,
    documentId,
    getOpenExternal,
    ownerId,
  });
}

const uri = "file:///repo/main.ts";
let host: HTMLElement;
let views: EditorView[];
let plugins: WeakMap<EditorView, TestEditorPlugin>;

function editorPlugin(view: EditorView, changes: ChangeSet) {
  const plugin = {
    clear: vi.fn(() => {
      plugin.unsyncedChanges = ChangeSet.empty(view.state.doc.length);
    }),
    unsyncedChanges: changes,
  };
  return plugin;
}

async function createWorkspaceView(doc = "const value = 1;") {
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      extensions: filesLspEditorExtensions({
        absolutePath: "/repo/main.ts",
        rootPath: "/repo",
      }),
    }),
  });
  views.push(view);
  await vi.waitFor(() => {
    expect(lspMocks.workspace).not.toBeNull();
  });
  return view;
}

function createPlainView(doc = "const value = 1;") {
  const view = new EditorView({
    parent: host,
    state: EditorState.create({ doc }),
  });
  views.push(view);
  return view;
}

function installFacade() {
  const facade = {
    close: vi.fn().mockResolvedValue(true),
    ensureSession: vi.fn().mockResolvedValue({
      languageId: "typescript",
      ok: true,
      rootPath: "/repo",
      serverId: "typescript",
      sessionId: "lsp-multiview",
      workspaceKey: "main:/repo",
    }),
    onClosed: vi.fn().mockReturnValue(() => undefined),
    onMessage: vi.fn().mockReturnValue(() => undefined),
    onPolicyChanged: vi.fn().mockReturnValue(() => undefined),
    send: vi.fn().mockResolvedValue(true),
  };
  const pier = { env: { platform: "darwin" }, lsp: facade };
  Object.assign(window, { pier });
  Object.assign(globalThis, { pier });
}

describe("Files LSP workspace multi-view lifecycle", () => {
  beforeEach(() => {
    resetLspClientCacheForTests();
    installFacade();
    host = document.createElement("div");
    document.body.appendChild(host);
    views = [];
    plugins = new WeakMap();
    lspMocks.workspace = null;
    lspMocks.didOpen.mockReset();
    lspMocks.didClose.mockReset();
    lspMocks.getPlugin.mockReset();
    lspMocks.getPlugin.mockImplementation((view: EditorView) =>
      plugins.get(view)
    );
  });

  afterEach(() => {
    for (const view of views) {
      view.destroy();
    }
    host.remove();
    Reflect.deleteProperty(globalThis, "pier");
    Reflect.deleteProperty(window, "pier");
  });

  it("keeps the document open and synchronized until its last view closes", async () => {
    const first = await createWorkspaceView();
    const second = createPlainView();
    const lspWorkspace = lspMocks.workspace as TestWorkspace;

    lspWorkspace.openFile(uri, "typescript", first);
    lspWorkspace.openFile(uri, "typescript", second);

    expect(lspMocks.didOpen).toHaveBeenCalledTimes(1);
    expect(lspWorkspace.files).toHaveLength(1);
    expect(lspWorkspace.getFile(uri)?.getView()).toBe(first);
    expect(lspWorkspace.getFile(uri)?.getView(second)).toBe(second);

    lspWorkspace.closeFile(uri, first);

    expect(lspMocks.didClose).not.toHaveBeenCalled();
    expect(lspWorkspace.getFile(uri)?.getView()).toBe(second);

    const transaction = second.state.update({
      changes: { from: second.state.doc.length, insert: "\nexport {};" },
    });
    second.dispatch(transaction);
    const plugin = editorPlugin(second, transaction.changes);
    plugins.set(second, plugin);

    expect(lspWorkspace.syncFiles()).toHaveLength(1);
    expect(lspWorkspace.getFile(uri)?.doc.toString()).toBe(
      "const value = 1;\nexport {};"
    );
    expect(lspWorkspace.getFile(uri)?.version).toBe(1);
    expect(plugin.clear).toHaveBeenCalledTimes(1);

    lspWorkspace.closeFile(uri, second);

    expect(lspMocks.didClose).toHaveBeenCalledOnce();
    expect(lspMocks.didClose).toHaveBeenCalledWith(uri);
    expect(lspWorkspace.getFile(uri)).toBeNull();
  });

  it("coalesces the same synchronized edit reported by duplicate views", async () => {
    const first = await createWorkspaceView();
    const second = createPlainView();
    const lspWorkspace = lspMocks.workspace as TestWorkspace;
    lspWorkspace.openFile(uri, "typescript", first);
    lspWorkspace.openFile(uri, "typescript", second);

    const firstTransaction = first.state.update({
      changes: { from: first.state.doc.length, insert: "\nexport {};" },
    });
    const secondTransaction = second.state.update({
      changes: { from: second.state.doc.length, insert: "\nexport {};" },
    });
    first.dispatch(firstTransaction);
    second.dispatch(secondTransaction);
    const firstPlugin = editorPlugin(first, firstTransaction.changes);
    const secondPlugin = editorPlugin(second, secondTransaction.changes);
    plugins.set(first, firstPlugin);
    plugins.set(second, secondPlugin);

    expect(lspWorkspace.syncFiles()).toHaveLength(1);
    expect(firstPlugin.clear).toHaveBeenCalledTimes(1);
    expect(secondPlugin.clear).toHaveBeenCalledTimes(1);
    expect(lspWorkspace.syncFiles()).toHaveLength(0);
    expect(lspWorkspace.getFile(uri)?.version).toBe(1);
  });
});
