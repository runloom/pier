/**
 * W3 agents runtime 真 socket 闭环（skip peer；fake RuntimeControl）。
 */

import { mkdtemp, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPierLocalControlServer } from "@main/adapters/cli/local-control/server.ts";
import { createFakeTerminalBackend } from "@main/services/runtime-control/fake-backend.ts";
import { createRuntimeControlService } from "@main/services/runtime-control/service.ts";
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

function strongKey(seed: string): string {
  return `${seed}${"x".repeat(24)}`.slice(0, 32);
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
        try {
          frames.push(JSON.parse(line));
        } catch {
          /* ignore */
        }
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

describe("agents runtime over real local-control socket", () => {
  it("start → turn → screen → terminate", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-rt-sock-"));
    tempDirs.push(dir);
    const socketPath = join(dir, "pier-control.sock");
    const backend = createFakeTerminalBackend();
    const runtimeControl = createRuntimeControlService({
      bootId: "boot_sock",
      backend,
      nowMs: () => 100,
    });
    const server = createPierLocalControlServer({
      socketPath,
      bootId: "boot_sock",
      skipPeerCheck: true,
      runtimeControl,
      handleRequest: async () => ({
        ok: false,
        requestId: "unused",
        error: { code: "invalid_command", message: "v1 unused" },
      }),
    });
    await server.start();
    try {
      const hello = JSON.stringify({
        apiVersion: LOCAL_CONTROL_API_VERSION,
        type: "client.hello",
        requestId: "h1",
        clientKind: "cli-human",
        auth: { method: "none" },
      });
      const start = JSON.stringify({
        apiVersion: LOCAL_CONTROL_API_VERSION,
        type: "request",
        requestId: "r-start",
        op: "agents.start",
        effectKey: strongKey("start"),
        params: {
          agentId: "codex",
          cwd: "/tmp/repo",
          origin: { panelId: "panel_sock", windowId: "win_sock" },
        },
      });
      const frames1 = (await collectFrames(
        socketPath,
        [hello, start],
        2
      )) as Array<{
        type?: string;
        ok?: boolean;
        bootId?: string;
        features?: string[];
        data?: {
          runtime?: { bootId: string; runtimeId: string; generation: number };
          panelId?: string;
        };
      }>;
      expect(frames1[0]?.type).toBe("server.hello");
      expect(frames1[0]?.bootId).toBe("boot_sock");
      expect(frames1[0]?.features).toContain("agents.start");
      expect(frames1[1]?.ok).toBe(true);
      const runtime = frames1[1]?.data?.runtime;
      expect(runtime?.generation).toBe(1);
      if (!runtime) {
        return;
      }
      backend.setViewport(runtime.runtimeId, "line-a\nline-b");

      const turn = JSON.stringify({
        apiVersion: LOCAL_CONTROL_API_VERSION,
        type: "request",
        requestId: "r-turn",
        op: "agents.turn",
        effectKey: strongKey("turn"),
        params: {
          bootId: runtime.bootId,
          runtimeId: runtime.runtimeId,
          generation: runtime.generation,
          text: "hi\n",
        },
      });
      const screen = JSON.stringify({
        apiVersion: LOCAL_CONTROL_API_VERSION,
        type: "request",
        requestId: "r-screen",
        op: "agents.screen",
        params: {
          bootId: runtime.bootId,
          runtimeId: runtime.runtimeId,
          generation: runtime.generation,
        },
      });
      const stop = JSON.stringify({
        apiVersion: LOCAL_CONTROL_API_VERSION,
        type: "request",
        requestId: "r-stop",
        op: "agents.terminate",
        effectKey: strongKey("stop"),
        params: {
          bootId: runtime.bootId,
          runtimeId: runtime.runtimeId,
          generation: runtime.generation,
        },
      });
      // new connection for remaining ops (simple client)
      const frames2 = (await collectFrames(
        socketPath,
        [hello.replace("h1", "h2"), turn, screen, stop],
        4,
        8000
      )) as Array<{
        type?: string;
        requestId?: string;
        ok?: boolean;
        data?: {
          accepted?: boolean;
          screen?: { text?: string };
          terminated?: boolean;
        };
        error?: { code?: string; message?: string };
      }>;
      const byId = Object.fromEntries(
        frames2
          .filter((f) => f.type === "response" && f.requestId)
          .map((f) => [f.requestId as string, f])
      );
      expect(byId["r-turn"]?.ok, JSON.stringify(byId["r-turn"])).toBe(true);
      expect(byId["r-turn"]?.data?.accepted).toBe(true);
      expect(byId["r-screen"]?.data?.screen?.text).toContain("line-b");
      expect(byId["r-stop"]?.data?.terminated).toBe(true);
    } finally {
      await server.close();
    }
  });
});
