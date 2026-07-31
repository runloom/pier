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

interface DeniedSession {
  ok: false;
  reason: string;
  rootPath: string;
  serverId?: string;
  workspaceKey: string;
}

type SessionResult = EnsuredSession | DeniedSession | null;

type ClosedEvent =
  | { reason: "exited" | "failed"; sessionId: string }
  | {
      cause:
        | "client-release"
        | "policy-disabled"
        | "workspace-evicted"
        | "idle-release"
        | "owner-destroyed"
        | "app-quit";
      reason: "closed";
      sessionId: string;
    };

interface TestTransport {
  send(message: string): void;
}

interface TestClient {
  connect: Mock;
  didClose: Mock;
  didOpen: Mock;
  disconnect: Mock;
  initializing: Promise<void>;
  plugin: Mock;
  transport: TestTransport | null;
  workspace: unknown;
}

const lspHarness = vi.hoisted(() => ({
  initializations: [] as Promise<void>[],
  instances: [] as TestClient[],
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
    readonly connect = vi.fn((transport: TestTransport) => {
      this.transport = transport;
    });
    readonly didClose = vi.fn();
    readonly didOpen = vi.fn();
    readonly disconnect = vi.fn();
    readonly initializing =
      lspHarness.initializations.shift() ?? Promise.resolve();
    readonly plugin: Mock;
    transport: TestTransport | null = null;
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
  filesLspEditorExtensions,
  resetLspClientCacheForTests,
} from "../../../../../src/plugins/builtin/files/renderer/lsp/client.ts";
import { showFilesLspHover } from "../../../../../src/plugins/builtin/files/renderer/lsp/hover.ts";
import {
  type FilesLanguageServiceStatus,
  getFilesLanguageServiceStatus,
  resetFilesLanguageServiceStatusForTests,
  subscribeFilesLanguageServiceStatus,
} from "../../../../../src/plugins/builtin/files/renderer/panel/language-service-status.ts";

function ensuredSession(sessionId: string, rootPath = "/repo"): EnsuredSession {
  return {
    languageId: "typescript",
    ok: true,
    rootPath,
    serverId: "typescript",
    sessionId,
    workspaceKey: `main:${rootPath}`,
  };
}

interface FacadeFixture {
  close: Mock;
  emitClosed: (event: ClosedEvent) => void;
  emitPolicy: (enabled: boolean) => void;
  ensureSession: Mock;
  send: Mock;
}

function installFacade(): FacadeFixture {
  const closedListeners = new Set<(event: ClosedEvent) => void>();
  const policyListeners = new Set<
    (prefs: {
      enabled: boolean;
      idleReleaseMs: number;
      maxLocalWorkspaces: number;
      maxRemoteWorkspaces: number;
      worktreesEnabled: boolean;
    }) => void
  >();
  const close = vi.fn(async (_sessionId: string, _cause?: string) => true);
  const ensureSession = vi.fn(
    (_request: SessionRequest): Promise<SessionResult> => Promise.resolve(null)
  );
  const send = vi.fn(async (_sessionId: string, _message: string) => true);
  const facade = {
    close,
    ensureSession,
    onClosed: vi.fn((listener: (event: ClosedEvent) => void) => {
      closedListeners.add(listener);
      return () => {
        closedListeners.delete(listener);
      };
    }),
    onMessage: vi.fn().mockReturnValue(() => undefined),
    onPolicyChanged: vi.fn(
      (
        listener: (prefs: {
          enabled: boolean;
          idleReleaseMs: number;
          maxLocalWorkspaces: number;
          maxRemoteWorkspaces: number;
          worktreesEnabled: boolean;
        }) => void
      ) => {
        policyListeners.add(listener);
        return () => {
          policyListeners.delete(listener);
        };
      }
    ),
    send,
  };
  const pier = { env: { platform: "darwin" }, lsp: facade };
  Object.assign(window, { pier });
  Object.assign(globalThis, { pier });

  return {
    close,
    emitClosed(event) {
      for (const listener of closedListeners) {
        listener(event);
      }
    },
    emitPolicy(enabled) {
      const prefs = {
        enabled,
        idleReleaseMs: 1_800_000,
        maxLocalWorkspaces: 3,
        maxRemoteWorkspaces: 2,
        worktreesEnabled: false,
      };
      for (const listener of policyListeners) {
        listener(prefs);
      }
    },
    ensureSession,
    send,
  };
}

async function flushMicrotasks(turns = 16): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await Promise.resolve();
  }
}

function status(ownerId: string, documentId: string) {
  return getFilesLanguageServiceStatus(ownerId, documentId);
}

const openExternal = () => undefined;
const getOpenExternal = () => openExternal;

describe("Files LSP root recovery", () => {
  let facade: FacadeFixture;
  let host: HTMLElement;
  let views: EditorView[];

  beforeEach(() => {
    vi.useFakeTimers();
    resetLspClientCacheForTests();
    resetFilesLanguageServiceStatusForTests();
    lspHarness.initializations.length = 0;
    lspHarness.instances.length = 0;
    facade = installFacade();
    host = document.createElement("div");
    document.body.appendChild(host);
    views = [];
  });

  afterEach(async () => {
    for (const view of views) {
      view.destroy();
    }
    await flushMicrotasks();
    host.remove();
    Reflect.deleteProperty(globalThis, "pier");
    Reflect.deleteProperty(window, "pier");
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function createView(
    input: {
      absolutePath?: string;
      documentId?: string;
      ownerId?: string;
      rootPath?: string;
    } = {}
  ): EditorView {
    const absolutePath = input.absolutePath ?? "/repo/main.ts";
    const documentId = input.documentId ?? "document-main";
    const ownerId = input.ownerId ?? "editor-main";
    const rootPath = input.rootPath ?? "/repo";
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "export const value = 1;",
        extensions: filesLspEditorExtensions({
          absolutePath,
          documentId,
          getOpenExternal,
          ownerId,
          rootPath,
        }),
      }),
    });
    views.push(view);
    return view;
  }

  async function startReady(
    sessionId = "lsp-initial",
    identity: {
      absolutePath?: string;
      documentId?: string;
      ownerId?: string;
      rootPath?: string;
    } = {}
  ): Promise<EditorView> {
    facade.ensureSession.mockResolvedValue(
      ensuredSession(sessionId, identity.rootPath)
    );
    const view = createView(identity);
    await flushMicrotasks();
    expect(
      status(
        identity.ownerId ?? "editor-main",
        identity.documentId ?? "document-main"
      )
    ).toEqual({
      serverId: "typescript",
      state: "ready",
    });
    return view;
  }

  it("shares one retry timer, replacement ensure, and replacement client across two views", async () => {
    facade.ensureSession.mockResolvedValue(ensuredSession("lsp-shared-1"));
    createView({ documentId: "document-a", ownerId: "editor-a" });
    createView({ documentId: "document-b", ownerId: "editor-b" });
    await flushMicrotasks();

    expect(lspHarness.instances).toHaveLength(1);
    expect(lspHarness.instances[0]?.plugin).toHaveBeenCalledTimes(2);
    facade.ensureSession.mockClear();
    const replacement = Promise.withResolvers<SessionResult>();
    facade.ensureSession.mockReturnValue(replacement.promise);

    facade.emitClosed({ reason: "exited", sessionId: "lsp-shared-1" });

    const retrying = {
      attempt: 1,
      delayMs: 250,
      reason: "exited",
      serverId: "typescript",
      state: "retrying",
    };
    expect(status("editor-a", "document-a")).toEqual(retrying);
    expect(status("editor-b", "document-b")).toEqual(retrying);
    await vi.advanceTimersByTimeAsync(249);
    expect(facade.ensureSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(facade.ensureSession).toHaveBeenCalledOnce();

    replacement.resolve(ensuredSession("lsp-shared-2"));
    await flushMicrotasks();

    expect(lspHarness.instances).toHaveLength(2);
    expect(lspHarness.instances[1]?.plugin).toHaveBeenCalledTimes(2);
    expect(status("editor-a", "document-a")).toEqual({
      serverId: "typescript",
      state: "ready",
    });
    expect(status("editor-b", "document-b")).toEqual({
      serverId: "typescript",
      state: "ready",
    });
  });

  it("uses exactly 250, 1000, and 4000 ms and stops after three failed replacements", async () => {
    await startReady("lsp-budget-1");
    facade.ensureSession.mockClear();
    facade.ensureSession.mockResolvedValue({
      ok: false,
      reason: "launch-failed",
      rootPath: "/repo",
      serverId: "typescript",
      workspaceKey: "main:/repo",
    });

    facade.emitClosed({ reason: "failed", sessionId: "lsp-budget-1" });
    expect(status("editor-main", "document-main")).toEqual({
      attempt: 1,
      delayMs: 250,
      reason: "failed",
      serverId: "typescript",
      state: "retrying",
    });

    await vi.advanceTimersByTimeAsync(249);
    expect(facade.ensureSession).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(facade.ensureSession).toHaveBeenCalledTimes(1);
    expect(status("editor-main", "document-main")).toEqual({
      attempt: 2,
      delayMs: 1000,
      reason: "failed",
      serverId: "typescript",
      state: "retrying",
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(facade.ensureSession).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(facade.ensureSession).toHaveBeenCalledTimes(2);
    expect(status("editor-main", "document-main")).toEqual({
      attempt: 3,
      delayMs: 4000,
      reason: "failed",
      serverId: "typescript",
      state: "retrying",
    });

    await vi.advanceTimersByTimeAsync(3999);
    expect(facade.ensureSession).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(facade.ensureSession).toHaveBeenCalledTimes(3);
    expect(status("editor-main", "document-main")).toEqual({
      reason: "retry-exhausted",
      serverId: "typescript",
      state: "error",
    });

    await vi.advanceTimersByTimeAsync(120_000);
    expect(facade.ensureSession).toHaveBeenCalledTimes(3);
  });

  it("does not retry a generation that never became ready", async () => {
    const initializing = Promise.withResolvers<void>();
    lspHarness.initializations.push(initializing.promise);
    facade.ensureSession.mockResolvedValue(ensuredSession("lsp-not-ready"));
    createView();
    await flushMicrotasks();
    expect(status("editor-main", "document-main")?.state).toBe("starting");
    facade.ensureSession.mockClear();

    facade.emitClosed({ reason: "failed", sessionId: "lsp-not-ready" });
    initializing.resolve(undefined);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(facade.ensureSession).not.toHaveBeenCalled();
    expect(status("editor-main", "document-main")?.state).not.toBe("retrying");
  });

  it("resets the retry budget only after a replacement stays ready for 30 seconds", async () => {
    await startReady("lsp-reset-1");
    facade.ensureSession.mockClear();
    facade.ensureSession.mockResolvedValueOnce(ensuredSession("lsp-reset-2"));

    facade.emitClosed({ reason: "exited", sessionId: "lsp-reset-1" });
    await vi.advanceTimersByTimeAsync(250);
    await flushMicrotasks();
    expect(status("editor-main", "document-main")?.state).toBe("ready");

    facade.emitClosed({ reason: "failed", sessionId: "lsp-reset-1" });
    expect(status("editor-main", "document-main")?.state).toBe("ready");

    facade.ensureSession.mockResolvedValueOnce(ensuredSession("lsp-reset-3"));
    facade.emitClosed({ reason: "failed", sessionId: "lsp-reset-2" });
    expect(status("editor-main", "document-main")).toEqual({
      attempt: 2,
      delayMs: 1000,
      reason: "failed",
      serverId: "typescript",
      state: "retrying",
    });
    await vi.advanceTimersByTimeAsync(1000);
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(29_999);
    facade.emitClosed({ reason: "exited", sessionId: "lsp-reset-3" });
    expect(status("editor-main", "document-main")).toEqual({
      attempt: 3,
      delayMs: 4000,
      reason: "exited",
      serverId: "typescript",
      state: "retrying",
    });

    facade.ensureSession.mockResolvedValueOnce(ensuredSession("lsp-reset-4"));
    await vi.advanceTimersByTimeAsync(4000);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(30_000);

    facade.emitClosed({ reason: "failed", sessionId: "lsp-reset-4" });
    expect(status("editor-main", "document-main")).toEqual({
      attempt: 1,
      delayMs: 250,
      reason: "failed",
      serverId: "typescript",
      state: "retrying",
    });
  });

  it("ignores stale retry timers and stale ensure promises after a policy generation change", async () => {
    await startReady("lsp-stale-1");
    facade.ensureSession.mockClear();

    facade.emitClosed({ reason: "exited", sessionId: "lsp-stale-1" });
    facade.emitPolicy(false);
    expect(status("editor-main", "document-main")).toEqual({
      reason: "globally-disabled",
      state: "disabled",
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(facade.ensureSession).not.toHaveBeenCalled();

    const stale = Promise.withResolvers<SessionResult>();
    const current = Promise.withResolvers<SessionResult>();
    facade.ensureSession
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    facade.emitPolicy(true);
    expect(facade.ensureSession).toHaveBeenCalledOnce();

    facade.emitPolicy(false);
    facade.emitPolicy(true);
    expect(facade.ensureSession).toHaveBeenCalledTimes(2);
    current.resolve(ensuredSession("lsp-stale-current"));
    await flushMicrotasks();
    expect(status("editor-main", "document-main")?.state).toBe("ready");
    expect(lspHarness.instances).toHaveLength(2);

    stale.resolve(ensuredSession("lsp-stale-old"));
    await flushMicrotasks();
    expect(lspHarness.instances).toHaveLength(2);
    expect(facade.close).toHaveBeenCalledWith("lsp-stale-old");
    expect(status("editor-main", "document-main")?.state).toBe("ready");
  });

  it("cancels retry and stable-reset timers when the last view releases the root", async () => {
    facade.ensureSession.mockImplementation((request: SessionRequest) => {
      if (request.rootPath === "/other") {
        return Promise.resolve(ensuredSession("lsp-reset-release-1", "/other"));
      }
      return Promise.resolve(ensuredSession("lsp-retry-release-1"));
    });
    const retryView = createView({
      documentId: "document-retry",
      ownerId: "editor-retry",
    });
    const resetView = createView({
      absolutePath: "/other/main.ts",
      documentId: "document-reset",
      ownerId: "editor-reset",
      rootPath: "/other",
    });
    await flushMicrotasks();
    facade.ensureSession.mockClear();

    facade.emitClosed({ reason: "exited", sessionId: "lsp-retry-release-1" });
    retryView.destroy();
    views = views.filter((view) => view !== retryView);

    facade.ensureSession.mockResolvedValue(
      ensuredSession("lsp-reset-release-2", "/other")
    );
    facade.emitClosed({ reason: "failed", sessionId: "lsp-reset-release-1" });
    await vi.advanceTimersByTimeAsync(250);
    await flushMicrotasks();
    expect(facade.ensureSession).toHaveBeenCalledOnce();
    expect(status("editor-reset", "document-reset")?.state).toBe("ready");

    resetView.destroy();
    views = views.filter((view) => view !== resetView);
    await flushMicrotasks();
    expect(status("editor-retry", "document-retry")).toBeNull();
    expect(status("editor-reset", "document-reset")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(facade.ensureSession).toHaveBeenCalledOnce();
  });

  it.each([
    ["false", false],
    ["reject", new Error("bridge rejected send")],
  ] as const)("turns a facade send %s into one send-failed transition and dedupes the later close", async (_label, outcome) => {
    await startReady("lsp-send-failure");
    facade.ensureSession.mockClear();
    facade.ensureSession.mockResolvedValue(
      ensuredSession("lsp-send-replacement")
    );
    if (outcome === false) {
      facade.send.mockResolvedValueOnce(false);
    } else {
      facade.send.mockRejectedValueOnce(outcome);
    }
    const transitions: Array<FilesLanguageServiceStatus | null> = [];
    const unsubscribe = subscribeFilesLanguageServiceStatus(() => {
      transitions.push(status("editor-main", "document-main"));
    });

    lspHarness.instances[0]?.transport?.send(
      '{"jsonrpc":"2.0","method":"textDocument/didChange"}'
    );
    await flushMicrotasks();

    expect(status("editor-main", "document-main")).toEqual({
      attempt: 1,
      delayMs: 250,
      reason: "send-failed",
      serverId: "typescript",
      state: "retrying",
    });
    expect(
      transitions.filter(
        (value) => value?.state === "retrying" && value.reason === "send-failed"
      )
    ).toHaveLength(1);
    const transitionCountAfterSend = transitions.length;

    facade.emitClosed({ reason: "failed", sessionId: "lsp-send-failure" });
    expect(status("editor-main", "document-main")).toEqual({
      attempt: 1,
      delayMs: 250,
      reason: "send-failed",
      serverId: "typescript",
      state: "retrying",
    });
    expect(transitions).toHaveLength(transitionCountAfterSend);
    await vi.advanceTimersByTimeAsync(250);
    await flushMicrotasks();
    expect(facade.ensureSession).toHaveBeenCalledOnce();
    unsubscribe();
  });

  describe("closed cause table", () => {
    it.each([
      "exited",
      "failed",
    ] as const)("%s automatically retries a ready generation", async (reason) => {
      await startReady(`lsp-abnormal-${reason}`);
      facade.ensureSession.mockClear();
      facade.ensureSession.mockResolvedValue(
        ensuredSession(`lsp-abnormal-${reason}-replacement`)
      );

      facade.emitClosed({ reason, sessionId: `lsp-abnormal-${reason}` });
      expect(status("editor-main", "document-main")).toEqual({
        attempt: 1,
        delayMs: 250,
        reason,
        serverId: "typescript",
        state: "retrying",
      });
      await vi.advanceTimersByTimeAsync(250);
      await flushMicrotasks();
      expect(facade.ensureSession).toHaveBeenCalledOnce();
      expect(status("editor-main", "document-main")?.state).toBe("ready");
    });

    it("maps policy-disabled to disabled and waits for policy re-enable", async () => {
      await startReady("lsp-policy-disabled");
      facade.ensureSession.mockClear();
      facade.ensureSession.mockResolvedValue(
        ensuredSession("lsp-policy-reenabled")
      );

      facade.emitClosed({
        cause: "policy-disabled",
        reason: "closed",
        sessionId: "lsp-policy-disabled",
      });
      expect(status("editor-main", "document-main")).toEqual({
        reason: "globally-disabled",
        state: "disabled",
      });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(facade.ensureSession).not.toHaveBeenCalled();

      facade.emitPolicy(true);
      await flushMicrotasks();
      expect(facade.ensureSession).toHaveBeenCalledOnce();
      expect(status("editor-main", "document-main")?.state).toBe("ready");
    });

    it.each([
      "idle-release",
      "workspace-evicted",
    ] as const)("maps %s to paused and waits for editor focus", async (cause) => {
      const view = await startReady(`lsp-paused-${cause}`);
      facade.ensureSession.mockClear();
      facade.ensureSession.mockResolvedValue(
        ensuredSession(`lsp-resumed-${cause}`)
      );

      facade.emitClosed({
        cause,
        reason: "closed",
        sessionId: `lsp-paused-${cause}`,
      });
      expect(status("editor-main", "document-main")).toEqual({
        reason: cause,
        serverId: "typescript",
        state: "paused",
      });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(facade.ensureSession).not.toHaveBeenCalled();

      view.focus();
      await flushMicrotasks();
      expect(facade.ensureSession).toHaveBeenCalledOnce();
      expect(status("editor-main", "document-main")?.state).toBe("ready");
    });

    it.each([
      "idle-release",
      "workspace-evicted",
    ] as const)("resumes a paused %s root for an explicit symbol command", async (cause) => {
      const view = await startReady(`lsp-command-paused-${cause}`);
      facade.ensureSession.mockClear();
      facade.ensureSession.mockResolvedValue(
        ensuredSession(`lsp-command-resumed-${cause}`)
      );
      facade.emitClosed({
        cause,
        reason: "closed",
        sessionId: `lsp-command-paused-${cause}`,
      });

      await expect(showFilesLspHover(view)).resolves.toBe("queued");
      await flushMicrotasks();

      expect(facade.ensureSession).toHaveBeenCalledOnce();
      expect(status("editor-main", "document-main")?.state).toBe("ready");
    });

    it.each([
      "owner-destroyed",
      "app-quit",
      "client-release",
    ] as const)("treats %s as terminal and never resumes", async (cause) => {
      const view = await startReady(`lsp-terminal-${cause}`);
      facade.ensureSession.mockClear();

      facade.emitClosed({
        cause,
        reason: "closed",
        sessionId: `lsp-terminal-${cause}`,
      });
      expect(status("editor-main", "document-main")).toBeNull();

      await vi.advanceTimersByTimeAsync(30_000);
      view.focus();
      facade.emitPolicy(true);
      await flushMicrotasks();
      expect(facade.ensureSession).not.toHaveBeenCalled();
    });
  });

  it("maps a cleanup-failed recovery deny to cleanup-failed instead of exhausting retries", async () => {
    await startReady("lsp-cleanup-1");
    facade.ensureSession.mockClear();
    facade.ensureSession.mockResolvedValue({
      ok: false,
      reason: "cleanup-failed",
      rootPath: "/repo",
      serverId: "typescript",
      workspaceKey: "main:/repo",
    });

    facade.emitClosed({ reason: "failed", sessionId: "lsp-cleanup-1" });
    await vi.advanceTimersByTimeAsync(250);
    await flushMicrotasks();

    expect(facade.ensureSession).toHaveBeenCalledOnce();
    expect(status("editor-main", "document-main")).toEqual({
      reason: "cleanup-failed",
      serverId: "typescript",
      state: "error",
    });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(facade.ensureSession).toHaveBeenCalledOnce();
  });
});
