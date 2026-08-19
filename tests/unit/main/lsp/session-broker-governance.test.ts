import type { spawn } from "node:child_process";
import type { LspSessionClosedEvent } from "@shared/contracts/lsp.ts";
import { describe, expect, it, vi } from "vitest";
import { encodeLspMessage } from "../../../../src/main/services/lsp/message-codec.ts";
import { LspSessionBroker } from "../../../../src/main/services/lsp/session-broker.ts";
import { LspSessionHost } from "../../../../src/main/services/lsp/session-host.ts";
import {
  createFakeProcessTree,
  FakeLspChild,
  flushMicrotasks,
  recordLspMessages,
} from "./test-fixtures.ts";

function launch(command = "fake-ls") {
  return {
    args: ["--stdio"] as const,
    command,
    cwd: "/repo",
  };
}

const REAL_KEY_INPUT = {
  rootPath: "/repo",
  serverId: "typescript",
  workspaceKey: "main:/repo",
};

interface ConsumerHarness {
  closed: LspSessionClosedEvent[];
  delivered: Record<string, unknown>[];
  ensured: {
    realSessionId: string;
    reusedReal: boolean;
    virtualSessionId: string;
  };
}

function createHarness() {
  const children: FakeLspChild[] = [];
  const spawnImpl = vi.fn(() => {
    const child = new FakeLspChild(5000 + children.length);
    children.push(child);
    return child;
  }) as unknown as typeof spawn;
  const host = new LspSessionHost({
    processTreeFactory: () => createFakeProcessTree(false),
    spawnImpl,
  });
  const broker = new LspSessionBroker({ host });
  const attachConsumer = (webContentsId: number): ConsumerHarness => {
    const delivered: Record<string, unknown>[] = [];
    const closed: LspSessionClosedEvent[] = [];
    const ensured = broker.ensureEditorSession({
      deliver: (_virtualId, jsonBody) => {
        delivered.push(JSON.parse(jsonBody) as Record<string, unknown>);
      },
      launch: launch(),
      notifyClosed: (_virtualId, event) => {
        closed.push(event);
      },
      webContentsId,
      ...REAL_KEY_INPUT,
    });
    return { closed, delivered, ensured };
  };
  return { attachConsumer, broker, children, host, spawnImpl };
}

/** stream data 事件跨宏任务；setImmediate + 双微任务冲刷保证链路收敛。 */
async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  await flushMicrotasks();
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  await flushMicrotasks();
}

/** 驱动真实会话完成 initialize 握手（服务器应答 runtime 的 initialize 请求）。 */
async function completeInitialize(
  child: FakeLspChild,
  written: { messages: Record<string, unknown>[] }
): Promise<void> {
  await settle();
  const initialize = written.messages.find(
    (message) => message.method === "initialize"
  );
  expect(initialize).toBeDefined();
  child.stdout.write(
    encodeLspMessage(
      JSON.stringify({
        id: initialize?.id,
        jsonrpc: "2.0",
        result: { capabilities: { hoverProvider: true } },
      })
    )
  );
  await settle();
}

describe("LspSessionBroker governance", () => {
  it("keeps exactly one process tree per (workspaceKey, serverId, rootPath) across any consumer mix", async () => {
    const { attachConsumer, broker, children, host, spawnImpl } =
      createHarness();

    const editorA = attachConsumer(1);
    const editorB = attachConsumer(2);
    const editorARepeat = attachConsumer(1);
    const languageTools = broker.ensureRealSession({
      launch: launch(),
      ...REAL_KEY_INPUT,
    });

    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(broker.realSessionCount()).toBe(1);
    expect(editorA.ensured.realSessionId).toBe(editorB.ensured.realSessionId);
    expect(languageTools.realSessionId).toBe(editorA.ensured.realSessionId);
    // 同 webContents 幂等：虚拟会话复用；跨 webContents 各自持有虚拟会话。
    expect(editorARepeat.ensured.virtualSessionId).toBe(
      editorA.ensured.virtualSessionId
    );
    expect(editorB.ensured.virtualSessionId).not.toBe(
      editorA.ensured.virtualSessionId
    );
    // renderer 不可见真实会话 id。
    expect(editorA.ensured.virtualSessionId).not.toBe(
      editorA.ensured.realSessionId
    );

    children[0]?.exit(0);
    await host.dispose();
  });

  it("initializes the real server once with Pier capabilities and synthesizes replies for later consumers", async () => {
    const { attachConsumer, broker, children, host } = createHarness();
    const editorA = attachConsumer(1);
    const child = children[0] ?? new FakeLspChild();
    const written = recordLspMessages(child.stdin);

    expect(
      broker.handleEditorSend(
        editorA.ensured.virtualSessionId,
        JSON.stringify({
          capabilities: undefined,
          id: 0,
          jsonrpc: "2.0",
          method: "initialize",
          params: { capabilities: { textDocument: { hover: {} } } },
        }),
        1
      )
    ).toBe(true);
    await completeInitialize(child, written);

    const initializeMessages = written.messages.filter(
      (message) => message.method === "initialize"
    );
    expect(initializeMessages).toHaveLength(1);
    const params = initializeMessages[0]?.params as {
      capabilities?: { workspace?: unknown };
      clientInfo?: { name?: string };
    };
    // 服务器看到的是 Pier 超集能力，不是消费者自带声明。
    expect(params.clientInfo?.name).toBe("Pier");
    expect(params.capabilities?.workspace).toEqual({ symbol: {} });
    expect(editorA.delivered).toEqual([
      {
        id: 0,
        jsonrpc: "2.0",
        result: { capabilities: { hoverProvider: true } },
      },
    ]);
    const initializedNotifications = written.messages.filter(
      (message) => message.method === "initialized"
    );
    expect(initializedNotifications).toHaveLength(1);

    // 第二个消费者的 initialize 由缓存合成，服务器不再收到握手。
    const editorB = attachConsumer(2);
    broker.handleEditorSend(
      editorB.ensured.virtualSessionId,
      JSON.stringify({ id: 7, jsonrpc: "2.0", method: "initialize" }),
      2
    );
    broker.handleEditorSend(
      editorB.ensured.virtualSessionId,
      JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }),
      2
    );
    await settle();
    expect(editorB.delivered).toEqual([
      {
        id: 7,
        jsonrpc: "2.0",
        result: { capabilities: { hoverProvider: true } },
      },
    ]);
    expect(
      written.messages.filter((message) => message.method === "initialize")
    ).toHaveLength(1);
    expect(
      written.messages.filter((message) => message.method === "initialized")
    ).toHaveLength(1);

    child.exit(0);
    await host.dispose();
  });

  it("rewrites colliding request ids per consumer and unicasts responses; notifications fan out", async () => {
    const { attachConsumer, broker, children, host } = createHarness();
    const editorA = attachConsumer(1);
    const editorB = attachConsumer(2);
    const child = children[0] ?? new FakeLspChild();
    const written = recordLspMessages(child.stdin);

    broker.handleEditorSend(
      editorA.ensured.virtualSessionId,
      JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "textDocument/hover",
        params: { consumer: "a" },
      }),
      1
    );
    broker.handleEditorSend(
      editorB.ensured.virtualSessionId,
      JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "textDocument/hover",
        params: { consumer: "b" },
      }),
      2
    );
    await settle();
    const hoverRequests = written.messages.filter(
      (message) => message.method === "textDocument/hover"
    );
    expect(hoverRequests).toHaveLength(2);
    const [wireA, wireB] = hoverRequests.map((message) => message.id);
    expect(typeof wireA).toBe("string");
    expect(typeof wireB).toBe("string");
    expect(wireA).not.toBe(wireB);

    child.stdout.write(
      encodeLspMessage(
        JSON.stringify({ id: wireB, jsonrpc: "2.0", result: { from: "b" } })
      )
    );
    child.stdout.write(
      encodeLspMessage(
        JSON.stringify({ id: wireA, jsonrpc: "2.0", result: { from: "a" } })
      )
    );
    await settle();
    expect(editorA.delivered).toEqual([
      { id: 1, jsonrpc: "2.0", result: { from: "a" } },
    ]);
    expect(editorB.delivered).toEqual([
      { id: 1, jsonrpc: "2.0", result: { from: "b" } },
    ]);

    child.stdout.write(
      encodeLspMessage(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "textDocument/publishDiagnostics",
          params: { diagnostics: [], uri: "file:///repo/a.ts" },
        })
      )
    );
    await settle();
    expect(editorA.delivered.at(-1)?.method).toBe(
      "textDocument/publishDiagnostics"
    );
    expect(editorB.delivered.at(-1)?.method).toBe(
      "textDocument/publishDiagnostics"
    );

    child.exit(0);
    await host.dispose();
  });

  it("rewrites $/cancelRequest ids onto the wire id of the pending request", async () => {
    const { attachConsumer, broker, children, host } = createHarness();
    const editor = attachConsumer(1);
    const child = children[0] ?? new FakeLspChild();
    const written = recordLspMessages(child.stdin);

    broker.handleEditorSend(
      editor.ensured.virtualSessionId,
      JSON.stringify({
        id: 5,
        jsonrpc: "2.0",
        method: "textDocument/definition",
        params: {},
      }),
      1
    );
    broker.handleEditorSend(
      editor.ensured.virtualSessionId,
      JSON.stringify({
        jsonrpc: "2.0",
        method: "$/cancelRequest",
        params: { id: 5 },
      }),
      1
    );
    await settle();
    const definition = written.messages.find(
      (message) => message.method === "textDocument/definition"
    );
    const cancel = written.messages.find(
      (message) => message.method === "$/cancelRequest"
    );
    expect(cancel?.params).toEqual({ id: definition?.id });

    child.exit(0);
    await host.dispose();
  });

  it("refcounts didOpen/didClose across consumers through the document gate", async () => {
    const { attachConsumer, broker, children, host } = createHarness();
    const editorA = attachConsumer(1);
    const editorB = attachConsumer(2);
    const child = children[0] ?? new FakeLspChild();
    const written = recordLspMessages(child.stdin);
    const uri = "file:///repo/a.ts";
    const didOpen = (text: string) =>
      JSON.stringify({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: { languageId: "typescript", text, uri, version: 1 },
        },
      });
    const didClose = JSON.stringify({
      jsonrpc: "2.0",
      method: "textDocument/didClose",
      params: { textDocument: { uri } },
    });

    broker.handleEditorSend(
      editorA.ensured.virtualSessionId,
      didOpen("let a = 1;\n"),
      1
    );
    // 同文本的第二个 didOpen 吞掉；服务器只保留一次 open。
    broker.handleEditorSend(
      editorB.ensured.virtualSessionId,
      didOpen("let a = 1;\n"),
      2
    );
    await settle();
    expect(
      written.messages.filter(
        (message) => message.method === "textDocument/didOpen"
      )
    ).toHaveLength(1);

    // A 关闭：B 仍持有 → 不下发 didClose。
    broker.handleEditorSend(editorA.ensured.virtualSessionId, didClose, 1);
    await settle();
    expect(
      written.messages.filter(
        (message) => message.method === "textDocument/didClose"
      )
    ).toHaveLength(0);

    // B 关闭：末位引用 → 下发 didClose。
    broker.handleEditorSend(editorB.ensured.virtualSessionId, didClose, 2);
    await settle();
    expect(
      written.messages.filter(
        (message) => message.method === "textDocument/didClose"
      )
    ).toHaveLength(1);

    // 不同文本的后来者归并为全文 didChange 而不是二次 didOpen。
    broker.handleEditorSend(
      editorA.ensured.virtualSessionId,
      didOpen("let a = 1;\n"),
      1
    );
    broker.handleEditorSend(
      editorB.ensured.virtualSessionId,
      didOpen("let a = 2;\n"),
      2
    );
    await settle();
    expect(
      written.messages.filter(
        (message) => message.method === "textDocument/didOpen"
      )
    ).toHaveLength(2);
    const change = written.messages.find(
      (message) => message.method === "textDocument/didChange"
    );
    expect(change?.params).toMatchObject({
      contentChanges: [{ text: "let a = 2;\n" }],
    });

    child.exit(0);
    await host.dispose();
  });

  it("resolves language-tools document open without disk sync while an editor holds the uri", async () => {
    const { attachConsumer, broker, children, host } = createHarness();
    const editor = attachConsumer(1);
    const child = children[0] ?? new FakeLspChild();
    const written = recordLspMessages(child.stdin);
    const uri = "file:///repo/a.ts";

    broker.handleEditorSend(
      editor.ensured.virtualSessionId,
      JSON.stringify({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            languageId: "typescript",
            text: "editor buffer\n",
            uri,
            version: 1,
          },
        },
      }),
      1
    );
    await settle();

    const readText = vi.fn(async () => "disk content\n");
    await broker.ensureLanguageToolsDocumentOpen(
      editor.ensured.realSessionId,
      { languageId: "typescript", uri },
      readText
    );
    await settle();

    // 编辑器缓冲即服务器真相：不读磁盘、不发 didChange 覆盖。
    expect(readText).not.toHaveBeenCalled();
    expect(
      written.messages.filter(
        (message) => message.method === "textDocument/didChange"
      )
    ).toHaveLength(0);
    expect(
      written.messages.filter(
        (message) => message.method === "textDocument/didOpen"
      )
    ).toHaveLength(1);

    child.exit(0);
    await host.dispose();
  });

  it("does not close the real session on last editor release while language-tools is in flight", async () => {
    const { attachConsumer, broker, children, host } = createHarness();
    const editor = attachConsumer(1);
    broker.retainLanguageTools(editor.ensured.realSessionId);

    await broker.releaseEditorSession(editor.ensured.virtualSessionId, 1);
    expect(broker.realSessionCount()).toBe(1);
    expect(broker.consumerVirtualIdsOf(editor.ensured.realSessionId)).toEqual(
      []
    );

    broker.releaseLanguageTools(editor.ensured.realSessionId);
    expect(broker.realSessionCount()).toBe(1);

    children[0]?.exit(0);
    await host.dispose();
  });

  it("keeps the real session alive until the last consumer releases, then closes it", async () => {
    const { attachConsumer, broker, children, host } = createHarness();
    const editorA = attachConsumer(1);
    const editorB = attachConsumer(2);
    const child = children[0] ?? new FakeLspChild();

    await broker.releaseEditorSession(editorA.ensured.virtualSessionId, 1);
    expect(broker.realSessionCount()).toBe(1);
    expect(broker.consumerVirtualIdsOf(editorA.ensured.realSessionId)).toEqual([
      editorB.ensured.virtualSessionId,
    ]);

    const closing = broker.releaseEditorSession(
      editorB.ensured.virtualSessionId,
      2
    );
    child.exit(0);
    await expect(closing).resolves.toBe(true);
    expect(broker.realSessionCount()).toBe(0);
    await host.dispose();
  });

  it("fans out real-session close events with per-consumer virtual ids", async () => {
    const { attachConsumer, broker, children, host } = createHarness();
    const editorA = attachConsumer(1);
    const editorB = attachConsumer(2);
    const child = children[0] ?? new FakeLspChild();

    const closing = host.close(editorA.ensured.realSessionId, "idle-release");
    child.exit(0);
    await closing;
    await settle();

    expect(editorA.closed).toEqual([
      {
        cause: "idle-release",
        reason: "closed",
        sessionId: editorA.ensured.virtualSessionId,
      },
    ]);
    expect(editorB.closed).toEqual([
      {
        cause: "idle-release",
        reason: "closed",
        sessionId: editorB.ensured.virtualSessionId,
      },
    ]);
    expect(broker.realSessionCount()).toBe(0);
    await host.dispose();
  });

  it("routes server-to-client requests to the most recently active consumer only", async () => {
    const { attachConsumer, broker, children, host } = createHarness();
    const editorA = attachConsumer(1);
    const editorB = attachConsumer(2);
    const child = children[0] ?? new FakeLspChild();
    const written = recordLspMessages(child.stdin);

    // B 最近活跃。
    broker.handleEditorSend(
      editorB.ensured.virtualSessionId,
      JSON.stringify({ jsonrpc: "2.0", method: "workspace/didSomething" }),
      2
    );
    child.stdout.write(
      encodeLspMessage(
        JSON.stringify({
          id: 900,
          jsonrpc: "2.0",
          method: "window/showMessageRequest",
          params: { message: "pick" },
        })
      )
    );
    await settle();
    expect(
      editorA.delivered.filter(
        (message) => message.method === "window/showMessageRequest"
      )
    ).toHaveLength(0);
    expect(
      editorB.delivered.filter(
        (message) => message.method === "window/showMessageRequest"
      )
    ).toHaveLength(1);

    // 只有被路由的消费者的应答可回传服务器。
    expect(
      broker.handleEditorSend(
        editorA.ensured.virtualSessionId,
        JSON.stringify({ id: 900, jsonrpc: "2.0", result: null }),
        1
      )
    ).toBe(true);
    broker.handleEditorSend(
      editorB.ensured.virtualSessionId,
      JSON.stringify({ id: 900, jsonrpc: "2.0", result: { pick: 1 } }),
      2
    );
    await settle();
    const replies = written.messages.filter((message) => message.id === 900);
    expect(replies).toEqual([{ id: 900, jsonrpc: "2.0", result: { pick: 1 } }]);

    child.exit(0);
    await host.dispose();
  });

  it("rejects sends and releases from a webContents that does not own the virtual session", async () => {
    const { attachConsumer, broker, children, host } = createHarness();
    const editor = attachConsumer(1);
    const child = children[0] ?? new FakeLspChild();

    expect(
      broker.handleEditorSend(
        editor.ensured.virtualSessionId,
        JSON.stringify({ jsonrpc: "2.0", method: "workspace/x" }),
        999
      )
    ).toBe(false);
    await expect(
      broker.releaseEditorSession(editor.ensured.virtualSessionId, 999)
    ).resolves.toBe(false);
    expect(broker.realSessionCount()).toBe(1);

    child.exit(0);
    await host.dispose();
  });
});
