import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalControlTransport } from "@main/adapters/cli/local-command-client.ts";
import {
  createPierLocalControlServer,
  resolveLocalControlSocketPath,
} from "@main/adapters/cli/local-control-server.ts";
import {
  type PierCommandEnvelope,
  pierCommandEnvelopeSchema,
} from "@shared/contracts/commands.ts";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const WINDOWS_NAMED_PIPE_PATTERN = /^\\\\\.\\pipe\\pier-control-[a-f0-9]{16}$/;

async function sendRawRequest(
  socketPath: string,
  payload: string
): Promise<string> {
  const net = await import("node:net");
  return new Promise<string>((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let body = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      body += chunk;
    });
    socket.on("error", reject);
    socket.on("end", () => resolve(body.trim()));
    socket.write(`${payload}\n`);
  });
}

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pier-local-control-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("resolveLocalControlSocketPath", () => {
  it("在 Unix 平台把 socket 放在 userData 下", () => {
    expect(resolveLocalControlSocketPath("/tmp/pier-user-data", "darwin")).toBe(
      "/tmp/pier-user-data/pier-control.sock"
    );
  });

  it("在 Windows 平台使用稳定 named pipe 路径", () => {
    expect(resolveLocalControlSocketPath("C:/Users/me/Pier", "win32")).toMatch(
      WINDOWS_NAMED_PIPE_PATTERN
    );
  });
});

describe("local control socket", () => {
  it("CLI transport 能向本机控制 server 发送命令信封并读取结果", async () => {
    const userDataDir = await makeTempDir();
    const socketPath = resolveLocalControlSocketPath(userDataDir, "darwin");
    const seen: PierCommandEnvelope[] = [];
    const server = createPierLocalControlServer({
      handleRequest(envelope) {
        const parsed = pierCommandEnvelopeSchema.parse(envelope);
        seen.push(parsed);
        return Promise.resolve({
          data: [{ focused: true, id: "main", recordId: "record-main" }],
          ok: true,
          requestId: parsed.requestId,
        });
      },
      socketPath,
    });

    await server.start();
    const transport = createLocalControlTransport({ socketPath });

    await expect(
      transport.request({
        clientId: "cli-local",
        command: { type: "window.list" },
        protocolVersion: 1,
        requestId: "req-1",
      })
    ).resolves.toEqual({
      data: [{ focused: true, id: "main", recordId: "record-main" }],
      ok: true,
      requestId: "req-1",
    });
    expect(seen).toEqual([
      {
        clientId: "cli-local",
        command: { type: "window.list" },
        protocolVersion: 1,
        requestId: "req-1",
      },
    ]);

    await server.close();
  });

  it("server 对非法 JSON 返回 invalid_command", async () => {
    const userDataDir = await makeTempDir();
    const socketPath = resolveLocalControlSocketPath(userDataDir, "darwin");
    const server = createPierLocalControlServer({
      handleRequest() {
        throw new Error("should not be called");
      },
      socketPath,
    });
    await server.start();

    const response = await sendRawRequest(socketPath, "{not json}");

    expect(JSON.parse(response)).toEqual({
      error: {
        code: "invalid_command",
        message: "invalid JSON request",
      },
      ok: false,
      requestId: "unknown",
    });

    await server.close();
  });

  it("server 对同步抛错的 handler 返回 internal_error", async () => {
    const userDataDir = await makeTempDir();
    const socketPath = resolveLocalControlSocketPath(userDataDir, "darwin");
    const server = createPierLocalControlServer({
      handleRequest() {
        throw new Error("boom");
      },
      socketPath,
    });
    await server.start();

    const response = await sendRawRequest(
      socketPath,
      JSON.stringify({ requestId: "req-sync-throw" })
    );

    expect(JSON.parse(response)).toEqual({
      error: {
        code: "internal_error",
        message: "boom",
      },
      ok: false,
      requestId: "req-sync-throw",
    });

    await server.close();
  });
});
