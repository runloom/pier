/**
 * 架构能力闭环验收（非产品功能清单）：
 * 1) 凭证签发 → put → hello/self
 * 2) 统一 authorize + effect receipt
 * 3) subscribe 真 event 管道
 * 4) hold 长请求 + cancel
 */
import { mkdtemp, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPierLocalControlServer,
  resolveLocalControlSocketPath,
} from "@main/adapters/cli/local-control/server.ts";
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

async function userData(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pier-arch-loop-"));
  tempDirs.push(dir);
  return dir;
}

function collectFrames(
  socketPath: string,
  lines: string[],
  count: number,
  timeoutMs = 5000
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    const frames: unknown[] = [];
    let body = "";
    let settled = false;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(
        new Error(`timeout waiting for ${count} frames, got ${frames.length}`)
      );
    }, timeoutMs);
    const done = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
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
        const line = body.slice(0, nl);
        body = body.slice(nl + 1);
        if (!line) {
          continue;
        }
        frames.push(JSON.parse(line));
        if (frames.length >= count) {
          socket.end();
          done();
          return;
        }
      }
    });
    socket.on("error", reject);
    socket.on("end", done);
  });
}

describe("local-control architecture closed loop", () => {
  it("cli-human hello → agents.catalog (product path)", async () => {
    const dir = await userData();
    const socketPath = resolveLocalControlSocketPath(dir);
    const server = createPierLocalControlServer({
      bootId: "boot-arch",
      socketPath,
      handleRequest: async () => {
        throw new Error("v1 unused");
      },
    });
    await server.start();
    try {
      const frames = await collectFrames(
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
            requestId: "s1",
            op: "agents.catalog",
            params: {},
          }),
        ],
        2
      );

      const hello = frames[0] as {
        type: string;
        features: string[];
        principalRef?: string;
      };
      const catalog = frames[1] as { ok: boolean; type: string };
      expect(hello.type).toBe("server.hello");
      expect(hello.principalRef).toBe("human:peer");
      expect(hello.features).toEqual(
        expect.arrayContaining([
          "agents.catalog",
          "stream.subscribe",
          "control.hold",
          "control.trace",
        ])
      );
      expect(hello.features).not.toContain("agents.self");
      expect(catalog.ok).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("control.trace requires effectKey and replays same effectRevision", async () => {
    const dir = await userData();
    const socketPath = resolveLocalControlSocketPath(dir);
    const server = createPierLocalControlServer({
      bootId: "boot-trace",
      socketPath,
      handleRequest: async () => {
        throw new Error("v1 unused");
      },
    });
    await server.start();
    try {
      // 同 session 重放
      const key = "effect_key_0123456789ab"; // 22+ base64url-ish
      const frames = await collectFrames(
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
            requestId: "t1",
            op: "control.trace",
            params: { note: "a" },
            effectKey: key,
          }),
          JSON.stringify({
            apiVersion: LOCAL_CONTROL_API_VERSION,
            type: "request",
            requestId: "t2",
            op: "control.trace",
            params: { note: "a" },
            effectKey: key,
          }),
          JSON.stringify({
            apiVersion: LOCAL_CONTROL_API_VERSION,
            type: "request",
            requestId: "t3",
            op: "control.trace",
            params: { note: "b" },
            effectKey: key,
          }),
        ],
        4
      );
      const a = frames[1] as {
        ok: boolean;
        meta?: { effectRevision: number };
      };
      const b = frames[2] as {
        ok: boolean;
        meta?: { effectRevision: number };
      };
      const conflict = frames[3] as {
        ok: boolean;
        error?: { code: string };
      };
      expect(a.ok).toBe(true);
      expect(a.meta?.effectRevision).toBe(1);
      expect(b.meta?.effectRevision).toBe(1);
      expect(conflict.ok).toBe(false);
      expect(conflict.error?.code).toBe("idempotency_conflict");
    } finally {
      await server.close();
    }
  });

  it("nested param key order is digest-stable (JCS)", async () => {
    const dir = await userData();
    const socketPath = resolveLocalControlSocketPath(dir);
    const server = createPierLocalControlServer({
      bootId: "boot-jcs",
      socketPath,
      handleRequest: async () => {
        throw new Error("v1 unused");
      },
    });
    await server.start();
    try {
      const key = "effect_key_jcs_nested_01";
      const frames = await collectFrames(
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
            requestId: "j1",
            op: "control.trace",
            params: { outer: { z: 1, a: { y: 2, b: 3 } } },
            effectKey: key,
          }),
          // 语义相同、键序不同 → 应重放同一 effectRevision
          JSON.stringify({
            apiVersion: LOCAL_CONTROL_API_VERSION,
            type: "request",
            requestId: "j2",
            op: "control.trace",
            params: { outer: { a: { b: 3, y: 2 }, z: 1 } },
            effectKey: key,
          }),
        ],
        3
      );
      const first = frames[1] as {
        ok: boolean;
        meta?: { effectRevision: number };
      };
      const second = frames[2] as {
        ok: boolean;
        meta?: { effectRevision: number };
        error?: { code: string };
      };
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(second.meta?.effectRevision).toBe(first.meta?.effectRevision);
    } finally {
      await server.close();
    }
  });

  it("subscribe resource:agents emits response + snapshot event", async () => {
    const dir = await userData();
    const socketPath = resolveLocalControlSocketPath(dir);
    const server = createPierLocalControlServer({
      bootId: "boot-sub",
      socketPath,
      discovery: {
        listCatalog: () => [],
        listRunning: () => ({
          ts: 9,
          entries: [
            {
              agentId: "codex",
              agentRef: "w\0p",
              panelId: "p",
              source: "launch",
              updatedAt: 1,
              windowId: "w",
            },
          ],
        }),
      },
      handleRequest: async () => {
        throw new Error("v1 unused");
      },
    });
    await server.start();
    try {
      const frames = await collectFrames(
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
            type: "subscribe",
            requestId: "sub1",
            stream: "resource:agents",
          }),
        ],
        3
      );
      expect(frames[1]).toMatchObject({
        type: "response",
        ok: true,
        data: expect.objectContaining({ stream: "resource:agents" }),
      });
      expect(frames[2]).toMatchObject({
        type: "event",
        mode: "snapshot",
        cursorScope: "resource:agents",
        payload: expect.objectContaining({ ts: 9 }),
      });
    } finally {
      await server.close();
    }
  });

  it("control.hold can be cancelled before completion", async () => {
    const dir = await userData();
    const socketPath = resolveLocalControlSocketPath(dir);
    const server = createPierLocalControlServer({
      bootId: "boot-hold",
      socketPath,
      handleRequest: async () => {
        throw new Error("v1 unused");
      },
    });
    await server.start();
    try {
      const frames = await collectFrames(
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
            requestId: "hold1",
            op: "control.hold",
            params: { ms: 5000 },
          }),
          JSON.stringify({
            apiVersion: LOCAL_CONTROL_API_VERSION,
            type: "cancel",
            requestId: "hold1",
          }),
        ],
        2,
        2000
      );
      // hello + cancel response (hold never completes)
      expect(frames[0]).toMatchObject({ type: "server.hello" });
      expect(frames[1]).toMatchObject({
        type: "response",
        requestId: "hold1",
        ok: true,
        data: { cancelled: true },
      });
    } finally {
      await server.close();
    }
  });
});
