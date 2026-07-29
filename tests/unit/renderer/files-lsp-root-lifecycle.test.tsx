import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "codemirror";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LSP_POLICY_PREFS,
  type LspPolicyPrefs,
  type LspSessionClosedEvent,
} from "../../../src/shared/contracts/lsp.ts";

const lspClientMock = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  initializing: Promise.resolve(),
  plugin: vi.fn().mockReturnValue([]),
  workspaceMapping: vi.fn(),
  sync: vi.fn(),
}));
const lspClientConstructorMock = vi.hoisted(() => vi.fn());

vi.mock("@codemirror/lsp-client", () => {
  function MockLSPClient() {
    lspClientConstructorMock();
    return lspClientMock;
  }
  return {
    findReferencesKeymap: [],
    formatKeymap: [],
    jumpToDefinitionKeymap: [],
    LSPClient: MockLSPClient,
    LSPPlugin: { get: vi.fn() },
    renameKeymap: [],
    serverCompletion: () => [],
    serverDiagnostics: () => [],
    signatureHelp: () => [],
    Workspace: vi.fn(),
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

let ensureSessionMock: ReturnType<typeof vi.fn>;
let sendMock: ReturnType<typeof vi.fn>;
let closeMock: ReturnType<typeof vi.fn>;
let onClosedMock: ReturnType<typeof vi.fn>;
let onMessageMock: ReturnType<typeof vi.fn>;
let closedCallback: ((event: LspSessionClosedEvent) => void) | null;
let policyChangedCallback: ((prefs: LspPolicyPrefs) => void) | null;

function installLspFacade() {
  closedCallback = null;
  policyChangedCallback = null;
  ensureSessionMock = vi.fn();
  sendMock = vi.fn().mockResolvedValue(true);
  closeMock = vi.fn().mockResolvedValue(true);
  onMessageMock = vi.fn().mockReturnValue(() => undefined);
  onClosedMock = vi.fn((callback) => {
    closedCallback = callback;
    return () => undefined;
  });
  const onPolicyChanged = vi.fn((callback) => {
    policyChangedCallback = callback;
    return () => undefined;
  });

  const facade = {
    close: closeMock,
    ensureSession: ensureSessionMock,
    onClosed: onClosedMock,
    onPolicyChanged,
    onMessage: onMessageMock,
    send: sendMock,
  };

  const globalRef = globalThis as unknown as {
    pier?: { env?: { platform: string }; lsp?: unknown };
    window?: { pier?: { env?: { platform: string }; lsp?: unknown } };
  };
  if (!globalRef.window) {
    globalRef.window = {} as object;
  }
  const pier = { env: { platform: "darwin" }, lsp: facade };
  (globalRef.window as Record<string, unknown>).pier = pier;
  globalRef.pier = pier;
}

function removeLspFacade() {
  Reflect.deleteProperty(globalThis, "pier");
  Reflect.deleteProperty(window, "pier");
}

describe("filesLspEditorExtensions root lifecycle", () => {
  let host: HTMLElement;
  beforeEach(() => {
    installLspFacade();
    host = document.createElement("div");
    document.body.appendChild(host);
    resetLspClientCacheForTests();
    lspClientMock.connect.mockClear();
    lspClientMock.disconnect.mockClear();
    lspClientConstructorMock.mockClear();
    lspClientMock.plugin.mockClear();
    lspClientMock.sync.mockReset();
    lspClientMock.workspaceMapping.mockReset();
    lspClientMock.workspaceMapping.mockReturnValue({
      destroy: vi.fn(),
      getMapping: vi.fn().mockReturnValue(null),
      mapPosition: vi.fn(),
    });
  });

  afterEach(() => {
    host?.remove();
    removeLspFacade();
  });

  it("asks main to select a provider for unsupported file types", async () => {
    ensureSessionMock.mockResolvedValue({
      ok: false,
      reason: "no-provider",
      rootPath: "/repo",
      workspaceKey: "main:/repo",
    });
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "# Notes",
        extensions: filesLspEditorExtensions({
          absolutePath: "/repo/readme.md",
          rootPath: "/repo",
        }),
      }),
    });

    await vi.waitFor(() => {
      expect(ensureSessionMock).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: "/repo/readme.md" })
      );
    });
    expect(lspClientMock.plugin).not.toHaveBeenCalled();
    view.destroy();
  });

  it("returns a ViewPlugin for .ts files", () => {
    const ext = filesLspEditorExtensions({
      absolutePath: "/repo/main.ts",
      rootPath: "/repo",
    });
    expect(ext).toBeTruthy();
  });

  it("marks linked Git worktrees in the session policy request", async () => {
    ensureSessionMock.mockResolvedValue({
      ok: false,
      reason: "worktrees-disabled",
      rootPath: "/repo.worktree/feature",
      serverId: "typescript",
      workspaceKey: "wt:/repo.worktree/feature",
    });
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "export const value = 1;",
        extensions: filesLspEditorExtensions({
          absolutePath: "/repo.worktree/feature/main.ts",
          panelContext: {
            contextId: "feature",
            gitCommonDir: "/repo/.git",
            gitDir: "/repo/.git/worktrees/feature",
            gitRoot: "/repo.worktree/feature",
            projectRootPath: "/repo.worktree/feature",
            updatedAt: 1,
            worktreeKey: "/repo.worktree/feature",
            worktreeRoot: "/repo.worktree/feature",
          },
          rootPath: "/repo.worktree/feature",
        }),
      }),
    });

    await vi.waitFor(() => {
      expect(ensureSessionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          isWorktree: true,
          workspaceKey: "wt:/repo.worktree/feature",
        })
      );
    });
    view.destroy();
  });

  it("removes the connected client when its parent compartment is disabled", async () => {
    ensureSessionMock.mockResolvedValue({
      ok: true,
      languageId: "typescript",
      rootPath: "/repo",
      serverId: "typescript",
      sessionId: "lsp-removable",
      workspaceKey: "main:/repo",
    });
    const lspCompartment = new Compartment();
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "export const value = 1;",
        extensions: lspCompartment.of(
          filesLspEditorExtensions({
            absolutePath: "/repo/main.ts",
            rootPath: "/repo",
          })
        ),
      }),
    });
    await vi.waitFor(() => {
      expect(lspClientMock.plugin).toHaveBeenCalledTimes(1);
    });

    view.dispatch({ effects: lspCompartment.reconfigure([]) });

    await vi.waitFor(() => {
      expect(closeMock).toHaveBeenCalledWith("lsp-removable");
    });
    view.destroy();
  });

  it("invalidates the root cache when the server exits", async () => {
    ensureSessionMock
      .mockResolvedValueOnce({
        ok: true,
        languageId: "typescript",
        rootPath: "/repo",
        serverId: "typescript",
        sessionId: "lsp-before-exit",
        workspaceKey: "main:/repo",
      })
      .mockResolvedValueOnce({
        ok: true,
        languageId: "typescript",
        rootPath: "/repo",
        serverId: "typescript",
        sessionId: "lsp-after-exit",
        workspaceKey: "main:/repo",
      });
    const firstView = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "export const first = 1;",
        extensions: filesLspEditorExtensions({
          absolutePath: "/repo/first.ts",
          rootPath: "/repo",
        }),
      }),
    });
    await vi.waitFor(() => {
      expect(lspClientMock.plugin).toHaveBeenCalledTimes(1);
    });

    closedCallback?.({ reason: "exited", sessionId: "lsp-before-exit" });
    const secondView = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "export const second = 2;",
        extensions: filesLspEditorExtensions({
          absolutePath: "/repo/second.ts",
          rootPath: "/repo",
        }),
      }),
    });

    await vi.waitFor(() => {
      expect(ensureSessionMock).toHaveBeenCalledTimes(2);
    });
    firstView.destroy();
    secondView.destroy();
  });

  it("reconnects an open editor when the host policy is re-enabled", async () => {
    ensureSessionMock
      .mockResolvedValueOnce({
        ok: true,
        languageId: "typescript",
        rootPath: "/repo",
        serverId: "typescript",
        sessionId: "lsp-before-disable",
        workspaceKey: "main:/repo",
      })
      .mockResolvedValueOnce({
        ok: true,
        languageId: "typescript",
        rootPath: "/repo",
        serverId: "typescript",
        sessionId: "lsp-after-enable",
        workspaceKey: "main:/repo",
      });
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "export const value = 1;",
        extensions: filesLspEditorExtensions({
          absolutePath: "/repo/main.ts",
          rootPath: "/repo",
        }),
      }),
    });
    await vi.waitFor(() => {
      expect(ensureSessionMock).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(lspClientMock.plugin).toHaveBeenCalledTimes(1);
    });

    closedCallback?.({
      cause: "policy-disabled",
      reason: "closed",
      sessionId: "lsp-before-disable",
    });
    policyChangedCallback?.({
      ...DEFAULT_LSP_POLICY_PREFS,
      enabled: false,
    });
    policyChangedCallback?.(DEFAULT_LSP_POLICY_PREFS);

    await vi.waitFor(() => {
      expect(ensureSessionMock).toHaveBeenCalledTimes(2);
    });
    view.destroy();
  });

  it.each([
    ["/repo/main.py", "python", "pyright"],
    ["/repo/main.go", "go", "gopls"],
    ["/repo/main.rs", "rust", "rust-analyzer"],
  ])("attaches %s with the language id selected by main", async (absolutePath, languageId, serverId) => {
    ensureSessionMock.mockResolvedValue({
      ok: true,
      languageId,
      rootPath: "/repo",
      serverId,
      sessionId: `lsp-${serverId}`,
      workspaceKey: "main:/repo",
    });
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "",
        extensions: filesLspEditorExtensions({
          absolutePath,
          rootPath: "/repo",
        }),
      }),
    });

    await vi.waitFor(() => {
      expect(lspClientMock.plugin).toHaveBeenCalledWith(
        `file://${absolutePath}`,
        languageId
      );
    });
    expect(ensureSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: absolutePath })
    );
    expect(ensureSessionMock.mock.calls[0]?.[0]).not.toHaveProperty("language");
    view.destroy();
  });

  it("does not route sibling package files through a provisional workspace-root client", async () => {
    ensureSessionMock
      .mockResolvedValueOnce({
        ok: true,
        languageId: "typescript",
        rootPath: "/repo/packages/alpha",
        serverId: "typescript",
        sessionId: "lsp-alpha",
        workspaceKey: "main:/repo",
      })
      .mockResolvedValueOnce({
        ok: true,
        languageId: "typescript",
        rootPath: "/repo/packages/beta",
        serverId: "typescript",
        sessionId: "lsp-beta",
        workspaceKey: "main:/repo",
      });
    const firstView = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "export const first = 1;",
        extensions: filesLspEditorExtensions({
          absolutePath: "/repo/packages/alpha/first.ts",
          rootPath: "/repo",
        }),
      }),
    });
    await vi.waitFor(() => {
      expect(lspClientMock.plugin).toHaveBeenCalledTimes(1);
    });
    const secondView = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "export const second = 2;",
        extensions: filesLspEditorExtensions({
          absolutePath: "/repo/packages/beta/second.ts",
          rootPath: "/repo",
        }),
      }),
    });

    await vi.waitFor(() => {
      expect(lspClientMock.plugin).toHaveBeenCalledTimes(2);
    });
    expect(ensureSessionMock).toHaveBeenCalledTimes(2);
    expect(lspClientMock.connect).toHaveBeenCalledTimes(2);
    firstView.destroy();
    secondView.destroy();
  });

  it("initializes one client for concurrent files with the same provider and resolved root", async () => {
    ensureSessionMock
      .mockResolvedValueOnce({
        ok: true,
        languageId: "typescript",
        rootPath: "/repo",
        serverId: "typescript",
        sessionId: "lsp-shared-root",
        workspaceKey: "main:/repo",
      })
      .mockResolvedValueOnce({
        ok: true,
        languageId: "typescriptreact",
        rootPath: "/repo/",
        serverId: "typescript",
        sessionId: "lsp-shared-root",
        workspaceKey: "main:/repo",
      });
    const firstView = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "export const first = 1;",
        extensions: filesLspEditorExtensions({
          absolutePath: "/repo/first.ts",
          rootPath: "/repo",
        }),
      }),
    });
    const secondView = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "export const second = <div />;",
        extensions: filesLspEditorExtensions({
          absolutePath: "/repo/second.tsx",
          rootPath: "/repo",
        }),
      }),
    });

    await vi.waitFor(() => {
      expect(lspClientMock.plugin).toHaveBeenCalledTimes(2);
    });
    expect(ensureSessionMock).toHaveBeenCalledTimes(2);
    expect(lspClientMock.connect).toHaveBeenCalledTimes(1);
    expect(lspClientMock.plugin).toHaveBeenCalledWith(
      "file:///repo/first.ts",
      "typescript"
    );
    expect(lspClientMock.plugin).toHaveBeenCalledWith(
      "file:///repo/second.tsx",
      "typescriptreact"
    );

    firstView.destroy();
    expect(closeMock).not.toHaveBeenCalled();
    secondView.destroy();
    await vi.waitFor(() => {
      expect(closeMock).toHaveBeenCalledTimes(1);
      expect(closeMock).toHaveBeenCalledWith("lsp-shared-root");
    });
  });

  it("isolates equal server roots by the ensured workspace key", async () => {
    ensureSessionMock
      .mockResolvedValueOnce({
        ok: true,
        languageId: "typescript",
        rootPath: "/repo",
        serverId: "typescript",
        sessionId: "lsp-workspace-a",
        workspaceKey: "workspace-a",
      })
      .mockResolvedValueOnce({
        ok: true,
        languageId: "typescript",
        rootPath: "/repo",
        serverId: "typescript",
        sessionId: "lsp-workspace-b",
        workspaceKey: "workspace-b",
      });
    const firstView = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "export const first = 1;",
        extensions: filesLspEditorExtensions({
          absolutePath: "/repo/first.ts",
          rootPath: "/repo",
        }),
      }),
    });
    const secondView = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "export const second = 2;",
        extensions: filesLspEditorExtensions({
          absolutePath: "/repo/second.ts",
          rootPath: "/repo",
        }),
      }),
    });

    await vi.waitFor(() => {
      expect(lspClientMock.plugin).toHaveBeenCalledTimes(2);
    });
    expect(ensureSessionMock).toHaveBeenCalledTimes(2);
    expect(lspClientConstructorMock).toHaveBeenCalledTimes(2);
    expect(lspClientMock.connect).toHaveBeenCalledTimes(2);
    expect(closeMock).not.toHaveBeenCalled();

    firstView.destroy();
    await vi.waitFor(() => {
      expect(closeMock).toHaveBeenCalledTimes(1);
      expect(closeMock).toHaveBeenCalledWith("lsp-workspace-a");
      expect(lspClientMock.disconnect).toHaveBeenCalledTimes(1);
    });
    expect(closeMock).not.toHaveBeenCalledWith("lsp-workspace-b");

    secondView.destroy();
    await vi.waitFor(() => {
      expect(closeMock).toHaveBeenCalledTimes(2);
      expect(closeMock).toHaveBeenCalledWith("lsp-workspace-b");
      expect(lspClientMock.disconnect).toHaveBeenCalledTimes(2);
    });
  });

  it("shares a root when only the ensured root path separators differ", async () => {
    ensureSessionMock
      .mockResolvedValueOnce({
        ok: true,
        languageId: "typescript",
        rootPath: "/repo/",
        serverId: "typescript",
        sessionId: "lsp-normalized-root",
        workspaceKey: "workspace-a",
      })
      .mockResolvedValueOnce({
        ok: true,
        languageId: "typescriptreact",
        rootPath: "\\repo\\",
        serverId: "typescript",
        sessionId: "lsp-normalized-root",
        workspaceKey: "workspace-a",
      });
    const firstView = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "export const first = 1;",
        extensions: filesLspEditorExtensions({
          absolutePath: "/repo/first.ts",
          rootPath: "/repo",
        }),
      }),
    });
    const secondView = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: "export const second = <div />;",
        extensions: filesLspEditorExtensions({
          absolutePath: "/repo/second.tsx",
          rootPath: "/repo",
        }),
      }),
    });

    await vi.waitFor(() => {
      expect(lspClientMock.plugin).toHaveBeenCalledTimes(2);
    });
    expect(ensureSessionMock).toHaveBeenCalledTimes(2);
    expect(lspClientConstructorMock).toHaveBeenCalledTimes(1);
    expect(lspClientMock.connect).toHaveBeenCalledTimes(1);
    expect(closeMock).not.toHaveBeenCalled();

    firstView.destroy();
    expect(closeMock).not.toHaveBeenCalled();
    expect(lspClientMock.disconnect).not.toHaveBeenCalled();

    secondView.destroy();
    await vi.waitFor(() => {
      expect(closeMock).toHaveBeenCalledTimes(1);
      expect(closeMock).toHaveBeenCalledWith("lsp-normalized-root");
      expect(lspClientMock.disconnect).toHaveBeenCalledTimes(1);
    });
  });
});
