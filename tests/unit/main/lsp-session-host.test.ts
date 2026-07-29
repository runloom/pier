import type { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  encodeLspMessage,
  LSP_MAX_CONTENT_BYTES,
  LspMessageReader,
} from "../../../src/main/services/lsp/lsp-message-codec.ts";
import { LspSessionHost } from "../../../src/main/services/lsp/lsp-session-host.ts";
import { LSP_REQUEST_TIMEOUT_MS } from "../../../src/main/services/lsp/lsp-session-runtime.ts";
import { WorkspaceLspPolicy } from "../../../src/main/services/lsp/workspace-lsp-policy.ts";
import {
  createFakeProcessTree,
  FakeLspChild,
  flushMicrotasks,
  recordLspMessages,
} from "./lsp-test-fixtures.ts";

function createHost(
  spawnImpl: typeof spawn,
  processTreeFactory = () => createFakeProcessTree(false)
) {
  return new LspSessionHost({ processTreeFactory, spawnImpl });
}

function launch(command = "fake-ls") {
  return {
    args: ["--stdio"] as const,
    command,
    cwd: "/repo",
  };
}

describe("LspSessionHost", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("reuses one session per webContents+workspace+server+root and forwards framed messages", async () => {
    const child = new FakeLspChild();
    const spawnImpl = vi.fn(() => child) as unknown as typeof spawn;
    const host = createHost(spawnImpl);
    const messages: Array<{ message: string; sessionId: string }> = [];
    const first = host.ensure({
      clientRole: "editor",
      launch: launch(),
      onMessage: (sessionId, message) => {
        messages.push({ message, sessionId });
      },
      rootPath: "/repo",
      serverId: "typescript",
      webContentsId: 1,
      workspaceKey: "main:/repo",
    });
    const second = host.ensure({
      clientRole: "editor",
      launch: launch(),
      onMessage: () => undefined,
      rootPath: "/repo",
      serverId: "typescript",
      webContentsId: 1,
      workspaceKey: "main:/repo",
    });
    expect(second.sessionId).toBe(first.sessionId);
    expect(spawnImpl).toHaveBeenCalledTimes(1);

    const body = '{"jsonrpc":"2.0","id":1,"result":{}}';
    child.stdout.write(encodeLspMessage(body));
    expect(messages).toEqual([{ message: body, sessionId: first.sessionId }]);

    expect(
      host.send(first.sessionId, '{"jsonrpc":"2.0","method":"exit"}')
    ).toBe(true);
    child.exit(0);
    await host.dispose();
  });

  it("isolates editor and LanguageTools protocol connections while reusing editors", async () => {
    const children: FakeLspChild[] = [];
    const spawnImpl = vi.fn(() => {
      const child = new FakeLspChild();
      children.push(child);
      return child;
    }) as unknown as typeof spawn;
    const host = createHost(spawnImpl);
    const owner = {
      launch: launch(),
      onMessage: () => undefined,
      rootPath: "/repo",
      serverId: "typescript",
      webContentsId: 1,
      workspaceKey: "main:/repo",
    };

    // Editor vs language-tools intentionally isolate process trees (streaming
    // renderer transport vs main request/response); cost is documented on
    // sessionOwnerKey.
    const editor = host.ensure({ ...owner, clientRole: "editor" });
    const languageTools = host.ensure({
      ...owner,
      clientRole: "language-tools",
    });
    const secondEditor = host.ensure({ ...owner, clientRole: "editor" });

    expect(languageTools.sessionId).not.toBe(editor.sessionId);
    expect(secondEditor.sessionId).toBe(editor.sessionId);
    expect(spawnImpl).toHaveBeenCalledTimes(2);
    for (const child of children) {
      child.exit(0);
    }
    await host.dispose();
  });

  it("isolates sessions by webContents id", async () => {
    const children: FakeLspChild[] = [];
    const spawnImpl = vi.fn(() => {
      const child = new FakeLspChild();
      children.push(child);
      return child;
    }) as unknown as typeof spawn;
    const host = createHost(spawnImpl);
    const a = host.ensure({
      clientRole: "editor",
      launch: launch(),
      onMessage: () => undefined,
      rootPath: "/repo",
      serverId: "typescript",
      webContentsId: 1,
      workspaceKey: "main:/repo",
    });
    const b = host.ensure({
      clientRole: "editor",
      launch: launch(),
      onMessage: () => undefined,
      rootPath: "/repo",
      serverId: "typescript",
      webContentsId: 2,
      workspaceKey: "main:/repo",
    });
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(spawnImpl).toHaveBeenCalledTimes(2);
    for (const child of children) {
      child.exit(0);
    }
    await host.dispose();
  });

  it("isolates sessions by serverId", async () => {
    const children: FakeLspChild[] = [];
    const spawnImpl = vi.fn(() => {
      const child = new FakeLspChild();
      children.push(child);
      return child;
    }) as unknown as typeof spawn;
    const host = createHost(spawnImpl);
    const ts = host.ensure({
      clientRole: "editor",
      launch: launch("ts"),
      onMessage: () => undefined,
      rootPath: "/repo",
      serverId: "typescript",
      webContentsId: 1,
      workspaceKey: "main:/repo",
    });
    const py = host.ensure({
      clientRole: "editor",
      launch: launch("py"),
      onMessage: () => undefined,
      rootPath: "/repo",
      serverId: "pyright",
      webContentsId: 1,
      workspaceKey: "main:/repo",
    });
    expect(ts.sessionId).not.toBe(py.sessionId);
    expect(spawnImpl).toHaveBeenCalledTimes(2);
    for (const child of children) {
      child.exit(0);
    }
    await host.dispose();
  });

  it.each([
    "error",
    "timeout",
  ] as const)("terminates a session after initialize %s and replaces it on the next ensure", async (failure) => {
    vi.useFakeTimers();
    const firstChild = new FakeLspChild(4242);
    const replacementChild = new FakeLspChild(4243);
    const children = [firstChild, replacementChild];
    const trees = [createFakeProcessTree(false), createFakeProcessTree(false)];
    let spawnIndex = 0;
    const spawnImpl = vi.fn(() => {
      const child = children[spawnIndex];
      spawnIndex += 1;
      if (!child) {
        throw new Error("unexpected LSP spawn");
      }
      return child;
    }) as unknown as typeof spawn;
    let treeIndex = 0;
    const host = createHost(spawnImpl, () => {
      const tree = trees[treeIndex];
      treeIndex += 1;
      if (!tree) {
        throw new Error("unexpected process tree");
      }
      return tree;
    });
    const closed = Promise.withResolvers<{
      event: { reason: string; sessionId: string };
      terminal: Promise<void>;
    }>();
    const owner = {
      clientRole: "editor" as const,
      launch: launch(),
      onMessage: () => undefined,
      rootPath: "/repo",
      serverId: "typescript",
      webContentsId: 1,
      workspaceKey: "main:/repo",
    };
    const first = host.ensure({
      ...owner,
      onClose: (event, terminal) => closed.resolve({ event, terminal }),
    });
    const written = recordLspMessages(firstChild.stdin);

    const initializing = host.ensureInitialized(first.sessionId, {
      capabilities: {},
    });
    const initializationRejection = expect(initializing).rejects.toThrow();
    const initializeRequest = written.messages.find(
      (message) => message.method === "initialize"
    );
    expect(initializeRequest).toBeDefined();
    if (failure === "error") {
      firstChild.stdout.write(
        encodeLspMessage(
          JSON.stringify({
            error: { code: -32_602, message: "initialize rejected" },
            id: initializeRequest?.id,
            jsonrpc: "2.0",
          })
        )
      );
    } else {
      await vi.advanceTimersByTimeAsync(LSP_REQUEST_TIMEOUT_MS);
    }
    await initializationRejection;

    const closeState = await closed.promise;
    expect(closeState.event).toEqual({
      reason: "failed",
      sessionId: first.sessionId,
    });
    firstChild.exit(1);
    await closeState.terminal;

    const replacement = host.ensure(owner);
    expect(replacement.reused).toBe(false);
    expect(replacement.sessionId).not.toBe(first.sessionId);
    expect(spawnImpl).toHaveBeenCalledTimes(2);

    const replacementClosing = host.close(
      replacement.sessionId,
      "client-release"
    );
    replacementChild.exit(0);
    await expect(replacementClosing).resolves.toBe(true);
  });
  it("synchronizes changed LanguageTools text and closes it with the session", async () => {
    const child = new FakeLspChild();
    const spawnImpl = vi.fn(() => child) as unknown as typeof spawn;
    const host = createHost(spawnImpl);
    const session = host.ensure({
      clientRole: "language-tools",
      launch: launch(),
      onMessage: () => undefined,
      rootPath: "/repo",
      serverId: "typescript",
      webContentsId: 1,
      workspaceKey: "main:/repo",
    });
    const reader = new LspMessageReader();
    const messages: Record<string, unknown>[] = [];
    child.stdin.on("data", (chunk: Buffer) => {
      for (const message of reader.push(chunk)) {
        messages.push(JSON.parse(message) as Record<string, unknown>);
      }
    });
    const readText = vi.fn(async () => "const value = 42;\n");
    const document = {
      languageId: "typescript",
      uri: "file:///repo/a.ts",
    };

    await Promise.all([
      host.ensureLanguageToolsDocumentOpen(
        session.sessionId,
        document,
        readText
      ),
      host.ensureLanguageToolsDocumentOpen(
        session.sessionId,
        document,
        readText
      ),
    ]);
    await host.ensureLanguageToolsDocumentOpen(
      session.sessionId,
      document,
      readText
    );
    readText.mockResolvedValueOnce("const value = 43;\n");
    await host.ensureLanguageToolsDocumentOpen(
      session.sessionId,
      document,
      readText
    );

    expect(readText).toHaveBeenCalledTimes(4);
    expect(messages).toEqual([
      {
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            languageId: "typescript",
            text: "const value = 42;\n",
            uri: "file:///repo/a.ts",
            version: 1,
          },
        },
      },
      {
        jsonrpc: "2.0",
        method: "textDocument/didChange",
        params: {
          contentChanges: [{ text: "const value = 43;\n" }],
          textDocument: {
            uri: "file:///repo/a.ts",
            version: 2,
          },
        },
      },
    ]);

    const closePromise = host.close(session.sessionId, "client-release");
    await flushMicrotasks();
    expect(messages.at(-1)).toEqual({
      jsonrpc: "2.0",
      method: "textDocument/didClose",
      params: { textDocument: { uri: "file:///repo/a.ts" } },
    });
    child.exit(0);
    await closePromise;
  });

  it("rejects malformed, structurally invalid, and oversized outbound JSON-RPC without writing", async () => {
    const child = new FakeLspChild();
    const host = createHost(vi.fn(() => child) as unknown as typeof spawn);
    const session = host.ensure({
      clientRole: "editor",
      launch: launch(),
      onMessage: () => undefined,
      rootPath: "/repo",
      serverId: "typescript",
      webContentsId: 1,
      workspaceKey: "main:/repo",
    });
    const writes: Buffer[] = [];
    child.stdin.on("data", (chunk: Buffer) => writes.push(chunk));

    for (const body of [
      '{"jsonrpc":',
      "null",
      "[]",
      '{"jsonrpc":"1.0","method":"exit"}',
      '{"jsonrpc":"2.0"}',
      JSON.stringify({
        jsonrpc: "2.0",
        method: "workspace/didChangeConfiguration",
        params: "x".repeat(LSP_MAX_CONTENT_BYTES),
      }),
    ]) {
      expect(host.send(session.sessionId, body)).toBe(false);
    }
    expect(writes).toEqual([]);

    expect(
      host.send(
        session.sessionId,
        '{"jsonrpc":"2.0","method":"workspace/didChangeConfiguration","params":{}}'
      )
    ).toBe(true);
    expect(writes).toHaveLength(1);
    child.exit(0);
    await host.dispose();
  });

  it("contains framing fatals to one session and logs only the framing code", async () => {
    const firstChild = new FakeLspChild(4101);
    const secondChild = new FakeLspChild(4102);
    const childQueue = [firstChild, secondChild];
    const firstTree = createFakeProcessTree(true);
    const treeQueue = [firstTree, createFakeProcessTree(false)];
    const host = createHost(
      vi.fn(() => childQueue.shift()) as unknown as typeof spawn,
      () => treeQueue.shift() ?? createFakeProcessTree(false)
    );
    const outcomes: Record<string, unknown>[] = [];
    const first = host.ensure({
      clientRole: "editor",
      launch: launch("first"),
      onClose: (event) => outcomes.push(event),
      onMessage: vi.fn(),
      rootPath: "/repo/first",
      serverId: "typescript",
      webContentsId: 1,
      workspaceKey: "main:/repo/first",
    });
    const second = host.ensure({
      clientRole: "editor",
      launch: launch("second"),
      onMessage: vi.fn(),
      rootPath: "/repo/second",
      serverId: "typescript",
      webContentsId: 1,
      workspaceKey: "main:/repo/second",
    });
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const badFrame = Buffer.from(
      "Content-Length: nope\r\n\r\nSECRET_PROTOCOL_BODY",
      "utf8"
    );

    expect(() => firstChild.stdout.write(badFrame)).not.toThrow();
    await flushMicrotasks();
    expect(outcomes).toEqual([
      { reason: "failed", sessionId: first.sessionId },
    ]);
    expect(
      host.send(first.sessionId, '{"jsonrpc":"2.0","method":"exit"}')
    ).toBe(false);
    expect(
      host.send(second.sessionId, '{"jsonrpc":"2.0","method":"exit"}')
    ).toBe(true);
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).toContain("invalid-header");
    expect(logged).not.toContain("SECRET_PROTOCOL_BODY");
    expect(logged).not.toContain("Content-Length");

    firstTree.resolveTerminal();
    firstChild.exit(0);
    secondChild.exit(0);
    await host.dispose();
  });

  it("contains an asynchronous POSIX spawn failure without a pid until tree cleanup is terminal", async () => {
    const child = new FakeLspChild();
    Object.defineProperty(child, "pid", { value: undefined });
    const tree = createFakeProcessTree(true);
    const launchError = new Error("spawn ENOENT");
    const emittedWithoutThrow = Promise.withResolvers<boolean>();
    const spawnImpl = vi.fn(() => {
      queueMicrotask(() => {
        try {
          child.emit("error", launchError);
          child.emit("close", null, null);
          emittedWithoutThrow.resolve(true);
        } catch {
          emittedWithoutThrow.resolve(false);
        }
      });
      return child;
    }) as unknown as typeof spawn;
    const host = createHost(spawnImpl, () => tree);
    const outcomes: Record<string, unknown>[] = [];
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const session = host.ensure({
      clientRole: "editor",
      launch: launch("missing-ls"),
      onClose: (event) => outcomes.push(event),
      onMessage: () => undefined,
      rootPath: "/repo",
      serverId: "typescript",
      webContentsId: 1,
      workspaceKey: "main:/repo",
    });

    await expect(emittedWithoutThrow.promise).resolves.toBe(true);
    await flushMicrotasks();
    expect(outcomes).toEqual([
      { reason: "failed", sessionId: session.sessionId },
    ]);

    const cleanup = host.close(session.sessionId, "client-release");
    let cleanupSettled = false;
    cleanup.then(() => {
      cleanupSettled = true;
    });
    await flushMicrotasks();
    expect(cleanupSettled).toBe(false);

    tree.resolveTerminal();
    await expect(cleanup).resolves.toBe(true);
    expect(tree.close).toHaveBeenCalledOnce();
    expect(cleanupSettled).toBe(true);
    expect(outcomes).toHaveLength(1);
    await expect(host.close(session.sessionId, "client-release")).resolves.toBe(
      false
    );
  });

  it("keeps the first requested cause sticky and resolves close only at tree terminal", async () => {
    const child = new FakeLspChild();
    const tree = createFakeProcessTree(true);
    const host = createHost(
      vi.fn(() => child) as unknown as typeof spawn,
      () => tree
    );
    const outcomes: Record<string, unknown>[] = [];
    const session = host.ensure({
      clientRole: "editor",
      launch: launch(),
      onClose: (event) => outcomes.push(event),
      onMessage: () => undefined,
      rootPath: "/repo",
      serverId: "typescript",
      webContentsId: 1,
      workspaceKey: "main:/repo",
    });

    const firstClose = host.close(session.sessionId, "workspace-evicted");
    const concurrentClose = host.close(session.sessionId, "policy-disabled");
    expect(concurrentClose).toBe(firstClose);
    child.exit(0);
    await flushMicrotasks();

    expect(outcomes).toEqual([
      {
        cause: "workspace-evicted",
        reason: "closed",
        sessionId: session.sessionId,
      },
    ]);
    let settled = false;
    firstClose.then(() => {
      settled = true;
    });
    await flushMicrotasks();
    expect(settled).toBe(false);

    await host.retryTermination([session.sessionId]);
    expect(tree.gracefulTerminate).toHaveBeenCalledOnce();
    expect(outcomes).toHaveLength(1);

    tree.resolveTerminal();
    await expect(firstClose).resolves.toBe(true);
    expect(settled).toBe(true);
    expect(outcomes).toHaveLength(1);
  });

  it("retries failed handle closure and releases the retained policy tree barrier", async () => {
    const child = new FakeLspChild();
    const tree = createFakeProcessTree(false);
    const closeFailure = new Error("job handle close failed");
    tree.close.mockRejectedValueOnce(closeFailure).mockResolvedValue(undefined);
    const host = createHost(
      vi.fn(() => child) as unknown as typeof spawn,
      () => tree
    );
    const policy = new WorkspaceLspPolicy();
    const workspaceKey = "main:/repo";
    policy.acquire({
      isWorktree: false,
      kind: "local",
      rootPath: "/repo",
      workspaceKey,
    });
    let treeTerminalSettled = false;
    const session = host.ensure({
      clientRole: "editor",
      launch: launch(),
      onClose: (event, treeTerminal) => {
        policy.markTreeDraining(workspaceKey, event.sessionId);
        treeTerminal.then(() => {
          treeTerminalSettled = true;
          policy.release(workspaceKey, event.sessionId);
          policy.markTreeTerminal(event.sessionId);
        });
      },
      onMessage: () => undefined,
      rootPath: "/repo",
      serverId: "typescript",
      webContentsId: 1,
      workspaceKey,
    });
    policy.bindSession(workspaceKey, session.sessionId);

    const closing = host.close(session.sessionId, "client-release");
    child.exit(0);
    await expect(closing).rejects.toBe(closeFailure);
    expect(policy.hasTreeBlocker(workspaceKey)).toBe(true);
    expect(policy.sessionsOf(workspaceKey)).toContain(session.sessionId);

    await host.retryTermination([session.sessionId]);
    await flushMicrotasks();

    expect(tree.close).toHaveBeenCalledTimes(2);
    expect(treeTerminalSettled).toBe(true);
    expect(policy.hasTreeBlocker(workspaceKey)).toBe(false);
    expect(policy.sessionsOf(workspaceKey)).not.toContain(session.sessionId);
    await expect(host.close(session.sessionId, "client-release")).resolves.toBe(
      false
    );
  });

  it("exposes an abnormal cleanup attempt rejection while retry can later settle the terminal", async () => {
    const child = new FakeLspChild();
    const tree = createFakeProcessTree(false);
    const cleanupFailure = new Error("job handle close failed");
    const finalCleanup = Promise.withResolvers<void>();
    const secondCleanupStarted = Promise.withResolvers<void>();
    tree.close
      .mockRejectedValueOnce(cleanupFailure)
      .mockImplementationOnce(async () => {
        secondCleanupStarted.resolve();
        await finalCleanup.promise;
      });
    const host = createHost(
      vi.fn(() => child) as unknown as typeof spawn,
      () => tree
    );
    const closed = Promise.withResolvers<{ terminal: Promise<void> }>();
    const session = host.ensure({
      clientRole: "editor",
      launch: launch(),
      onClose: (_event, terminal) => closed.resolve({ terminal }),
      onMessage: () => undefined,
      rootPath: "/repo",
      serverId: "typescript",
      webContentsId: 1,
      workspaceKey: "main:/repo",
    });

    child.emit("error", new Error("server pipe failed"));
    child.exit(1);
    const { terminal } = await closed.promise;

    let terminalSettled = false;
    const terminalSettlement = terminal.then(() => {
      terminalSettled = true;
    });
    const attemptSettlement = host
      .close(session.sessionId, "client-release")
      .then(
        () => ({ kind: "resolved" as const }),
        (error: unknown) => ({ error, kind: "rejected" as const })
      );

    await expect(attemptSettlement).resolves.toEqual({
      error: cleanupFailure,
      kind: "rejected",
    });
    expect(terminalSettled).toBe(false);

    let retrySettled = false;
    const retry = host.retryTermination([session.sessionId]);
    const retrySettlement = retry.then(() => {
      retrySettled = true;
    });
    await secondCleanupStarted.promise;
    expect(tree.close).toHaveBeenCalledTimes(2);
    expect(retrySettled).toBe(false);
    expect(terminalSettled).toBe(false);

    finalCleanup.resolve();
    await retrySettlement;
    await terminalSettlement;
  });
});
