import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PierCommandResult } from "@shared/contracts/commands.ts";
import { classifyLocalControlFirstFrame } from "@shared/contracts/local-control/classify.ts";
import {
  LOCAL_CONTROL_API_VERSION,
  LOCAL_CONTROL_MAX_FRAME_BYTES,
  type LocalControlErrorCode,
} from "@shared/contracts/local-control/errors.ts";
import type { LocalControlServerFrame } from "@shared/contracts/local-control/frames.ts";
import type { CapabilityAuthority } from "../../../services/capability/authority.ts";
import type { ControlSnapshotService } from "../../../services/control-snapshot/service.ts";
import type { RuntimeControlService } from "../../../services/runtime-control/service.ts";
import {
  checkLocalControlPeerIdentity,
  type ResolvePeerUid,
} from "../peer-identity.ts";
import type { AgentsDiscovery } from "./agents-discovery.ts";
import type { LocalControlAuthorizer } from "./authorize.ts";
import type { ResolveOriginPanel } from "./capability-hot-path.ts";
import type { EffectReceiptStore } from "./receipts.ts";
import {
  createLocalControlSessionFromHello,
  type LocalControlSession,
} from "./session.ts";

export interface PierLocalControlServer {
  /** 当前进程控制面 boot 标识（v2 server.hello）。 */
  readonly bootId: string;
  close(): Promise<void>;
  start(signal?: AbortSignal): Promise<void>;
}

export interface LocalControlV1RequestContext {
  abortSignal?: AbortSignal;
}

export interface CreatePierLocalControlServerArgs {
  /** 统一 authorize（可替换）。 */
  authorizer?: LocalControlAuthorizer | undefined;
  /** 可注入测试；默认随机 UUID。 */
  bootId?: string | undefined;
  /** CapabilityAuthority 热路径。 */
  capabilityAuthority?: CapabilityAuthority | undefined;
  /** 发现数据源。 */
  discovery?: AgentsDiscovery | undefined;
  /** v2 features 广告基线。 */
  features?: readonly string[] | undefined;
  handleRequest(
    envelope: unknown,
    context?: LocalControlV1RequestContext
  ): Promise<PierCommandResult>;
  /** 写 op receipt（可替换）。 */
  receipts?: EffectReceiptStore | undefined;
  /** 强制要求可解析 peer UID（测试拒绝路径）。 */
  requirePeerUid?: boolean | undefined;
  /** agents.start 发起方面板解析（宿主 FA 索引；测试可省）。 */
  resolveOriginPanel?: ResolveOriginPanel | undefined;
  /** T2 peer UID 解析（测试注入）。 */
  resolvePeerUid?: ResolvePeerUid | undefined;
  /** W3 持久运行控制。 */
  runtimeControl?: RuntimeControlService | undefined;
  /** 跳过 peer 检查（仅测试默认路径需要时使用；生产勿开）。 */
  skipPeerCheck?: boolean | undefined;
  /** W4 顶层 snapshot/watch。 */
  snapshotService?: ControlSnapshotService | undefined;
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
  code: "invalid_command" | "internal_error" | "permission_denied",
  message: string
): PierCommandResult {
  return {
    error: { code, message },
    ok: false,
    requestId,
  };
}

function writeV1Result(socket: Socket, result: PierCommandResult): void {
  socket.end(`${JSON.stringify(result)}\n`);
}

function writeControlFrame(
  socket: Socket,
  frame: LocalControlServerFrame
): void {
  const line = `${JSON.stringify(frame)}\n`;
  if (Buffer.byteLength(line, "utf8") > LOCAL_CONTROL_MAX_FRAME_BYTES) {
    const err: LocalControlServerFrame = {
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "server.error",
      code: "frame_too_large",
      message: "response frame exceeds maxFrameBytes",
    };
    socket.write(`${JSON.stringify(err)}\n`);
    return;
  }
  socket.write(line);
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

function hardenUnixSocketPermissions(socketPath: string): void {
  if (process.platform === "win32") {
    return;
  }
  // 只收紧 socket inode；勿 chmod 全局 tmpdir（长路径 fallback 时 parent 是共享目录）
  try {
    chmodSync(socketPath, 0o600);
  } catch {
    // ignore
  }
}

function controlServerError(
  code: LocalControlErrorCode,
  message: string
): LocalControlServerFrame {
  return {
    apiVersion: LOCAL_CONTROL_API_VERSION,
    type: "server.error",
    code,
    message,
  };
}

type ConnectionMode = "first" | "v1" | "session";

function attachConnection(
  socket: Socket,
  ctx: {
    handleRequest(
      envelope: unknown,
      context?: LocalControlV1RequestContext
    ): Promise<PierCommandResult>;
    bootId: string;
    features: readonly string[];
    discovery?: AgentsDiscovery | undefined;
    authorizer?: LocalControlAuthorizer | undefined;
    receipts?: EffectReceiptStore | undefined;
    runtimeControl?: RuntimeControlService | undefined;
    capabilityAuthority?: CapabilityAuthority | undefined;
    resolveOriginPanel?: ResolveOriginPanel | undefined;
    snapshotService?: ControlSnapshotService | undefined;
    resolvePeerUid?: ResolvePeerUid | undefined;
    requirePeerUid?: boolean | undefined;
    skipPeerCheck?: boolean | undefined;
    socketPath: string;
  }
): void {
  if (!ctx.skipPeerCheck) {
    const peer = checkLocalControlPeerIdentity({
      socket,
      socketPath: ctx.socketPath,
      resolvePeerUid: ctx.resolvePeerUid,
      requirePeerUid: ctx.requirePeerUid,
    });
    if (!peer.ok) {
      writeControlFrame(
        socket,
        controlServerError("peer_identity_denied", peer.message)
      );
      socket.end();
      return;
    }
  }

  let buffer = "";
  let mode: ConnectionMode = "first";
  let controlSession: LocalControlSession | null = null;
  let closed = false;
  /** v1 长轮询（notifications.watch 等）在 socket 断开时 abort。 */
  const connectionAbort = new AbortController();

  const endV1 = (result: PierCommandResult) => {
    if (closed) {
      return;
    }
    closed = true;
    mode = "v1";
    writeV1Result(socket, result);
  };

  socket.once("close", () => {
    if (!connectionAbort.signal.aborted) {
      connectionAbort.abort();
    }
    controlSession?.dispose();
    controlSession = null;
  });

  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    if (closed && mode === "v1") {
      return;
    }
    buffer += chunk;

    while (true) {
      const nl = buffer.indexOf("\n");
      if (nl < 0) {
        if (Buffer.byteLength(buffer, "utf8") > LOCAL_CONTROL_MAX_FRAME_BYTES) {
          writeControlFrame(
            socket,
            controlServerError("frame_too_large", "frame exceeds maxFrameBytes")
          );
          socket.end();
          closed = true;
          buffer = "";
        }
        return;
      }

      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      const lineBytes = Buffer.byteLength(line, "utf8");
      if (lineBytes > LOCAL_CONTROL_MAX_FRAME_BYTES) {
        writeControlFrame(
          socket,
          controlServerError("frame_too_large", "frame exceeds maxFrameBytes")
        );
        socket.end();
        closed = true;
        return;
      }

      if (line.length === 0) {
        continue;
      }

      if (mode === "first") {
        let raw: unknown;
        try {
          raw = JSON.parse(line) as unknown;
        } catch {
          endV1(failure("unknown", "invalid_command", "invalid JSON request"));
          return;
        }

        const classified = classifyLocalControlFirstFrame(raw);
        if (classified.kind === "v1") {
          mode = "v1";
          Promise.resolve()
            .then(() =>
              ctx.handleRequest(classified.envelope, {
                abortSignal: connectionAbort.signal,
              })
            )
            .then((result) => endV1(result))
            .catch((error: unknown) => {
              endV1(
                failure(
                  requestIdOf(classified.envelope),
                  "internal_error",
                  error instanceof Error ? error.message : String(error)
                )
              );
            });
          return;
        }

        if (classified.kind === "invalid") {
          if (
            typeof raw === "object" &&
            raw !== null &&
            "apiVersion" in raw &&
            (raw as { apiVersion: unknown }).apiVersion ===
              LOCAL_CONTROL_API_VERSION
          ) {
            writeControlFrame(
              socket,
              controlServerError(classified.code, classified.reason)
            );
            socket.end();
            closed = true;
            return;
          }
          endV1(failure("unknown", "invalid_command", classified.reason));
          return;
        }

        // session-hello
        const created = createLocalControlSessionFromHello(classified.hello, {
          bootId: ctx.bootId,
          features: ctx.features,
          discovery: ctx.discovery,
          authorizer: ctx.authorizer,
          receipts: ctx.receipts,
          runtimeControl: ctx.runtimeControl,
          capabilityAuthority: ctx.capabilityAuthority,
          resolveOriginPanel: ctx.resolveOriginPanel,
          snapshotService: ctx.snapshotService,
          emit: (frame) => {
            if (!closed) {
              writeControlFrame(socket, frame);
            }
          },
        });
        if (!created.ok) {
          writeControlFrame(socket, created.errorFrame);
          socket.end();
          closed = true;
          return;
        }
        mode = "session";
        controlSession = created.session;
        writeControlFrame(socket, created.helloFrame);
        continue;
      }

      if (mode === "session" && controlSession) {
        controlSession.handleLine(line);
      }
    }
  });
}

export function createPierLocalControlServer({
  handleRequest,
  socketPath,
  bootId: bootIdArg,
  features = [],
  discovery,
  authorizer,
  receipts,
  runtimeControl,
  capabilityAuthority,
  snapshotService,
  resolveOriginPanel,
  resolvePeerUid,
  requirePeerUid,
  skipPeerCheck,
}: CreatePierLocalControlServerArgs): PierLocalControlServer {
  const bootId = bootIdArg ?? randomUUID();
  const sockets = new Set<Socket>();
  let server: Server | null = null;
  let closePromise: Promise<void> | null = null;

  return {
    bootId,
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
          attachConnection(socket, {
            handleRequest,
            bootId,
            features,
            discovery,
            authorizer,
            receipts,
            runtimeControl,
            capabilityAuthority,
            snapshotService,
            resolveOriginPanel,
            resolvePeerUid,
            requirePeerUid,
            skipPeerCheck,
            socketPath,
          });
        });
        server.once("error", reject);
        server.listen({ path: socketPath, signal }, () => {
          hardenUnixSocketPermissions(socketPath);
          server?.off("error", reject);
          resolve();
        });
      });
    },
  };
}
