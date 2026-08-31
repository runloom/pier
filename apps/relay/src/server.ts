/**
 * relay 进程装配：HTTP（/hosts/status /pair/relay /healthz）与 WS
 * （/uplink /downlink）同端口（服务端设计 §2/§5/§8）。
 * 无持久化、无密钥材料；日志只含伪匿名 id 与计数（§9 隐私红线）。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, type Server } from "node:http";
import { LOCAL_CONTROL_MAX_FRAME_BYTES } from "@shared/contracts/local-control/errors.ts";
import {
  hostsStatusRequestSchema,
  pairRelayRequestSchema,
} from "@shared/contracts/relay/index.ts";
import { type WebSocket, WebSocketServer } from "ws";
import type { RelayConfig } from "./config.ts";
import { createRelayHub, type RelayLogger } from "./forward.ts";
import { createSlidingWindowLimiter } from "./limits.ts";
import { createRelayRegistry, type RelayRegistry } from "./registry.ts";

const MAX_HTTP_BODY_BYTES = 256 * 1024;

export interface RelayServer {
  close(): Promise<void>;
  listen(): Promise<{ port: number }>;
  registry: RelayRegistry;
}

function isLoopbackAddress(addr: string): boolean {
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

/** 仅在对端是本机反代时采信 X-Forwarded-For 第一跳，避免客户端伪造。 */
export function remoteAddressOf(request: IncomingMessage): string {
  const socketAddr = request.socket.remoteAddress ?? "unknown";
  if (!isLoopbackAddress(socketAddr)) {
    return socketAddr;
  }
  const raw = request.headers["x-forwarded-for"];
  const forwarded = Array.isArray(raw) ? raw[0] : raw;
  if (forwarded === undefined || forwarded.length === 0) {
    return socketAddr;
  }
  const first = forwarded.split(",")[0]?.trim() ?? "";
  return first.length > 0 ? first : socketAddr;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_HTTP_BODY_BYTES) {
        reject(new Error("body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function respondJson(
  response: ServerResponse,
  status: number,
  body: unknown
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

export function createRelayServer(
  config: RelayConfig,
  options: { log?: RelayLogger } = {}
): RelayServer {
  const log: RelayLogger = options.log ?? (() => undefined);
  const registry = createRelayRegistry();
  const hub = createRelayHub({ registry, config, log });

  const statusLimiter = createSlidingWindowLimiter({
    limit: config.statusPerIpPerMinute,
    windowMs: 60_000,
  });
  const redeemIpLimiter = createSlidingWindowLimiter({
    limit: config.redeemsPerIpPerMinute,
    windowMs: 60_000,
  });
  const redeemHostLimiter = createSlidingWindowLimiter({
    limit: config.redeemsPerHostPerHour,
    windowMs: 3_600_000,
  });

  async function handleHostsStatus(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    if (!statusLimiter.hit(remoteAddressOf(request))) {
      respondJson(response, 429, { reason: "rate_limited" });
      return;
    }
    const parsed = hostsStatusRequestSchema.safeParse(
      JSON.parse(await readBody(request))
    );
    if (!parsed.success) {
      respondJson(response, 400, { reason: "relay_error" });
      return;
    }
    respondJson(
      response,
      200,
      parsed.data.map((entry) => ({
        hostId: entry.hostId,
        online:
          registry.isOnline(entry.hostId) &&
          registry.verifyPass(entry.hostId, entry.deviceId, entry.relayPass),
      }))
    );
  }

  async function handlePairRelay(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    if (!redeemIpLimiter.hit(remoteAddressOf(request))) {
      respondJson(response, 429, { reason: "rate_limited" });
      return;
    }
    const parsed = pairRelayRequestSchema.safeParse(
      JSON.parse(await readBody(request))
    );
    if (!parsed.success) {
      respondJson(response, 400, { reason: "relay_error" });
      return;
    }
    if (!redeemHostLimiter.hit(parsed.data.hostId)) {
      respondJson(response, 429, { reason: "rate_limited" });
      return;
    }
    const outcome = await hub.redeem(parsed.data.hostId, parsed.data.sealed);
    if (outcome.kind === "failure") {
      respondJson(response, outcome.reason === "host_offline" ? 502 : 504, {
        reason:
          outcome.reason === "host_offline" ? "host_offline" : "relay_error",
      });
      return;
    }
    log("pair.redeem", { hostId: parsed.data.hostId, ok: outcome.ok });
    respondJson(response, 200, { sealed: outcome.sealedResult });
  }

  const routes: Record<
    string,
    (request: IncomingMessage, response: ServerResponse) => Promise<void>
  > = {
    "GET /healthz": (_request, response) => {
      respondJson(response, 200, { ok: true });
      return Promise.resolve();
    },
    "POST /hosts/status": handleHostsStatus,
    "POST /pair/relay": handlePairRelay,
  };

  const httpServer: Server = createServer((request, response) => {
    const route = `${request.method} ${request.url?.split("?")[0]}`;
    const handler = routes[route];
    if (!handler) {
      respondJson(response, 404, { reason: "relay_error" });
      return;
    }
    handler(request, response).catch(() => {
      if (!response.headersSent) {
        respondJson(response, 400, { reason: "relay_error" });
      }
    });
  });

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: LOCAL_CONTROL_MAX_FRAME_BYTES,
  });

  httpServer.on("upgrade", (request, socket, head) => {
    const path = request.url?.split("?")[0];
    if (path !== "/uplink" && path !== "/downlink") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const remoteAddress = remoteAddressOf(request);
      armLiveness(ws);
      if (path === "/uplink") {
        hub.attachUplink(ws, remoteAddress);
      } else {
        hub.attachDownlink(ws, remoteAddress);
      }
    });
  });

  const liveness = new WeakMap<WebSocket, boolean>();
  function armLiveness(client: WebSocket): void {
    liveness.set(client, true);
    client.on("pong", () => {
      liveness.set(client, true);
    });
    client.on("message", () => {
      liveness.set(client, true);
    });
  }

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (liveness.get(client) === false) {
        client.terminate();
        continue;
      }
      liveness.set(client, false);
      if (client.readyState === client.OPEN) {
        client.ping();
      }
    }
  }, config.heartbeatIntervalMs);
  heartbeat.unref?.();

  return {
    registry,
    listen() {
      return new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(config.port, () => {
          const address = httpServer.address();
          const port =
            typeof address === "object" && address !== null
              ? address.port
              : config.port;
          log("relay.listen", { port });
          resolve({ port });
        });
      });
    },
    close() {
      clearInterval(heartbeat);
      for (const client of wss.clients) {
        client.terminate();
      }
      return new Promise((resolve) => {
        httpServer.close(() => resolve());
      });
    },
  };
}
