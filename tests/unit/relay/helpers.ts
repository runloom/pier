/** relay 测试助手：Ed25519 宿主身份 + Promise 化 ws 客户端 + 进程内起服务。 */
import { createHash, sign as edSign, generateKeyPairSync } from "node:crypto";
import { WebSocket } from "ws";
import type { RelayConfig } from "../../../apps/relay/src/config.ts";
import {
  createRelayServer,
  type RelayServer,
} from "../../../apps/relay/src/server.ts";

export interface TestHostIdentity {
  hostId: string;
  hostPubKey: string;
  signNonce(nonce: string): string;
}

export function makeHostIdentity(): TestHostIdentity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  const raw = Buffer.from(spki).subarray(-32);
  return {
    hostId: createHash("sha256").update(raw).digest("hex"),
    hostPubKey: raw.toString("base64url"),
    signNonce: (nonce) =>
      edSign(null, Buffer.from(nonce, "utf8"), privateKey).toString(
        "base64url"
      ),
  };
}

export function testRelayConfig(
  overrides: Partial<RelayConfig> = {}
): RelayConfig {
  return {
    port: 0,
    publicUrl: null,
    maxDownlinksPerDevice: 2,
    framesPerSecond: 200,
    helloFailuresPerMinute: 5,
    downlinkHellosPerMinute: 60,
    heartbeatIntervalMs: 30_000,
    redeemsPerHostPerHour: 10,
    redeemsPerIpPerMinute: 5,
    statusPerIpPerMinute: 60,
    pairResultTimeoutMs: 30_000,
    ...overrides,
  };
}

export interface RunningRelay {
  httpUrl: string;
  port: number;
  server: RelayServer;
  stop(): Promise<void>;
  wsUrl: string;
}

export async function startRelay(
  overrides: Partial<RelayConfig> = {}
): Promise<RunningRelay> {
  const server = createRelayServer(testRelayConfig(overrides));
  const { port } = await server.listen();
  return {
    server,
    port,
    httpUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
    stop: () => server.close(),
  };
}

/** Promise 化 ws：帧入队，`next()` 取下一帧；`closed` 在断开时 resolve。 */
export class WsClient {
  readonly closed: Promise<void>;
  private readonly queue: unknown[] = [];
  private readonly waiters: Array<(frame: unknown) => void> = [];
  private readonly socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on("message", (data) => {
      const frame: unknown = JSON.parse(String(data));
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(frame);
      } else {
        this.queue.push(frame);
      }
    });
    this.closed = new Promise((resolve) => {
      socket.on("close", () => resolve());
    });
  }

  static connect(url: string): Promise<WsClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.once("open", () => resolve(new WsClient(socket)));
      socket.once("error", reject);
    });
  }

  next(timeoutMs = 2000): Promise<unknown> {
    const queued = this.queue.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timed out waiting for frame")),
        timeoutMs
      );
      this.waiters.push((frame) => {
        clearTimeout(timer);
        resolve(frame);
      });
    });
  }

  send(frame: unknown): void {
    this.socket.send(JSON.stringify(frame));
  }

  sendRaw(raw: string): void {
    this.socket.send(raw);
  }

  close(): void {
    this.socket.close();
  }
}

/** 完成 uplink 挑战握手，返回已就绪的宿主连接。 */
export async function connectUplink(args: {
  wsUrl: string;
  identity: TestHostIdentity;
  roster: Array<{ deviceId: string; relayPassHash: string }>;
}): Promise<WsClient> {
  const uplink = await WsClient.connect(`${args.wsUrl}/uplink`);
  const challenge = (await uplink.next()) as { type: string; nonce: string };
  if (challenge.type !== "server.challenge") {
    throw new Error(`expected server.challenge, got ${challenge.type}`);
  }
  uplink.send({
    type: "uplink.hello",
    protocolVersion: 1,
    hostId: args.identity.hostId,
    hostPubKey: args.identity.hostPubKey,
    signature: args.identity.signNonce(challenge.nonce),
    roster: args.roster,
  });
  const ready = (await uplink.next()) as { type: string };
  if (ready.type !== "uplink.ready") {
    throw new Error(`expected uplink.ready, got ${JSON.stringify(ready)}`);
  }
  return uplink;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export const SEALED_FIXTURE = {
  kind: "sealed",
  v: 1,
  seq: 1,
  iv: "aXY",
  ct: "b3BhcXVl",
} as const;
