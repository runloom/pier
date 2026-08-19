import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  controlTimeoutMsForCommand,
  DEFAULT_TIMEOUT_MS,
  invokeLocalControl,
  TERMINAL_OPEN_CONTROL_TIMEOUT_MS,
} from "../../../../packages/plugin-tmux/src/tmux/control-client.ts";

const dirs: string[] = [];
const servers: Array<{ server: Server; sockets: Set<Socket> }> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      ({ server, sockets }) =>
        new Promise<void>((resolve) => {
          for (const socket of sockets) {
            socket.destroy();
          }
          server.close(() => {
            resolve();
          });
        })
    )
  );
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

async function listen(socketPath: string): Promise<Server> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });
  servers.push({ server, sockets });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      resolve();
    });
  });
  return server;
}

describe("local-control v1 client", () => {
  it("gives terminal.open a longer socket wait than other verbs", () => {
    expect(controlTimeoutMsForCommand({ type: "terminal.open" })).toBe(
      TERMINAL_OPEN_CONTROL_TIMEOUT_MS
    );
    expect(
      controlTimeoutMsForCommand({ type: "terminal.list" })
    ).toBeUndefined();
    expect(TERMINAL_OPEN_CONTROL_TIMEOUT_MS).toBeGreaterThan(
      DEFAULT_TIMEOUT_MS
    );
    expect(TERMINAL_OPEN_CONTROL_TIMEOUT_MS).toBeGreaterThanOrEqual(25_000);
  });

  it("writes one v1 envelope line and reads one result line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-tmux-sock-"));
    dirs.push(dir);
    const socketPath = join(dir, "control.sock");
    const server = await listen(socketPath);
    const seen: unknown[] = [];
    server.on("connection", (socket) => {
      let buffer = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        const newline = buffer.indexOf("\n");
        if (newline === -1) {
          return;
        }
        const envelope = JSON.parse(buffer.slice(0, newline)) as {
          clientId: string;
          command: unknown;
          protocolVersion: number;
          requestId: string;
        };
        seen.push(envelope);
        socket.write(
          `${JSON.stringify({
            data: { panelId: "p1" },
            ok: true,
            requestId: envelope.requestId,
          })}\n`
        );
      });
    });

    const result = await invokeLocalControl({
      command: { panelId: "p1", type: "terminal.get" },
      socketPath,
    });
    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      clientId: "cli-local",
      command: { panelId: "p1", type: "terminal.get" },
      protocolVersion: 1,
    });
  });

  it("times out when the socket never replies", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pier-tmux-sock-"));
    dirs.push(dir);
    const socketPath = join(dir, "control.sock");
    await listen(socketPath);
    await expect(
      invokeLocalControl({
        command: { type: "terminal.list" },
        socketPath,
        timeoutMs: 40,
      })
    ).rejects.toThrow(/timed out/u);
  });
});
