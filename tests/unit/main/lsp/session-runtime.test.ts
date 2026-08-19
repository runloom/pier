import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeLspMessage } from "../../../../src/main/services/lsp/message-codec.ts";
import {
  LSP_EXIT_GRACE_MS,
  LSP_TERM_GRACE_MS,
} from "../../../../src/main/services/lsp/process-termination.ts";
import {
  createLspSessionRuntime,
  LSP_SHUTDOWN_RESPONSE_TIMEOUT_MS,
  LSP_STDERR_LOG_CHUNK_BYTES,
  LSP_STDERR_LOG_SESSION_BYTES,
} from "../../../../src/main/services/lsp/session-runtime.ts";
import {
  createFakeProcessTree,
  FakeLspChild,
  flushMicrotasks,
  recordLspMessages,
} from "./test-fixtures.ts";

function createHarness(options: { treeAlive?: boolean } = {}) {
  const child = new FakeLspChild();
  const tree = createFakeProcessTree(options.treeAlive ?? true);
  const messages: Array<{ body: string; sessionId: string }> = [];
  const outcomes: Record<string, unknown>[] = [];
  const logger = { error: vi.fn(), warn: vi.fn() };
  const runtime = createLspSessionRuntime({
    child,
    logger,
    onMessage: (sessionId, body) => messages.push({ body, sessionId }),
    onOutcome: (event) => outcomes.push(event),
    processTree: tree,
    rootPath: "/repo",
    serverId: "typescript",
    sessionId: "lsp-runtime-1",
    workspaceKey: "main:/repo",
  });
  return { child, logger, messages, outcomes, runtime, tree };
}

async function expectPending(promise: Promise<unknown>) {
  let settled = false;
  promise.finally(() => {
    settled = true;
  });
  await flushMicrotasks();
  expect(settled).toBe(false);
}

function writeResponse(
  child: FakeLspChild,
  message: Record<string, unknown>
): void {
  child.stdout.write(encodeLspMessage(JSON.stringify(message)));
}

describe("LspSessionRuntime JSON-RPC boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers malformed JSON with Parse error and never forwards it", () => {
    const { child, messages, runtime } = createHarness();
    const written = recordLspMessages(child.stdin);

    child.stdout.write(encodeLspMessage('{"jsonrpc":"2.0",'));

    expect(messages).toEqual([]);
    expect(written.messages).toEqual([
      {
        error: { code: -32_700, message: "Parse error" },
        id: null,
        jsonrpc: "2.0",
      },
    ]);
    expect(
      runtime.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "window/workDoneProgress/cancel",
        })
      )
    ).toBe(true);
  });

  it("answers invalid request-like values, drops invalid responses, and forwards valid server messages", () => {
    const { child, messages } = createHarness();
    const written = recordLspMessages(child.stdin);
    const invalidRequest = JSON.stringify({
      id: 7,
      jsonrpc: "2.0",
      method: 17,
    });
    const invalidResponse = JSON.stringify({
      error: { code: -32_600, message: "bad" },
      id: 7,
      jsonrpc: "2.0",
      result: {},
    });
    const notification = JSON.stringify({
      jsonrpc: "2.0",
      method: "window/logMessage",
      params: { message: "ready", type: 3 },
    });

    child.stdout.write(encodeLspMessage(invalidRequest));
    child.stdout.write(encodeLspMessage(invalidResponse));
    child.stdout.write(encodeLspMessage(notification));

    expect(written.messages).toEqual([
      {
        error: { code: -32_600, message: "Invalid Request" },
        id: null,
        jsonrpc: "2.0",
      },
    ]);
    expect(messages).toEqual([
      { body: notification, sessionId: "lsp-runtime-1" },
    ]);
  });

  it("drops response-shaped objects without an id instead of answering Invalid Request", () => {
    const { child, messages } = createHarness();
    const written = recordLspMessages(child.stdin);

    child.stdout.write(
      encodeLspMessage(JSON.stringify({ jsonrpc: "2.0", result: null }))
    );
    child.stdout.write(
      encodeLspMessage(
        JSON.stringify({
          error: { code: -32_603, message: "initialize rejected" },
          jsonrpc: "2.0",
        })
      )
    );

    expect(messages).toEqual([]);
    expect(written.messages).toEqual([]);
  });

  it("rejects fractional JSON-RPC error codes in both directions", () => {
    const { child, messages, runtime } = createHarness();
    const written = recordLspMessages(child.stdin);
    const fractionalError = JSON.stringify({
      error: { code: -32_600.5, message: "fractional" },
      id: 7,
      jsonrpc: "2.0",
    });

    expect(runtime.send(fractionalError)).toBe(false);
    child.stdout.write(encodeLspMessage(fractionalError));

    expect(written.messages).toEqual([]);
    expect(messages).toEqual([]);
  });

  it("bounds stderr log chunks to 8KiB and each session to 64KiB", () => {
    const { child, logger } = createHarness();
    for (let index = 0; index < 10; index += 1) {
      child.stderr.write(Buffer.alloc(10 * 1024, 97 + index));
    }

    const textPayloads = logger.warn.mock.calls
      .map((call) => call.at(-1))
      .filter(
        (value): value is string =>
          typeof value === "string" && !value.includes("suppressed")
      );
    expect(textPayloads.length).toBeGreaterThan(0);
    expect(
      textPayloads.every(
        (payload) =>
          Buffer.byteLength(payload, "utf8") <= LSP_STDERR_LOG_CHUNK_BYTES
      )
    ).toBe(true);
    expect(
      textPayloads.reduce(
        (total, payload) => total + Buffer.byteLength(payload, "utf8"),
        0
      )
    ).toBeLessThanOrEqual(LSP_STDERR_LOG_SESSION_BYTES);
    expect(
      logger.warn.mock.calls.filter((call) =>
        call.some(
          (value) => typeof value === "string" && value.includes("suppressed")
        )
      )
    ).toHaveLength(1);
  });
});

describe("LspSessionRuntime close lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("closes residual documents, waits for shutdown response, then sends exit and ends stdin", async () => {
    const { child, messages, outcomes, runtime, tree } = createHarness({});
    const written = recordLspMessages(child.stdin);
    expect(
      runtime.send(
        JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })
      )
    ).toBe(true);
    await runtime.ensureLanguageToolsDocumentOpen(
      { languageId: "typescript", uri: "file:///repo/a.ts" },
      async () => "const value = 1;\n"
    );

    const closing = runtime.close("client-release");
    await flushMicrotasks();
    const shutdown = written.messages.find(
      (message) => message.method === "shutdown"
    );
    expect(shutdown?.id).toBe("pier:shutdown:lsp-runtime-1");
    expect(written.messages.some((message) => message.method === "exit")).toBe(
      false
    );
    expect(written.messages.slice(-2).map((message) => message.method)).toEqual(
      ["textDocument/didClose", "shutdown"]
    );

    writeResponse(child, {
      id: shutdown?.id,
      jsonrpc: "2.0",
      result: null,
    });
    await flushMicrotasks();
    expect(messages).toEqual([]);
    expect(written.messages.at(-1)).toMatchObject({
      jsonrpc: "2.0",
      method: "exit",
    });
    expect(child.stdin.writableEnded).toBe(true);

    child.exit(0);
    await flushMicrotasks();
    expect(outcomes).toEqual([
      {
        cause: "client-release",
        reason: "closed",
        sessionId: "lsp-runtime-1",
      },
    ]);
    await expectPending(closing);
    tree.resolveTerminal();
    await expect(closing).resolves.toBeUndefined();
    expect(runtime.phase).toBe("closed");
  });

  it("closes a cold session without sending shutdown or exit", async () => {
    const { child, runtime, tree } = createHarness();
    const written = recordLspMessages(child.stdin);

    const closing = runtime.close("owner-destroyed");
    await flushMicrotasks();

    expect(written.messages).toEqual([]);
    expect(child.stdin.writableEnded).toBe(true);
    child.exit(0);
    tree.resolveTerminal();
    await closing;
  });

  it("shares concurrent close, keeps the first cause sticky, and reports it once when the child exits", async () => {
    const { child, outcomes, runtime, tree } = createHarness();

    const first = runtime.close("workspace-evicted");
    const second = runtime.close("policy-disabled");
    expect(second).toBe(first);
    expect(runtime.requestedCloseCause).toBe("workspace-evicted");

    child.exit(0);
    await flushMicrotasks();
    expect(outcomes).toEqual([
      {
        cause: "workspace-evicted",
        reason: "closed",
        sessionId: "lsp-runtime-1",
      },
    ]);
    await expectPending(first);

    tree.resolveTerminal();
    await first;
    child.emit("error", new Error("late stream failure"));
    child.exit(1);
    expect(outcomes).toHaveLength(1);
  });

  it.each([
    "timeout",
    "error",
  ] as const)("does not send exit after shutdown %s and escalates TERM to KILL", async (failure) => {
    const { child, runtime, tree } = createHarness();
    const written = recordLspMessages(child.stdin);
    runtime.send(
      JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })
    );
    const closing = runtime.close("app-quit");
    await flushMicrotasks();
    const shutdown = written.messages.find(
      (message) => message.method === "shutdown"
    );

    if (failure === "timeout") {
      await vi.advanceTimersByTimeAsync(LSP_SHUTDOWN_RESPONSE_TIMEOUT_MS);
    } else {
      writeResponse(child, {
        error: { code: -32_603, message: "shutdown rejected" },
        id: shutdown?.id,
        jsonrpc: "2.0",
      });
      await flushMicrotasks();
    }
    expect(written.messages.some((message) => message.method === "exit")).toBe(
      false
    );

    await vi.advanceTimersByTimeAsync(LSP_EXIT_GRACE_MS);
    expect(tree.gracefulTerminate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(LSP_TERM_GRACE_MS);
    expect(tree.forceTerminate).toHaveBeenCalledOnce();

    child.exit(null, "SIGKILL");
    tree.resolveTerminal();
    await closing;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not escalate when the tree exits naturally during TERM grace and clears every timer", async () => {
    const { child, runtime, tree } = createHarness();
    tree.gracefulTerminate.mockImplementation(async () => {
      child.exit(0);
      tree.resolveTerminal();
    });

    const closing = runtime.close("idle-release");
    await vi.advanceTimersByTimeAsync(LSP_EXIT_GRACE_MS);
    await closing;

    expect(tree.gracefulTerminate).toHaveBeenCalledOnce();
    expect(tree.forceTerminate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps policy-facing close state after protocol outcome until tree terminal", async () => {
    const { child, outcomes, runtime, tree } = createHarness();
    const closing = runtime.close("workspace-evicted");

    child.exit(0);
    await flushMicrotasks();
    expect(outcomes).toHaveLength(1);
    expect(runtime.phase).toBe("terminating");
    expect(runtime.requestedCloseCause).toBe("workspace-evicted");
    await expectPending(closing);

    tree.resolveTerminal();
    await closing;
    expect(runtime.phase).toBe("closed");
    expect(runtime.requestedCloseCause).toBe("workspace-evicted");
  });

  it.each([
    "stdin",
    "stdout",
    "stderr",
  ] as const)("contains asynchronous %s errors and latches one failed outcome", async (streamName) => {
    const { child, outcomes, runtime } = createHarness({ treeAlive: false });
    const failure = Object.assign(new Error(`${streamName} pipe failed`), {
      code: "EPIPE",
    });

    await expect(
      Promise.resolve().then(() => child[streamName].emit("error", failure))
    ).resolves.toBe(true);
    await flushMicrotasks();
    expect(outcomes).toEqual([
      { reason: "failed", sessionId: "lsp-runtime-1" },
    ]);

    child.emit("error", new Error("later child failure"));
    child.exit(1);
    await runtime.terminal;
    expect(outcomes).toHaveLength(1);
  });

  it("keeps an accepted close cause sticky when stdin reports EPIPE", async () => {
    const { child, outcomes, runtime } = createHarness({ treeAlive: false });
    const closing = runtime.close("client-release");

    await expect(
      Promise.resolve().then(() =>
        child.stdin.emit(
          "error",
          Object.assign(new Error("server closed stdin"), { code: "EPIPE" })
        )
      )
    ).resolves.toBe(true);
    child.exit(1);
    await closing;

    expect(outcomes).toEqual([
      {
        cause: "client-release",
        reason: "closed",
        sessionId: "lsp-runtime-1",
      },
    ]);
  });

  it("cancels a pending document read when close starts and never writes document traffic after shutdown", async () => {
    const { child, runtime } = createHarness({
      treeAlive: false,
    });
    const written = recordLspMessages(child.stdin);
    const read = Promise.withResolvers<string>();
    runtime.send(
      JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })
    );
    const syncing = runtime.ensureLanguageToolsDocumentOpen(
      { languageId: "typescript", uri: "file:///repo/slow.ts" },
      () => read.promise
    );
    await flushMicrotasks();

    const closing = runtime.close("client-release");
    await flushMicrotasks();
    const shutdown = written.messages.find(
      (message) => message.method === "shutdown"
    );
    expect(shutdown).toBeDefined();

    read.resolve("export const slow = true;\n");
    await expect(syncing).rejects.toThrow("LSP session closing");
    expect(
      written.messages
        .slice(written.messages.indexOf(shutdown ?? {}))
        .some(
          (message) =>
            message.method === "textDocument/didOpen" ||
            message.method === "textDocument/didChange"
        )
    ).toBe(false);

    writeResponse(child, {
      id: shutdown?.id,
      jsonrpc: "2.0",
      result: null,
    });
    await flushMicrotasks();
    child.exit(0);
    await closing;
  });

  it("reports an unrequested natural exit once and clears request timers", async () => {
    const { child, outcomes, runtime, tree } = createHarness({});
    const pending = runtime.request("workspace/symbol", { query: "value" });

    child.exit(0);
    await expect(pending).rejects.toThrow("LSP session closed");
    expect(outcomes).toEqual([
      { reason: "exited", sessionId: "lsp-runtime-1" },
    ]);
    tree.resolveTerminal();
    await flushMicrotasks();
    expect(vi.getTimerCount()).toBe(0);
  });
});
