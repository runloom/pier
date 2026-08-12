import { mkdtemp, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPierLocalControlServer,
  resolveLocalControlSocketPath,
} from "@main/adapters/cli/local-control/server.ts";
import { createLocalControlSessionFromHello } from "@main/adapters/cli/local-control/session.ts";
import { LOCAL_CONTROL_API_VERSION } from "@shared/contracts/local-control/errors.ts";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeUserData(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pier-lc-v2-"));
  tempDirs.push(dir);
  return dir;
}

function sendLines(
  socketPath: string,
  lines: string[],
  opts?: { readFrames?: number }
): Promise<string[]> {
  const readFrames = opts?.readFrames ?? 1;
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    const frames: string[] = [];
    let body = "";
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(frames);
    };
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      for (const line of lines) {
        socket.write(`${line}\n`);
      }
    });
    socket.on("data", (chunk) => {
      body += chunk;
      while (true) {
        const nl = body.indexOf("\n");
        if (nl < 0) {
          break;
        }
        const frame = body.slice(0, nl);
        body = body.slice(nl + 1);
        if (frame.length > 0) {
          frames.push(frame);
        }
        if (frames.length >= readFrames) {
          socket.end();
          finish();
          return;
        }
      }
    });
    socket.on("error", reject);
    socket.on("end", finish);
  });
}

describe("local-control v2 session unit", () => {
  it("cli-human hello then permission_denied for non-product op", async () => {
    const emitted: unknown[] = [];
    const created = createLocalControlSessionFromHello(
      {
        apiVersion: LOCAL_CONTROL_API_VERSION,
        type: "client.hello",
        requestId: "h1",
        clientKind: "cli-human",
        auth: { method: "none" },
      },
      {
        bootId: "boot-test",
        features: [],
        emit: (f) => emitted.push(f),
      }
    );
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(created.helloFrame).toMatchObject({
      type: "server.hello",
      bootId: "boot-test",
      requestId: "h1",
      features: expect.arrayContaining([
        "agents.catalog",
        "agents.list",
        "agents.get",
        "agents.start",
        "stream.subscribe",
      ]),
    });
    created.session.handleLine(
      JSON.stringify({
        apiVersion: LOCAL_CONTROL_API_VERSION,
        type: "request",
        requestId: "r1",
        op: "agents.not-a-product-op",
        params: {},
      })
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(emitted).toEqual([
      expect.objectContaining({
        type: "response",
        ok: false,
        error: expect.objectContaining({ code: "permission_denied" }),
      }),
    ]);
  });

  it("cli-human rejects agents.self as unsupported", () => {
    const emitted: unknown[] = [];
    const created = createLocalControlSessionFromHello(
      {
        apiVersion: LOCAL_CONTROL_API_VERSION,
        type: "client.hello",
        requestId: "h1",
        clientKind: "cli-human",
        auth: { method: "none" },
      },
      {
        bootId: "boot-test",
        emit: (f) => emitted.push(f),
      }
    );
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    expect(created.helloFrame).toMatchObject({
      type: "server.hello",
      principalRef: "human:peer",
    });
    expect(
      (created.helloFrame as { features: string[] }).features
    ).not.toContain("agents.self");
    created.session.handleLine(
      JSON.stringify({
        apiVersion: LOCAL_CONTROL_API_VERSION,
        type: "request",
        requestId: "self-1",
        op: "agents.self",
        params: {},
      })
    );
    expect(emitted).toEqual([
      expect.objectContaining({
        type: "response",
        ok: false,
        error: expect.objectContaining({ code: "unsupported" }),
      }),
    ]);
  });
});

describe("local-control server v1/v2 split + peer + self", () => {
  it("v1 short request still returns PierCommandResult and closes", async () => {
    const userData = await makeUserData();
    const socketPath = resolveLocalControlSocketPath(userData);
    const server = createPierLocalControlServer({
      bootId: "boot-fixed",
      socketPath,
      handleRequest: async (envelope) => ({
        ok: true,
        requestId:
          typeof envelope === "object" &&
          envelope &&
          "requestId" in envelope &&
          typeof (envelope as { requestId: unknown }).requestId === "string"
            ? (envelope as { requestId: string }).requestId
            : "unknown",
        data: { ok: true },
      }),
    });
    await server.start();
    try {
      const frames = await sendLines(socketPath, [
        JSON.stringify({
          protocolVersion: 1,
          requestId: "v1-1",
          clientId: "cli-local",
          command: { type: "app.status" },
        }),
      ]);
      expect(frames).toHaveLength(1);
      const result = JSON.parse(frames[0] ?? "{}") as {
        ok: boolean;
        requestId: string;
      };
      expect(result).toEqual({
        ok: true,
        requestId: "v1-1",
        data: { ok: true },
      });
    } finally {
      await server.close();
    }
  });

  it("v2 hello + agents.catalog e2e (cli-human)", async () => {
    const userData = await makeUserData();
    const socketPath = resolveLocalControlSocketPath(userData);
    const server = createPierLocalControlServer({
      bootId: "boot-fixed-v2",
      features: [],
      socketPath,
      handleRequest: async () => {
        throw new Error("v1 handler must not run for v2");
      },
    });
    await server.start();
    try {
      const frames = await sendLines(
        socketPath,
        [
          JSON.stringify({
            apiVersion: LOCAL_CONTROL_API_VERSION,
            type: "client.hello",
            requestId: "hello-1",
            clientKind: "cli-human",
            auth: { method: "none" },
          }),
          JSON.stringify({
            apiVersion: LOCAL_CONTROL_API_VERSION,
            type: "request",
            requestId: "op-1",
            op: "agents.catalog",
            params: {},
          }),
        ],
        { readFrames: 2 }
      );
      expect(frames).toHaveLength(2);
      const hello = JSON.parse(frames[0] ?? "{}") as {
        type: string;
        bootId: string;
        features: string[];
        principalRef?: string;
      };
      expect(hello.type).toBe("server.hello");
      expect(hello.bootId).toBe("boot-fixed-v2");
      expect(hello.principalRef).toBe("human:peer");
      expect(hello.features).not.toContain("agents.self");
      const catalog = JSON.parse(frames[1] ?? "{}") as { ok: boolean };
      expect(catalog.ok).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("peer check denies mismatched peer uid before first frame", async () => {
    const userData = await makeUserData();
    const socketPath = resolveLocalControlSocketPath(userData);
    const server = createPierLocalControlServer({
      socketPath,
      resolvePeerUid: () => 999_999,
      handleRequest: async () => ({ ok: true, requestId: "x", data: null }),
    });
    await server.start();
    try {
      const frames = await sendLines(socketPath, [
        JSON.stringify({
          protocolVersion: 1,
          requestId: "v1",
          clientId: "cli-local",
          command: { type: "app.status" },
        }),
      ]);
      const err = JSON.parse(frames[0] ?? "{}") as {
        type?: string;
        code?: string;
        error?: { code: string };
      };
      // v2 server.error before any business frame
      expect(err.type === "server.error" || err.error?.code).toBeTruthy();
      if (err.type === "server.error") {
        expect(err.code).toBe("peer_identity_denied");
      }
      expect(JSON.stringify(err)).not.toMatch(/boot-fixed|Users\//);
    } finally {
      await server.close();
    }
  });

  it("v2 catalog and list work for cli-human", async () => {
    const userData = await makeUserData();
    const socketPath = resolveLocalControlSocketPath(userData);
    const server = createPierLocalControlServer({
      bootId: "boot-disc",
      socketPath,
      handleRequest: async () => {
        throw new Error("v1 must not run");
      },
      discovery: {
        listCatalog: () => [
          {
            agentId: "codex",
            label: "Codex",
            availability: "unknown",
          },
        ],
        listRunning: () => ({
          ts: 1,
          entries: [
            {
              agentId: "codex",
              agentRef: "w1\0p1",
              panelId: "p1",
              source: "launch",
              updatedAt: 1,
              windowId: "w1",
            },
          ],
        }),
      },
    });
    await server.start();
    try {
      const catalogFrames = await sendLines(
        socketPath,
        [
          JSON.stringify({
            apiVersion: LOCAL_CONTROL_API_VERSION,
            type: "client.hello",
            requestId: "h1",
            clientKind: "cli-human",
            auth: { method: "none" },
          }),
          JSON.stringify({
            apiVersion: LOCAL_CONTROL_API_VERSION,
            type: "request",
            requestId: "c1",
            op: "agents.catalog",
            params: {},
          }),
        ],
        { readFrames: 2 }
      );
      const catalog = JSON.parse(catalogFrames[1] ?? "{}") as {
        ok: boolean;
        data?: { agents?: Array<{ agentId: string }> };
      };
      expect(catalog.ok).toBe(true);
      expect(catalog.data?.agents?.[0]?.agentId).toBe("codex");

      const listFrames = await sendLines(
        socketPath,
        [
          JSON.stringify({
            apiVersion: LOCAL_CONTROL_API_VERSION,
            type: "client.hello",
            requestId: "h2",
            clientKind: "cli-human",
            auth: { method: "none" },
          }),
          JSON.stringify({
            apiVersion: LOCAL_CONTROL_API_VERSION,
            type: "request",
            requestId: "l1",
            op: "agents.list",
            params: {},
          }),
        ],
        { readFrames: 2 }
      );
      const list = JSON.parse(listFrames[1] ?? "{}") as {
        ok: boolean;
        data?: { entries?: Array<{ panelId: string }> };
      };
      expect(list.ok).toBe(true);
      expect(list.data?.entries?.[0]?.panelId).toBe("p1");
    } finally {
      await server.close();
    }
  });

  it("v2 non-hello first frame is rejected without calling v1 handler", async () => {
    const userData = await makeUserData();
    const socketPath = resolveLocalControlSocketPath(userData);
    let v1Calls = 0;
    const server = createPierLocalControlServer({
      socketPath,
      handleRequest: async () => {
        v1Calls += 1;
        return { ok: true, requestId: "x", data: null };
      },
    });
    await server.start();
    try {
      const frames = await sendLines(socketPath, [
        JSON.stringify({
          apiVersion: LOCAL_CONTROL_API_VERSION,
          type: "request",
          requestId: "r1",
          op: "agents.list",
          params: {},
        }),
      ]);
      expect(v1Calls).toBe(0);
      const err = JSON.parse(frames[0] ?? "{}") as {
        type: string;
        code: string;
      };
      expect(err.type).toBe("server.error");
      expect(err.code).toBe("protocol_unsupported");
    } finally {
      await server.close();
    }
  });
});
