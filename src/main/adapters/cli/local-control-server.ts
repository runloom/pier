import { createHash } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PierCommandResult } from "@shared/contracts/commands.ts";

export interface PierLocalControlServer {
  close(): Promise<void>;
  start(): Promise<void>;
}

export interface CreatePierLocalControlServerArgs {
  handleRequest(envelope: unknown): Promise<PierCommandResult>;
  socketPath: string;
}

const SOCKET_FILENAME = "pier-control.sock";
const UNIX_SOCKET_PATH_MAX_BYTES = 103;

function stablePipeSuffix(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function shortUnixSocketPath(userDataDir: string): string {
  return join(tmpdir(), `pier-control-${stablePipeSuffix(userDataDir)}.sock`);
}

export function resolveLocalControlSocketPath(
  userDataDir: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === "win32") {
    return `\\\\.\\pipe\\pier-control-${stablePipeSuffix(userDataDir)}`;
  }
  const socketPath = join(userDataDir, SOCKET_FILENAME);
  if (Buffer.byteLength(socketPath) <= UNIX_SOCKET_PATH_MAX_BYTES) {
    return socketPath;
  }
  return shortUnixSocketPath(userDataDir);
}

function failure(
  requestId: string,
  code: "invalid_command" | "internal_error",
  message: string
): PierCommandResult {
  return {
    error: { code, message },
    ok: false,
    requestId,
  };
}

function writeResult(socket: Socket, result: PierCommandResult): void {
  socket.end(`${JSON.stringify(result)}\n`);
}

function requestIdOf(value: unknown): string {
  if (
    value &&
    typeof value === "object" &&
    "requestId" in value &&
    typeof value.requestId === "string" &&
    value.requestId.length > 0
  ) {
    return value.requestId;
  }
  return "unknown";
}

function removeStaleSocket(socketPath: string): void {
  if (process.platform === "win32") {
    return;
  }
  mkdirSync(dirname(socketPath), { recursive: true });
  if (existsSync(socketPath)) {
    unlinkSync(socketPath);
  }
}

export function createPierLocalControlServer({
  handleRequest,
  socketPath,
}: CreatePierLocalControlServerArgs): PierLocalControlServer {
  let server: Server | null = null;

  return {
    close() {
      return new Promise((resolve, reject) => {
        if (!server) {
          resolve();
          return;
        }
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          server = null;
          resolve();
        });
      });
    },
    start() {
      return new Promise((resolve, reject) => {
        removeStaleSocket(socketPath);
        server = createServer((socket) => {
          let body = "";
          socket.setEncoding("utf8");
          socket.on("data", (chunk) => {
            body += chunk;
            if (!body.includes("\n")) {
              return;
            }
            const line = body.slice(0, body.indexOf("\n"));
            let envelope: unknown;
            try {
              envelope = JSON.parse(line);
            } catch {
              writeResult(
                socket,
                failure("unknown", "invalid_command", "invalid JSON request")
              );
              return;
            }
            Promise.resolve()
              .then(() => handleRequest(envelope))
              .then((result) => writeResult(socket, result))
              .catch((error: unknown) => {
                writeResult(
                  socket,
                  failure(
                    requestIdOf(envelope),
                    "internal_error",
                    error instanceof Error ? error.message : String(error)
                  )
                );
              });
          });
        });
        server.once("error", reject);
        server.listen(socketPath, () => {
          server?.off("error", reject);
          resolve();
        });
      });
    },
  };
}
