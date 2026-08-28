/**
 * remote-control listener：HTTP（静态 SPA + POST /pair）与 WebSocket（/ws）同端口。
 * 只绑本网接口：每枚非 internal 非 link-local LAN IPv4 各一枚 http.Server，
 * 外加 127.0.0.1（dev/测试可达）；多 Server 共享同一 request handler 与同一
 * WSS（noServer，挂到每个 http server 的 upgrade 事件）。无 LAN 地址 → start 失败。
 * WS 消息处理由注入的 onWebSocketConnection 接管（session-bridge 装配）；
 * 本层只管路由、升级、帧上限与 per-IP 认证失败限速。
 * clients / executeCommand / sessionDeps 只透存，由 session-bridge 消费。
 */
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { PierClientRegistry } from "@main/app-core/client-registry.ts";
import type { PairingService } from "@main/services/pairing/service.ts";
import type { PierCommandEnvelope } from "@shared/contracts/commands.ts";
import {
  LOCAL_CONTROL_API_VERSION,
  LOCAL_CONTROL_MAX_FRAME_BYTES,
} from "@shared/contracts/local-control/errors.ts";
import type { LocalControlServerError } from "@shared/contracts/local-control/frames.ts";
import { pierPairingRequestSchema } from "@shared/contracts/remote.ts";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import type { CreateLocalControlSessionArgs } from "../cli/local-control/session.ts";
import { listLanIPv4Addresses, pickPortInRange } from "./network.ts";
import { createSpaStaticHandler } from "./static-spa.ts";

/** 同一远端 IP 连续失败上限：达到即限速 60 秒（M1 可信网段基础版，内存态）。 */
export const AUTH_FAILURE_LIMIT = 5;
export const AUTH_FAILURE_THROTTLE_MS = 60_000;
/** POST /pair 请求体上限：配对载荷为小型 JSON，64 KiB 已远超 schema 需要。 */
export const PAIR_BODY_LIMIT_BYTES = 64 * 1024;
/**
 * ws 层硬上限：规格帧上限 + 1 MiB 余量。超限～余量内的帧到达 message 层，
 * 由应用层先发 frame_too_large JSON 再以 1009 断连（规格 T-F3 语义）；
 * 超余量的病态巨帧由 ws 层在 message 事件前直接拦截（bare 1009）。
 */
export const WS_MAX_PAYLOAD_BYTES = LOCAL_CONTROL_MAX_FRAME_BYTES + 1024 * 1024;

export interface AuthFailureThrottle {
  isThrottled(remoteIp: string): boolean;
  recordFailure(remoteIp: string): void;
  recordSuccess(remoteIp: string): void;
}

interface ThrottleEntry {
  failures: number;
  throttledUntil: number;
}

/** per-IP 连续失败计数器：/pair 与 hello（session-bridge）共用。 */
export function createAuthFailureThrottle(
  now: () => number = Date.now
): AuthFailureThrottle {
  const entries = new Map<string, ThrottleEntry>();
  const throttled = (remoteIp: string): boolean => {
    const entry = entries.get(remoteIp);
    if (!entry || entry.throttledUntil === 0) {
      return false;
    }
    if (entry.throttledUntil <= now()) {
      entries.delete(remoteIp);
      return false;
    }
    return true;
  };
  return {
    isThrottled: throttled,
    recordFailure(remoteIp) {
      if (throttled(remoteIp)) {
        return;
      }
      const entry = entries.get(remoteIp) ?? { failures: 0, throttledUntil: 0 };
      entry.failures += 1;
      if (entry.failures >= AUTH_FAILURE_LIMIT) {
        entry.failures = 0;
        entry.throttledUntil = now() + AUTH_FAILURE_THROTTLE_MS;
      }
      entries.set(remoteIp, entry);
    },
    recordSuccess(remoteIp) {
      entries.delete(remoteIp);
    },
  };
}

export interface RemoteControlServer {
  isThrottled(remoteIp: string): boolean;
  recordFailure(remoteIp: string): void;
  recordSuccess(remoteIp: string): void;
  start(): Promise<{ host: string; port: number }>;
  state(): { enabled: boolean; host: string | null; port: number | null };
  stop(): Promise<void>;
}

export interface CreateRemoteControlServerArgs {
  /** 测试 seam：注入 LAN IPv4 列表；缺省走 network.ts 真实枚举。 */
  addresses?: string[];
  clients: PierClientRegistry;
  executeCommand: (envelope: PierCommandEnvelope) => Promise<unknown>;
  onWebSocketConnection: (ws: WebSocket, req: IncomingMessage) => void;
  pairing: PairingService;
  sessionDeps: Omit<CreateLocalControlSessionArgs, "authorizer" | "emit">;
  spaDistDir: string;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
    "content-type": "application/json; charset=utf-8",
  });
  res.end(payload);
}

/** 读取请求体；超限或中断返回 null。超限不毁 socket：丢弃剩余 body 以保证 403 能写回。 */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const { promise, resolve } = Promise.withResolvers<Buffer | null>();
  const chunks: Buffer[] = [];
  let size = 0;
  let settled = false;
  const finish = (value: Buffer | null): void => {
    if (!settled) {
      settled = true;
      resolve(value);
    }
  };
  req.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > limit) {
      req.removeAllListeners("data");
      req.resume();
      finish(null);
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => finish(Buffer.concat(chunks)));
  req.on("error", () => finish(null));
  return promise;
}

export function createRemoteControlServer(
  args: CreateRemoteControlServerArgs
): RemoteControlServer {
  const { onWebSocketConnection, pairing, spaDistDir } = args;
  const spaHandler = createSpaStaticHandler(spaDistDir);
  const throttle = createAuthFailureThrottle();
  const sockets = new Set<WebSocket>();

  let host: string | null = null;
  let port: number | null = null;
  let httpServers: Server[] = [];
  let wss: WebSocketServer | null = null;

  async function handlePair(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const remoteIp = req.socket.remoteAddress ?? "";
    if (throttle.isThrottled(remoteIp)) {
      sendJson(res, 403, { reason: "pairing_invalid" });
      return;
    }
    const body = await readBody(req, PAIR_BODY_LIMIT_BYTES);
    let parsed: unknown = null;
    if (body !== null) {
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch {
        parsed = null;
      }
    }
    const request = pierPairingRequestSchema.safeParse(parsed);
    if (!request.success) {
      sendJson(res, 403, { reason: "pairing_invalid" });
      return;
    }
    const result = pairing.redeemPairingCode(request.data);
    if (!result.ok) {
      throttle.recordFailure(remoteIp);
      sendJson(res, 403, { reason: result.reason });
      return;
    }
    throttle.recordSuccess(remoteIp);
    sendJson(res, 200, {
      deviceId: result.deviceId,
      deviceToken: result.deviceToken,
      grantedCapabilities: result.grantedCapabilities,
      tokenEpoch: result.tokenEpoch,
    });
  }

  function onRequest(req: IncomingMessage, res: ServerResponse): void {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "POST" && pathname === "/pair") {
      handlePair(req, res).catch(() => undefined);
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      spaHandler(req, res);
      return;
    }
    res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    res.end("method not allowed");
  }

  function onUpgrade(
    req: IncomingMessage,
    socket: Parameters<WebSocketServer["handleUpgrade"]>[1],
    head: Buffer
  ): void {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    const throttled = throttle.isThrottled(req.socket.remoteAddress ?? "");
    if (pathname !== "/ws" || throttled || !wss) {
      const status = throttled ? 403 : 404;
      socket.write(
        `HTTP/1.1 ${status} ${status === 403 ? "Forbidden" : "Not Found"}\r\nConnection: close\r\n\r\n`
      );
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      // 协议层错误（含超 maxPayload）：ws 已以 1009 断连，吞掉避免未监听 error 抛出。
      ws.on("error", () => {});
      ws.on("close", () => sockets.delete(ws));
      ws.on("message", (data: RawData) => {
        const size = Array.isArray(data)
          ? data.reduce((sum, chunk) => sum + chunk.length, 0)
          : data.byteLength;
        if (size > LOCAL_CONTROL_MAX_FRAME_BYTES) {
          const frame: LocalControlServerError = {
            apiVersion: LOCAL_CONTROL_API_VERSION,
            code: "frame_too_large",
            message: `frame exceeds ${LOCAL_CONTROL_MAX_FRAME_BYTES} bytes`,
            type: "server.error",
          };
          ws.send(JSON.stringify(frame));
          ws.close(1009, "frame_too_large");
        }
      });
      onWebSocketConnection(ws, req);
    });
  }

  function closeAll(servers: Server[]): Promise<void> {
    return Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
            server.closeIdleConnections();
          })
      )
    ).then(() => undefined);
  }

  return {
    isThrottled: throttle.isThrottled,
    recordFailure: throttle.recordFailure,
    recordSuccess: throttle.recordSuccess,
    async start() {
      if (httpServers.length > 0 && host !== null && port !== null) {
        return { host, port };
      }
      const lanAddresses = args.addresses ?? listLanIPv4Addresses();
      const nextHost = lanAddresses[0];
      if (nextHost === undefined) {
        throw new Error("no LAN IPv4 address available");
      }
      const nextPort = await pickPortInRange();
      // 单 http.Server 只能绑一个地址：每枚 LAN IPv4 一枚 Server，外加 127.0.0.1。
      const bindAddresses = [...new Set([...lanAddresses, "127.0.0.1"])];
      const socketServer = new WebSocketServer({
        maxPayload: WS_MAX_PAYLOAD_BYTES,
        noServer: true,
      });
      const servers = bindAddresses.map(() => {
        const server = createServer(onRequest);
        server.on("upgrade", onUpgrade);
        return server;
      });
      httpServers = servers;
      wss = socketServer;
      try {
        await Promise.all(
          servers.map(
            (server, index) =>
              new Promise<void>((resolve, reject) => {
                server.once("error", reject);
                server.listen(nextPort, bindAddresses[index], resolve);
              })
          )
        );
      } catch (error) {
        httpServers = [];
        wss = null;
        await closeAll(servers).catch(() => {});
        throw error;
      }
      host = nextHost;
      port = nextPort;
      return { host: nextHost, port: nextPort };
    },
    state() {
      return { enabled: httpServers.length > 0, host, port };
    },
    async stop() {
      const servers = httpServers;
      httpServers = [];
      wss = null;
      host = null;
      port = null;
      for (const ws of sockets) {
        ws.terminate();
      }
      sockets.clear();
      await closeAll(servers);
    },
  };
}
