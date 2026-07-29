import { EditorState } from "@codemirror/state";
import type * as CodeMirrorViewModule from "@codemirror/view";
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

interface SessionRequest {
  filePath?: string;
  isWorktree?: boolean;
  rootPath: string;
  workspaceKey?: string;
}

interface EnsuredSession {
  languageId: string;
  ok: true;
  rootPath: string;
  serverId: string;
  sessionId: string;
  workspaceKey: string;
}

type SessionResult =
  | EnsuredSession
  | {
      ok: false;
      reason: string;
      rootPath: string;
      serverId?: string;
      workspaceKey: string;
    }
  | null;

interface ClosedEvent {
  reason: "closed" | "exited" | "failed";
  sessionId: string;
}

interface TestClient {
  connect: Mock;
  didClose: Mock;
  didOpen: Mock;
  disconnect: Mock;
  initializing: Promise<void>;
  plugin: Mock;
  workspace: unknown;
}

interface TestTransport {
  send: (message: string) => void;
}

const lspHarness = vi.hoisted(() => ({
  initializations: [] as Promise<void>[],
  instances: [] as TestClient[],
  operations: [] as string[],
}));

vi.mock("@codemirror/lsp-client", async () => {
  const { ViewPlugin } = (await vi.importActual(
    "@codemirror/view"
  )) as typeof CodeMirrorViewModule;

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

  class MockLspClient implements TestClient {
    readonly connect = vi.fn();
    readonly didClose = vi.fn((uri: string) => {
      lspHarness.operations.push(`didClose:${uri}`);
    });
    readonly didOpen = vi.fn();
    readonly disconnect = vi.fn(() => {
      lspHarness.operations.push("disconnect");
    });
    readonly initializing =
      lspHarness.initializations.shift() ?? Promise.resolve();
    readonly plugin: Mock;
    readonly workspace: unknown;

    constructor(config: {
      workspace: (client: MockLspClient) => unknown;
    }) {
      this.workspace = config.workspace(this);
      this.plugin = vi.fn((uri: string, languageId: string) => {
        const workspace = this.workspace as {
          closeFile: (uri: string, view: EditorView) => void;
          openFile: (uri: string, languageId: string, view: EditorView) => void;
        };
        return ViewPlugin.fromClass(
          class {
            readonly view: EditorView;

            constructor(view: EditorView) {
              this.view = view;
              workspace.openFile(uri, languageId, view);
            }

            destroy(): void {
              workspace.closeFile(uri, this.view);
            }
          }
        );
      });
      lspHarness.instances.push(this);
    }
  }

  return {
    findReferencesKeymap: [],
    formatKeymap: [],
    jumpToDefinitionKeymap: [],
    LSPClient: MockLspClient,
    LSPPlugin: { get: vi.fn() },
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
} from "../../../src/plugins/builtin/files/renderer/files-lsp-client.ts";

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

function ensuredSession(sessionId: string): EnsuredSession {
  return {
    languageId: "typescript",
    ok: true,
    rootPath: "/repo",
    serverId: "typescript",
    sessionId,
    workspaceKey: "main:/repo",
  };
}

interface FacadeFixture {
  close: Mock;
  emitClosed: (event: ClosedEvent) => void;
  emitPolicy: (enabled: boolean) => void;
  ensureSession: Mock;
  onClosed: Mock;
  onMessage: Mock;
  send: Mock;
}

function installFacade(): FacadeFixture {
  const closedListeners = new Set<(event: ClosedEvent) => void>();
  const policyListeners = new Set<(prefs: { enabled: boolean }) => void>();
  const close = vi.fn(async (sessionId: string) => {
    lspHarness.operations.push(`close:${sessionId}`);
    return true;
  });
  const ensureSession = vi.fn(
    (_request: SessionRequest): Promise<SessionResult> => Promise.resolve(null)
  );
  const onClosed = vi.fn((listener: (event: ClosedEvent) => void) => {
    closedListeners.add(listener);
    return () => {
      closedListeners.delete(listener);
    };
  });
  const onPolicyChanged = vi.fn(
    (listener: (prefs: { enabled: boolean }) => void) => {
      policyListeners.add(listener);
      return () => {
        policyListeners.delete(listener);
      };
    }
  );
  const onMessage = vi.fn().mockReturnValue(() => undefined);
  const send = vi.fn().mockResolvedValue(true);
  const facade = {
    close,
    ensureSession,
    onClosed,
    onMessage,
    onPolicyChanged,
    send,
  };
  const pier = { env: { platform: "darwin" }, lsp: facade };
  Object.assign(window, { pier });
  Object.assign(globalThis, { pier });

  return {
    close,
    emitClosed(event: ClosedEvent) {
      for (const listener of closedListeners) {
        listener(event);
      }
    },
    emitPolicy(enabled: boolean) {
      for (const listener of policyListeners) {
        listener({ enabled });
      }
    },
    ensureSession,
    onClosed,
    onMessage,
    send,
  };
}

async function flushMicrotasks(turns = 12): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve();
  }
}

function attachmentCount(): number {
  return lspHarness.instances.reduce(
    (count, client) => count + client.plugin.mock.calls.length,
    0
  );
}

describe("Files LSP renderer root lifecycle", () => {
  let facade: FacadeFixture;
  let host: HTMLElement;
  let views: EditorView[];

  beforeEach(() => {
    resetLspClientCacheForTests();
    lspHarness.initializations.length = 0;
    lspHarness.instances.length = 0;
    lspHarness.operations.length = 0;
    facade = installFacade();
    host = document.createElement("div");
    document.body.appendChild(host);
    views = [];
  });

  afterEach(() => {
    for (const view of views) {
      view.destroy();
    }
    host.remove();
    Reflect.deleteProperty(globalThis, "pier");
    Reflect.deleteProperty(window, "pier");
  });

  function createView(
    absolutePath = "/repo/main.ts",
    ownerId = `root-lifecycle-attachment-${views.length}`
  ): EditorView {
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "export const value = 1;",
        extensions: filesLspEditorExtensions({
          absolutePath,
          ownerId,
          rootPath: "/repo",
        }),
      }),
    });
    views.push(view);
    return view;
  }

  it("does not attach a deferred ensure result after preferences disable LSP", async () => {
    const pending = Promise.withResolvers<SessionResult>();
    facade.ensureSession.mockReturnValue(pending.promise);
    const view = createView();

    expect(facade.ensureSession).toHaveBeenCalledOnce();
    facade.emitPolicy(false);
    pending.resolve(ensuredSession("lsp-disabled-before-ensure"));
    await flushMicrotasks();

    expect(attachmentCount()).toBe(0);
    expect(facade.close).toHaveBeenCalledOnce();
    expect(facade.close).toHaveBeenCalledWith("lsp-disabled-before-ensure");

    view.destroy();
    await flushMicrotasks();
    expect(facade.close).toHaveBeenCalledOnce();
  });

  it("does not attach a client whose host closes during initialize", async () => {
    const initializing = Promise.withResolvers<void>();
    lspHarness.initializations.push(initializing.promise);
    facade.ensureSession.mockResolvedValue(
      ensuredSession("lsp-closed-during-initialize")
    );
    const view = createView();
    await flushMicrotasks();

    expect(lspHarness.instances).toHaveLength(1);
    expect(facade.onClosed).toHaveBeenCalledOnce();
    facade.emitClosed({
      reason: "exited",
      sessionId: "lsp-closed-during-initialize",
    });
    initializing.resolve(undefined);
    await flushMicrotasks();

    const client = lspHarness.instances[0];
    expect(client?.plugin).not.toHaveBeenCalled();
    expect(client?.disconnect).toHaveBeenCalledOnce();
    expect(facade.close).not.toHaveBeenCalled();

    view.destroy();
    await flushMicrotasks();
    expect(client?.disconnect).toHaveBeenCalledOnce();
  });

  it("closes a deferred ensure result after its view is destroyed", async () => {
    const pending = Promise.withResolvers<SessionResult>();
    facade.ensureSession.mockReturnValue(pending.promise);
    const view = createView();

    view.destroy();
    pending.resolve(ensuredSession("lsp-destroyed-before-ensure"));
    await flushMicrotasks();

    expect(attachmentCount()).toBe(0);
    expect(facade.close).toHaveBeenCalledOnce();
    expect(facade.close).toHaveBeenCalledWith("lsp-destroyed-before-ensure");

    view.destroy();
    await flushMicrotasks();
    expect(facade.close).toHaveBeenCalledOnce();
  });

  it("drains the queued didClose send before disposing the final root", async () => {
    const sendSettlement = Promise.withResolvers<boolean>();
    facade.send.mockImplementation(async () => {
      lspHarness.operations.push("send-invoked:textDocument/didClose");
      const sent = await sendSettlement.promise;
      lspHarness.operations.push("send-settled:textDocument/didClose");
      return sent;
    });
    facade.onClosed.mockImplementation(() => () => {
      lspHarness.operations.push("closed-listener-disposed");
    });
    facade.onMessage.mockImplementation(() => () => {
      lspHarness.operations.push("message-listener-disposed");
    });
    facade.ensureSession.mockResolvedValue(ensuredSession("lsp-final-release"));
    const view = createView();
    await flushMicrotasks();

    expect(lspHarness.instances).toHaveLength(1);
    const client = lspHarness.instances[0];
    if (!client) {
      throw new Error("Expected a ready LSP client");
    }
    expect(client.plugin).toHaveBeenCalledOnce();
    const transport: TestTransport | undefined =
      client.connect.mock.calls[0]?.[0];
    if (!transport) {
      throw new Error("Expected the ready client to have a transport");
    }
    client.didClose.mockImplementation((uri: string) => {
      lspHarness.operations.push(`didClose-called:${uri}`);
      transport.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "textDocument/didClose",
          params: { textDocument: { uri } },
        })
      );
    });
    lspHarness.operations.length = 0;

    view.destroy();
    await flushMicrotasks();

    expect(client.didClose).toHaveBeenCalledOnce();
    expect(client.didClose).toHaveBeenCalledWith("file:///repo/main.ts");
    expect(facade.send).toHaveBeenCalledOnce();
    expect(facade.send).toHaveBeenCalledWith(
      "lsp-final-release",
      expect.any(String)
    );
    expect(client.disconnect).not.toHaveBeenCalled();
    expect(facade.close).not.toHaveBeenCalled();
    expect(lspHarness.operations).toEqual([
      "didClose-called:file:///repo/main.ts",
      "send-invoked:textDocument/didClose",
    ]);

    sendSettlement.resolve(true);
    await flushMicrotasks();

    expect(client.didClose).toHaveBeenCalledOnce();
    expect(facade.send).toHaveBeenCalledOnce();
    expect(client.disconnect).toHaveBeenCalledOnce();
    expect(facade.close).toHaveBeenCalledOnce();
    expect(facade.close).toHaveBeenCalledWith("lsp-final-release");
    expect(lspHarness.operations).toEqual([
      "didClose-called:file:///repo/main.ts",
      "send-invoked:textDocument/didClose",
      "send-settled:textDocument/didClose",
      "closed-listener-disposed",
      "message-listener-disposed",
      "disconnect",
      "close:lsp-final-release",
    ]);
  });

  it("keeps a shared root open when one duplicate view releases it", async () => {
    facade.ensureSession.mockResolvedValue(
      ensuredSession("lsp-duplicate-view")
    );
    const first = createView();
    const second = createView();
    await flushMicrotasks();

    expect(lspHarness.instances).toHaveLength(1);
    const client = lspHarness.instances[0];
    expect(client?.plugin).toHaveBeenCalledTimes(2);
    expect(client?.didOpen).toHaveBeenCalledOnce();
    lspHarness.operations.length = 0;

    first.destroy();
    await flushMicrotasks();

    expect(client?.didClose).not.toHaveBeenCalled();
    expect(client?.disconnect).not.toHaveBeenCalled();
    expect(facade.close).not.toHaveBeenCalled();
    expect(lspHarness.operations).toEqual([]);

    second.destroy();
    await flushMicrotasks();
    expect(client?.didClose).toHaveBeenCalledOnce();
    expect(client?.disconnect).toHaveBeenCalledOnce();
    expect(facade.close).toHaveBeenCalledOnce();
  });

  it("does not close a stale ensure when the current ensure reuses its session", async () => {
    const staleEnsure = Promise.withResolvers<SessionResult>();
    const currentEnsure = Promise.withResolvers<SessionResult>();
    facade.ensureSession
      .mockReturnValueOnce(staleEnsure.promise)
      .mockReturnValueOnce(currentEnsure.promise);
    const view = createView();

    expect(facade.ensureSession).toHaveBeenCalledOnce();
    facade.emitPolicy(false);
    facade.emitPolicy(true);
    expect(facade.ensureSession).toHaveBeenCalledTimes(2);

    staleEnsure.resolve(ensuredSession("lsp-reused-session"));
    await flushMicrotasks();

    expect(facade.close).not.toHaveBeenCalled();
    expect(lspHarness.instances).toHaveLength(0);
    expect(attachmentCount()).toBe(0);

    currentEnsure.resolve(ensuredSession("lsp-reused-session"));
    await flushMicrotasks();

    expect(lspHarness.instances).toHaveLength(1);
    const client = lspHarness.instances[0];
    expect(client?.plugin).toHaveBeenCalledOnce();
    expect(facade.close).not.toHaveBeenCalled();

    lspHarness.operations.length = 0;
    view.destroy();
    await flushMicrotasks();

    expect(client?.didClose).toHaveBeenCalledOnce();
    expect(client?.didClose).toHaveBeenCalledWith("file:///repo/main.ts");
    expect(client?.disconnect).toHaveBeenCalledOnce();
    expect(facade.close).toHaveBeenCalledOnce();
    expect(facade.close).toHaveBeenCalledWith("lsp-reused-session");
    expect(lspHarness.operations).toEqual([
      "didClose:file:///repo/main.ts",
      "disconnect",
      "close:lsp-reused-session",
    ]);
  });

  it("keeps a current session when a stale ensure resolves first", async () => {
    const staleEnsure = Promise.withResolvers<SessionResult>();
    const currentEnsure = Promise.withResolvers<SessionResult>();
    facade.ensureSession
      .mockReturnValueOnce(staleEnsure.promise)
      .mockReturnValueOnce(currentEnsure.promise);
    const view = createView();

    expect(facade.ensureSession).toHaveBeenCalledOnce();
    facade.emitPolicy(false);
    facade.emitPolicy(true);
    expect(facade.ensureSession).toHaveBeenCalledTimes(2);

    staleEnsure.resolve(ensuredSession("lsp-stale-generation"));
    await flushMicrotasks();

    expect(facade.close).not.toHaveBeenCalled();
    expect(lspHarness.instances).toHaveLength(0);
    expect(attachmentCount()).toBe(0);

    currentEnsure.resolve(ensuredSession("lsp-current-generation"));
    await flushMicrotasks();
    expect(facade.close).toHaveBeenCalledOnce();
    expect(facade.close).toHaveBeenCalledWith("lsp-stale-generation");

    expect(lspHarness.instances).toHaveLength(1);
    const client = lspHarness.instances[0];
    expect(client?.plugin).toHaveBeenCalledOnce();
    expect(facade.close).toHaveBeenCalledOnce();
    expect(facade.close).not.toHaveBeenCalledWith("lsp-current-generation");

    lspHarness.operations.length = 0;
    view.destroy();
    await flushMicrotasks();

    expect(facade.close).toHaveBeenCalledTimes(2);
    expect(facade.close).toHaveBeenNthCalledWith(2, "lsp-current-generation");
    expect(lspHarness.operations).toEqual([
      "didClose:file:///repo/main.ts",
      "disconnect",
      "close:lsp-current-generation",
    ]);
  });

  it("hands a ready root to a replacement view without closing its session", async () => {
    facade.ensureSession.mockResolvedValue(
      ensuredSession("lsp-ready-root-handoff")
    );
    const first = createView("/repo/a.ts");
    await flushMicrotasks();

    expect(lspHarness.instances).toHaveLength(1);
    const client = lspHarness.instances[0];
    expect(client?.plugin).toHaveBeenCalledOnce();

    first.destroy();
    const second = createView("/repo/b.ts");
    await flushMicrotasks();

    expect(lspHarness.instances).toHaveLength(1);
    expect(client?.plugin).toHaveBeenCalledTimes(2);
    expect(client?.plugin).toHaveBeenLastCalledWith(
      "file:///repo/b.ts",
      "typescript"
    );
    expect(facade.close).not.toHaveBeenCalled();

    second.destroy();
    await flushMicrotasks();
    expect(facade.close).toHaveBeenCalledOnce();
    expect(facade.close).toHaveBeenCalledWith("lsp-ready-root-handoff");
  });

  it("keeps a session open when a stale file resolves before a valid file sharing its root", async () => {
    const fileAEnsure = Promise.withResolvers<SessionResult>();
    const fileBEnsure = Promise.withResolvers<SessionResult>();
    facade.ensureSession.mockImplementation(
      (request: SessionRequest): Promise<SessionResult> => {
        if (request.filePath === "/repo/a.ts") {
          return fileAEnsure.promise;
        }
        if (request.filePath === "/repo/b.ts") {
          return fileBEnsure.promise;
        }
        throw new Error(`Unexpected file path: ${request.filePath}`);
      }
    );
    const fileAView = createView("/repo/a.ts");
    const fileBView = createView("/repo/b.ts");

    expect(facade.ensureSession).toHaveBeenCalledTimes(2);
    fileAView.destroy();
    fileAEnsure.resolve(ensuredSession("lsp-cross-file-root"));
    await flushMicrotasks();

    expect(facade.close).not.toHaveBeenCalled();

    fileBEnsure.resolve(ensuredSession("lsp-cross-file-root"));
    await flushMicrotasks();

    expect(lspHarness.instances).toHaveLength(1);
    const client = lspHarness.instances[0];
    expect(client?.plugin).toHaveBeenCalledOnce();
    expect(client?.plugin).toHaveBeenCalledWith(
      "file:///repo/b.ts",
      "typescript"
    );
    expect(facade.close).not.toHaveBeenCalled();

    lspHarness.operations.length = 0;
    fileBView.destroy();
    await flushMicrotasks();

    expect(client?.didClose).toHaveBeenCalledOnce();
    expect(client?.didClose).toHaveBeenCalledWith("file:///repo/b.ts");
    expect(client?.disconnect).toHaveBeenCalledOnce();
    expect(facade.close).toHaveBeenCalledOnce();
    expect(facade.close).toHaveBeenCalledWith("lsp-cross-file-root");
    expect(lspHarness.operations).toEqual([
      "didClose:file:///repo/b.ts",
      "disconnect",
      "close:lsp-cross-file-root",
    ]);
  });

  it("adopts an initializing root when its original file becomes stale", async () => {
    const initializing = Promise.withResolvers<void>();
    const fileAEnsure = Promise.withResolvers<SessionResult>();
    const fileBEnsure = Promise.withResolvers<SessionResult>();
    lspHarness.initializations.push(initializing.promise);
    facade.ensureSession.mockImplementation(
      (request: SessionRequest): Promise<SessionResult> => {
        if (request.filePath === "/repo/a.ts") {
          return fileAEnsure.promise;
        }
        if (request.filePath === "/repo/b.ts") {
          return fileBEnsure.promise;
        }
        throw new Error(`Unexpected file path: ${request.filePath}`);
      }
    );
    const fileAView = createView("/repo/a.ts");

    fileAEnsure.resolve(ensuredSession("lsp-initializing-root"));
    await flushMicrotasks();

    expect(lspHarness.instances).toHaveLength(1);
    const client = lspHarness.instances[0];
    expect(client?.plugin).not.toHaveBeenCalled();
    expect(facade.close).not.toHaveBeenCalled();

    fileAView.destroy();
    const fileBView = createView("/repo/b.ts");
    fileBEnsure.resolve(ensuredSession("lsp-initializing-root"));
    await flushMicrotasks();

    expect(lspHarness.instances).toHaveLength(1);
    expect(client?.plugin).not.toHaveBeenCalled();
    expect(facade.close).not.toHaveBeenCalled();

    initializing.resolve(undefined);
    await flushMicrotasks();

    expect(lspHarness.instances).toHaveLength(1);
    expect(client?.plugin).toHaveBeenCalledOnce();
    expect(client?.plugin).toHaveBeenCalledWith(
      "file:///repo/b.ts",
      "typescript"
    );
    expect(facade.close).not.toHaveBeenCalled();

    lspHarness.operations.length = 0;
    fileBView.destroy();
    await flushMicrotasks();

    expect(client?.didClose).toHaveBeenCalledOnce();
    expect(client?.didClose).toHaveBeenCalledWith("file:///repo/b.ts");
    expect(client?.disconnect).toHaveBeenCalledOnce();
    expect(facade.close).toHaveBeenCalledOnce();
    expect(facade.close).toHaveBeenCalledWith("lsp-initializing-root");
    expect(lspHarness.operations).toEqual([
      "didClose:file:///repo/b.ts",
      "disconnect",
      "close:lsp-initializing-root",
    ]);
  });
});
