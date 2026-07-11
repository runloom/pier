import { createHash } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PierCommandResult } from "@shared/contracts/commands.ts";

export interface PierLocalControlServer {
  close(): Promise<void>;
  start(signal?: AbortSignal): Promise<void>;
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
  const sockets = new Set<Socket>();
  let server: Server | null = null;
  let closePromise: Promise<void> | null = null;

  return {
    close() {
      if (closePromise) {
        return closePromise;
      }
      const current = server;
      server = null;
      closePromise = new Promise((resolve, reject) => {
        if (!current) {
          resolve();
          return;
        }
        current.close((error) => {
          if (
            error &&
            (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
          ) {
            reject(error);
            return;
          }
          if (process.platform !== "win32" && existsSync(socketPath)) {
            try {
              unlinkSync(socketPath);
            } catch (unlinkError) {
              if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") {
                reject(unlinkError);
                return;
              }
            }
          }
          resolve();
        });
        for (const socket of sockets) {
          socket.destroy();
        }
        sockets.clear();
      });
      return closePromise;
    },
    start(signal) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(
            new DOMException("Local control startup aborted", "AbortError")
          );
          return;
        }
        removeStaleSocket(socketPath);
        server = createServer((socket) => {
          sockets.add(socket);
          socket.once("close", () => sockets.delete(socket));
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
        server.listen({ path: socketPath, signal }, () => {
          server?.off("error", reject);
          resolve();
        });
      });
    },
  };
}
