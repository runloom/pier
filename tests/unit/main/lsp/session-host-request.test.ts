import type { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeLspMessage } from "../../../../src/main/services/lsp/message-codec.ts";
import { LspSessionHost } from "../../../../src/main/services/lsp/session-host.ts";
import { LspResponseError } from "../../../../src/main/services/lsp/session-runtime.ts";
import { createFakeProcessTree, FakeLspChild } from "./test-fixtures.ts";

function createHost(spawnImpl: typeof spawn) {
  return new LspSessionHost({
    processTreeFactory: () => createFakeProcessTree(false),
    spawnImpl,
  });
}

function launch() {
  return {
    args: ["--stdio"] as const,
    command: "fake-ls",
    cwd: "/repo",
  };
}

describe("LspSessionHost.request", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a JSON-RPC request and resolves with the matching response", async () => {
    const child = new FakeLspChild();
    const spawnImpl = vi.fn(() => child) as unknown as typeof spawn;
    const host = createHost(spawnImpl);
    const ensured = host.ensure({
      launch: launch(),
      onMessage: () => undefined,
      rootPath: "/repo",
      serverId: "typescript",
      workspaceKey: "main:/repo",
    });

    // Capture what gets written to stdin
    const written: string[] = [];
    child.stdin.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      written.push(text);
      // Parse the request id and send a response
      const match = text.match(/"id":(-?\d+)/);
      if (match) {
        const id = Number(match[1]);
        expect(id).toBeLessThan(0);
        const response = JSON.stringify({
          id,
          jsonrpc: "2.0",
          result: [
            {
              uri: "file:///repo/a.ts",
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 5 },
              },
            },
          ],
        });
        child.stdout.write(encodeLspMessage(response));
      }
    });

    const result = await host.request(
      ensured.sessionId,
      "textDocument/definition",
      {
        textDocument: { uri: "file:///repo/b.ts" },
        position: { line: 0, character: 0 },
      }
    );

    expect(written.length).toBeGreaterThan(0);
    expect(written[0]).toContain("textDocument/definition");
    expect(Array.isArray(result)).toBe(true);
    if (Array.isArray(result)) {
      expect(result[0]).toHaveProperty("uri", "file:///repo/a.ts");
    }
    child.exit(0);
    await host.dispose();
  });

  it("initializes a cold session before host-owned requests", async () => {
    const child = new FakeLspChild();
    const spawnImpl = vi.fn(() => child) as unknown as typeof spawn;
    const host = createHost(spawnImpl);
    const ensured = host.ensure({
      launch: launch(),
      onMessage: () => undefined,
      rootPath: "/repo",
      serverId: "typescript",
      workspaceKey: "main:/repo",
    });
    const written: string[] = [];
    child.stdin.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      written.push(text);
      if (!text.includes('"method":"initialize"')) {
        return;
      }
      const id = Number(text.match(/"id":(-?\d+)/)?.[1]);
      child.stdout.write(
        encodeLspMessage(
          JSON.stringify({ id, jsonrpc: "2.0", result: { capabilities: {} } })
        )
      );
    });

    await host.ensureInitialized(ensured.sessionId, {
      capabilities: {},
      rootUri: "file:///repo",
    });
    await host.ensureInitialized(ensured.sessionId, {
      capabilities: {},
      rootUri: "file:///repo",
    });

    expect(
      written.filter((message) => message.includes('"method":"initialize"'))
    ).toHaveLength(1);
    expect(
      written.some((message) => message.includes('"method":"initialized"'))
    ).toBe(true);
    child.exit(0);
    await host.dispose();
  });

  it("rejects an in-flight request when its session closes", async () => {
    const child = new FakeLspChild();
    const spawnImpl = vi.fn(() => child) as unknown as typeof spawn;
    const host = createHost(spawnImpl);
    const ensured = host.ensure({
      launch: launch(),
      onMessage: () => undefined,
      rootPath: "/repo",
      serverId: "typescript",
      workspaceKey: "main:/repo",
    });

    const pending = host.request(
      ensured.sessionId,
      "textDocument/definition",
      {}
    );
    const closing = host.close(ensured.sessionId, "client-release");
    await expect(pending).rejects.toThrow("LSP session closing");
    child.exit(0);
    await closing;
  });

  it("rejects server errors as LspResponseError with preserved code, message, and data", async () => {
    const child = new FakeLspChild();
    const host = createHost(vi.fn(() => child) as unknown as typeof spawn);
    const session = host.ensure({
      launch: launch(),
      onMessage: () => undefined,
      rootPath: "/repo",
      serverId: "typescript",
      workspaceKey: "main:/repo",
    });
    child.stdin.on("data", (chunk: Buffer) => {
      const id = Number(chunk.toString("utf8").match(/"id":(-?\d+)/)?.[1]);
      child.stdout.write(
        encodeLspMessage(
          JSON.stringify({
            error: {
              code: -32_802,
              data: { retry: false },
              message: "request cancelled by server",
            },
            id,
            jsonrpc: "2.0",
          })
        )
      );
    });

    const rejection = host.request(
      session.sessionId,
      "textDocument/definition",
      {}
    );
    await expect(rejection).rejects.toBeInstanceOf(LspResponseError);
    await expect(rejection).rejects.toMatchObject({
      code: -32_802,
      data: { retry: false },
      message: "request cancelled by server",
    });
    child.exit(0);
    await host.dispose();
  });

  it("rejects when session does not exist", async () => {
    const host = new LspSessionHost();
    await expect(
      host.request("nonexistent", "textDocument/definition", {})
    ).rejects.toThrow("LSP session not available");
  });
});
