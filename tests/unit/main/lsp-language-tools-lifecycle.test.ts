import type {
  LspSessionCloseCause,
  LspSessionClosedEvent,
} from "@shared/contracts/lsp.ts";
import { DEFAULT_LSP_POLICY_PREFS } from "@shared/contracts/lsp.ts";
import { PIER } from "@shared/ipc-channels.ts";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { flushMicrotasks } from "./lsp-test-fixtures.ts";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload: unknown) => unknown>(),
  closingTrees: new Map<
    string,
    { promise: Promise<void>; resolve: () => void }
  >(),
  host: {
    close: vi.fn(),
    closeMany: vi.fn(),
    dispose: vi.fn(),
    dropAllForWebContents: vi.fn(),
    ensure: vi.fn(),
    ensureInitialized: vi.fn(),
    ensureLanguageToolsDocumentOpen: vi.fn(),
    getSessionMeta: vi.fn(),
    request: vi.fn(),
    send: vi.fn(),
  },
  readPrefs: vi.fn(),
  sessions: new Map<
    string,
    {
      onClose?: (
        event: LspSessionClosedEvent,
        treeTerminal: Promise<void>
      ) => void;
      onCloseAccepted?: (sessionId: string) => void;
      rootPath: string;
      serverId: string;
      webContentsId: number;
      workspaceKey: string;
    }
  >(),
  subscribe: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(
      (
        channel: string,
        handler: (event: unknown, payload: unknown) => unknown
      ) => {
        mocks.handlers.set(channel, handler);
      }
    ),
  },
}));

vi.mock("@main/app-core/app-core.ts", () => ({
  appCore: {
    clients: {
      heartbeat: vi.fn(() => ({ capabilities: ["file:read"] })),
      register: vi.fn(),
    },
    eventBus: { subscribe: mocks.subscribe },
    services: {
      preferences: { read: mocks.readPrefs },
    },
  },
}));

vi.mock("@main/services/lsp/lsp-session-host.ts", () => ({
  LspSessionHost: class {
    constructor() {
      Object.assign(this, mocks.host);
    }
  },
}));

vi.mock("@main/windows/window-manager.ts", () => ({
  windowManager: {
    findInternalIdByWindow: vi.fn(() => "window-1"),
    fromWebContents: vi.fn(() => ({})),
    getAll: vi.fn(() => []),
  },
}));

import {
  disposeLspIpcHost,
  getLspIpcTestHandles,
  registerLspIpc,
} from "@main/ipc/lsp.ts";

function event() {
  const mainFrame = {};
  const sender = {
    id: 23,
    isDestroyed: vi.fn(() => false),
    mainFrame,
    on: vi.fn(),
    once: vi.fn(),
    send: vi.fn(),
  };
  return { sender, senderFrame: mainFrame };
}

function request(rootPath: string, fileName: string) {
  return {
    filePath: `${rootPath}/${fileName}`,
    method: "workspace/symbol",
    params: { query: "value" },
    rootPath,
  };
}

const unregisterProviders: Array<() => void> = [];

describe("LanguageTools IPC lifecycle", () => {
  beforeAll(() => {
    const { registry } = getLspIpcTestHandles();
    unregisterProviders.push(
      registry.register({
        displayName: "Lifecycle test LSP",
        id: "language-tools-lifecycle-test",
        languageIdForPath: () => "typescript",
        matchPath: (path) => path.endsWith(".evict.ts"),
        priority: Number.MAX_SAFE_INTEGER,
        resolveLaunch: ({ rootPath }) => ({
          args: [],
          command: "fake-lsp",
          cwd: rootPath,
        }),
        resolveRoot: ({ fallbackWorkspaceRoot }) => fallbackWorkspaceRoot,
        rootMarkers: [],
        selector: { extensions: [".ts"], languageIds: ["typescript"] },
      }),
      registry.register({
        displayName: "Throwing root test LSP",
        id: "language-tools-root-throw-test",
        languageIdForPath: () => "typescript",
        matchPath: (path) => path.endsWith(".root-throw.ts"),
        priority: Number.MAX_SAFE_INTEGER,
        resolveLaunch: () => {
          throw new Error("resolveLaunch should not run");
        },
        resolveRoot: () => {
          throw new Error("root failed");
        },
        rootMarkers: [],
        selector: { extensions: [".ts"], languageIds: ["typescript"] },
      }),
      registry.register({
        displayName: "Throwing launch test LSP",
        id: "language-tools-launch-throw-test",
        languageIdForPath: () => "typescript",
        matchPath: (path) => path.endsWith(".launch-throw.ts"),
        priority: Number.MAX_SAFE_INTEGER,
        resolveLaunch: () => {
          throw new Error("launch failed");
        },
        resolveRoot: ({ fallbackWorkspaceRoot }) => fallbackWorkspaceRoot,
        rootMarkers: [],
        selector: { extensions: [".ts"], languageIds: ["typescript"] },
      })
    );
    registerLspIpc();
  });

  beforeEach(() => {
    mocks.readPrefs.mockResolvedValue({
      lsp: { ...DEFAULT_LSP_POLICY_PREFS, maxLocalWorkspaces: 1 },
    });
    mocks.sessions.clear();
    mocks.closingTrees.clear();
    for (const value of Object.values(mocks.host)) {
      if (typeof value === "function" && "mockReset" in value) {
        value.mockReset();
      }
    }
    mocks.host.ensure.mockImplementation((input) => {
      const sessionId = `session:${input.workspaceKey}`;
      mocks.sessions.set(sessionId, input);
      return {
        reused: false,
        rootPath: input.rootPath,
        serverId: input.serverId,
        sessionId,
      };
    });
    mocks.host.getSessionMeta.mockImplementation((sessionId) => {
      const session = mocks.sessions.get(sessionId);
      return session
        ? {
            clientRole: "editor",
            rootPath: session.rootPath,
            serverId: session.serverId,
            webContentsId: session.webContentsId,
            workspaceKey: session.workspaceKey,
          }
        : null;
    });
    mocks.host.close.mockImplementation(
      (sessionId: string, _cause: LspSessionCloseCause) => {
        const session = mocks.sessions.get(sessionId);
        if (!session) {
          return Promise.resolve(false);
        }
        const terminal = Promise.withResolvers<void>();
        mocks.closingTrees.set(sessionId, terminal);
        session.onCloseAccepted?.(sessionId);
        return terminal.promise.then(() => {
          mocks.closingTrees.delete(sessionId);
          mocks.sessions.delete(sessionId);
          return true;
        });
      }
    );
    mocks.host.ensureInitialized.mockResolvedValue(undefined);
    mocks.host.request.mockResolvedValue([{ name: "value" }]);
    mocks.host.closeMany.mockImplementation(
      async (sessionIds: readonly string[], cause: LspSessionCloseCause) => {
        await Promise.all(
          sessionIds.map(async (sessionId) => {
            const session = mocks.sessions.get(sessionId);
            const terminal = Promise.withResolvers<void>();
            mocks.closingTrees.set(sessionId, terminal);
            session?.onCloseAccepted?.(sessionId);
            session?.onClose?.(
              { cause, reason: "closed", sessionId },
              terminal.promise
            );
            await terminal.promise;
            mocks.closingTrees.delete(sessionId);
            mocks.sessions.delete(sessionId);
          })
        );
      }
    );
    const { policy } = getLspIpcTestHandles();
    policy.dispose();
    policy.setPrefs({
      ...DEFAULT_LSP_POLICY_PREFS,
      maxLocalWorkspaces: 1,
    });
  });

  it("evicts every victim session before serving a replacement workspace", async () => {
    const handler = mocks.handlers.get(PIER.LSP_LANGUAGE_TOOLS_REQUEST);
    if (!handler) {
      throw new Error("expected LanguageTools request handler");
    }
    const ipcEvent = event();

    await expect(
      handler(ipcEvent, request("/workspace-a", "source.evict.ts"))
    ).resolves.toMatchObject({ ok: true });
    const replacement = handler(
      ipcEvent,
      request("/workspace-b", "source.evict.ts")
    );
    let replacementSettled = false;
    Promise.resolve(replacement).then(() => {
      replacementSettled = true;
    });
    await flushMicrotasks();

    expect(mocks.host.closeMany).toHaveBeenCalledWith(
      ["session:main:/workspace-a"],
      "workspace-evicted"
    );
    expect(ipcEvent.sender.send).toHaveBeenCalledWith(PIER.LSP_SESSION_CLOSED, {
      cause: "workspace-evicted",
      reason: "closed",
      sessionId: "session:main:/workspace-a",
    });
    expect(
      getLspIpcTestHandles().policy.hasTreeBlocker("main:/workspace-a")
    ).toBe(true);
    expect(
      getLspIpcTestHandles().policy.sessionsOf("main:/workspace-a")
    ).toContain("session:main:/workspace-a");
    expect(replacementSettled).toBe(false);

    mocks.closingTrees.get("session:main:/workspace-a")?.resolve();
    await expect(replacement).resolves.toMatchObject({ ok: true });
    expect(replacementSettled).toBe(true);
    expect(mocks.sessions.has("session:main:/workspace-a")).toBe(false);
    expect(mocks.sessions.has("session:main:/workspace-b")).toBe(true);
    expect(
      getLspIpcTestHandles().policy.hasTreeBlocker("main:/workspace-a")
    ).toBe(false);
    expect(getLspIpcTestHandles().policy.listActive()).toMatchObject([
      { workspaceKey: "main:/workspace-b" },
    ]);
  });

  it("marks the tree barrier synchronously on close acceptance and blocks immediate re-ensure", async () => {
    const ensureHandler = mocks.handlers.get(PIER.LSP_SESSION_ENSURE);
    const closeHandler = mocks.handlers.get(PIER.LSP_SESSION_CLOSE);
    if (!(ensureHandler && closeHandler)) {
      throw new Error("expected LSP ensure and close handlers");
    }
    const ipcEvent = event();
    const workspaceKey = "main:/workspace";
    const sessionId = `session:${workspaceKey}`;
    const ensureRequest = {
      filePath: "/workspace/source.evict.ts",
      rootPath: "/workspace",
      workspaceKey,
    };

    await expect(ensureHandler(ipcEvent, ensureRequest)).resolves.toMatchObject(
      {
        ok: true,
        sessionId,
      }
    );
    const closing = closeHandler(ipcEvent, { sessionId });

    expect(getLspIpcTestHandles().policy.hasTreeBlocker(workspaceKey)).toBe(
      true
    );
    expect(ipcEvent.sender.send).not.toHaveBeenCalledWith(
      PIER.LSP_SESSION_CLOSED,
      expect.anything()
    );
    const reensure = ensureHandler(ipcEvent, ensureRequest);
    let reensureSettled = false;
    Promise.resolve(reensure).then(() => {
      reensureSettled = true;
    });
    await flushMicrotasks();
    expect(reensureSettled).toBe(false);
    expect(mocks.host.ensure).toHaveBeenCalledTimes(1);

    const retained = mocks.closingTrees.get(sessionId);
    const session = mocks.sessions.get(sessionId);
    if (!(retained && session)) {
      throw new Error("expected retained closing session");
    }
    session.onClose?.(
      { cause: "client-release", reason: "closed", sessionId },
      retained.promise
    );
    expect(ipcEvent.sender.send).toHaveBeenCalledWith(PIER.LSP_SESSION_CLOSED, {
      cause: "client-release",
      reason: "closed",
      sessionId,
    });
    retained.resolve();
    await expect(closing).resolves.toBe(true);
    await flushMicrotasks();

    expect(getLspIpcTestHandles().policy.hasTreeBlocker(workspaceKey)).toBe(
      false
    );
    await expect(reensure).resolves.toMatchObject({
      ok: true,
    });
    expect(mocks.host.ensure).toHaveBeenCalledTimes(2);
  });

  it("blocks a LanguageTools-only replacement synchronously until its old tree is terminal", async () => {
    const languageToolsHandler = mocks.handlers.get(
      PIER.LSP_LANGUAGE_TOOLS_REQUEST
    );
    const closeHandler = mocks.handlers.get(PIER.LSP_SESSION_CLOSE);
    if (!(languageToolsHandler && closeHandler)) {
      throw new Error("expected LanguageTools request and close handlers");
    }
    const ipcEvent = event();
    const workspaceKey = "main:/workspace";
    const sessionId = `session:${workspaceKey}`;
    const languageToolsRequest = request("/workspace", "source.evict.ts");

    await expect(
      languageToolsHandler(ipcEvent, languageToolsRequest)
    ).resolves.toMatchObject({ ok: true });
    const closing = closeHandler(ipcEvent, { sessionId });

    expect(getLspIpcTestHandles().policy.hasTreeBlocker(workspaceKey)).toBe(
      true
    );
    expect(ipcEvent.sender.send).not.toHaveBeenCalledWith(
      PIER.LSP_SESSION_CLOSED,
      expect.anything()
    );
    const replacement = languageToolsHandler(ipcEvent, languageToolsRequest);
    let replacementSettled = false;
    Promise.resolve(replacement).then(() => {
      replacementSettled = true;
    });
    await flushMicrotasks();
    expect(replacementSettled).toBe(false);
    expect(mocks.host.ensure).toHaveBeenCalledTimes(1);

    const retained = mocks.closingTrees.get(sessionId);
    const session = mocks.sessions.get(sessionId);
    if (!(retained && session)) {
      throw new Error("expected retained closing LanguageTools session");
    }
    session.onClose?.(
      { cause: "client-release", reason: "closed", sessionId },
      retained.promise
    );
    expect(ipcEvent.sender.send).toHaveBeenCalledWith(PIER.LSP_SESSION_CLOSED, {
      cause: "client-release",
      reason: "closed",
      sessionId,
    });

    retained.resolve();
    await expect(closing).resolves.toBe(true);
    await flushMicrotasks();
    expect(getLspIpcTestHandles().policy.hasTreeBlocker(workspaceKey)).toBe(
      false
    );
    await expect(replacement).resolves.toMatchObject({ ok: true });
    expect(mocks.host.ensure).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["resolveRoot", "source.root-throw.ts"],
    ["resolveLaunch", "source.launch-throw.ts"],
  ])("releases the policy acquisition when %s throws", async (_, fileName) => {
    const handler = mocks.handlers.get(PIER.LSP_LANGUAGE_TOOLS_REQUEST);
    if (!handler) {
      throw new Error("expected LanguageTools request handler");
    }

    await expect(
      handler(event(), request("/workspace", fileName))
    ).resolves.toEqual({ ok: false, reason: "request-failed", result: null });
    expect(
      getLspIpcTestHandles().policy.getState("main:/workspace")?.refCount
    ).toBe(0);
  });
});

afterAll(async () => {
  for (const unregister of unregisterProviders) {
    unregister();
  }
  await disposeLspIpcHost();
});
