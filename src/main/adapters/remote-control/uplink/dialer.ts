/**
 * 宿主出站拨号（服务端设计 §5.1/§7）：常驻连接会合云 /uplink。
 *
 * - 准入：server.challenge → Ed25519 签名 hello + 名册担保；
 * - 名册增量：pairing.onEnroll → upsert（LAN 与 relay 赎回同源），
 *   pairing.onRevoke → remove + 销毁本地通道；
 * - 帧路由：envelope 按 deviceId 分发到虚拟通道（channel.init 触发建道，
 *   同设备重握手 = 后来者胜）；pair.request → 密封赎回盲传；
 * - 重连：指数退避 1s→60s；「远程访问」关闭即 stop。
 * - 启停状态机内聚于此（评审 R1：不复制 LAN registration 抽象——出站
 *   拨号的重连循环本身就是状态机）。
 * - 宿主只出站：本文件永不监听端口（治理锁，服务端设计 §13）。
 */

import { randomBytes } from "node:crypto";
import type { PairingService } from "@main/services/pairing/service.ts";
import type {
  RelayEnvelopeFrame,
  RelaySealedFrame,
} from "@shared/contracts/relay/index.ts";
import {
  RELAY_PROTOCOL_VERSION,
  uplinkServerFrameSchema,
} from "@shared/contracts/relay/index.ts";
import { sealFrame } from "@shared/crypto/e2e-seal.ts";
import { WebSocket as WsWebSocket } from "ws";
import type { WebSocketLike } from "../session-bridge.ts";
import {
  createUplinkDeviceChannel,
  type UplinkDeviceChannel,
} from "./device-channel.ts";

export type UplinkState = "stopped" | "connecting" | "connected" | "backoff";

export interface UplinkDialer {
  start(): void;
  state(): UplinkState;
  stop(): void;
}

const BACKOFF_INITIAL_MS = 1000;
const BACKOFF_MAX_MS = 60_000;

type UplinkSocket = Pick<
  WsWebSocket,
  "close" | "on" | "readyState" | "send" | "OPEN"
>;

export function createUplinkDialer(args: {
  /** 会合 wss/ws 基址（不含路径）；由 resolveRelayUrl 提供。 */
  relayUrl: string;
  pairing: PairingService;
  /** 桥接入：dialer 建道后交 attachMobileSession（boot 装配）。 */
  attachSession(socket: WebSocketLike, deviceId: string): void;
  createWebSocket?: (url: string) => UplinkSocket;
  log?: (event: string, fields?: Record<string, string | number>) => void;
}): UplinkDialer {
  const log = args.log ?? (() => undefined);
  const createWebSocket =
    args.createWebSocket ?? ((url: string) => new WsWebSocket(url));

  const channels = new Map<string, UplinkDeviceChannel>();
  /** 按 deviceId 串行化建道/路由（channel.init 的异步取键期不丢后续帧）。 */
  const routeChains = new Map<string, Promise<void>>();

  let state: UplinkState = "stopped";
  let stopped = true;
  let socket: UplinkSocket | null = null;
  let attempt = 0;
  let retryTimer: NodeJS.Timeout | null = null;
  let unsubscribeEnroll: (() => void) | null = null;
  let unsubscribeRevoke: (() => void) | null = null;

  function sendJson(frame: unknown): void {
    const ws = socket;
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(frame));
    }
  }

  function sendEnvelope(deviceId: string, frame: RelayEnvelopeFrame): void {
    sendJson({ type: "envelope", deviceId, frame });
  }

  function destroyChannels(): void {
    for (const channel of channels.values()) {
      channel.destroy();
    }
    channels.clear();
    routeChains.clear();
  }

  async function routeFrame(
    deviceId: string,
    frame: RelayEnvelopeFrame
  ): Promise<void> {
    const isInit =
      frame.kind === "plain" && frame.handshake.type === "channel.init";
    if (isInit) {
      // 同设备重握手 = 后来者胜：销毁旧通道（旧桥会话随 close 清理）。
      channels.get(deviceId)?.destroy();
      channels.delete(deviceId);
      const e2eKey = await args.pairing.deviceE2eKey(deviceId);
      if (e2eKey === null) {
        // 名册与密钥失同步（吊销竞态）：防御性补发 remove。
        sendJson({ type: "roster.update", remove: [deviceId] });
        return;
      }
      const channel = createUplinkDeviceChannel({
        e2eKey,
        sendFrame: (out) => sendEnvelope(deviceId, out),
        onClosed: () => {
          if (channels.get(deviceId) === channel) {
            channels.delete(deviceId);
          }
        },
      });
      channels.set(deviceId, channel);
      args.attachSession(channel.socket, deviceId);
      channel.handleFrame(frame);
      return;
    }
    channels.get(deviceId)?.handleFrame(frame);
  }

  function enqueueRoute(deviceId: string, frame: RelayEnvelopeFrame): void {
    const chain = routeChains.get(deviceId) ?? Promise.resolve();
    const next = chain
      .then(() => routeFrame(deviceId, frame))
      .catch(() => undefined);
    routeChains.set(deviceId, next);
  }

  async function failPairBlind(requestId: string): Promise<void> {
    const sealedResult = await sealFrame(
      new Uint8Array(randomBytes(32)),
      0,
      JSON.stringify({ reason: "pairing_invalid" })
    );
    sendJson({
      type: "pair.result",
      requestId,
      ok: false,
      sealedResult,
    });
  }

  async function handlePairRequest(
    requestId: string,
    sealedRequest: RelaySealedFrame
  ): Promise<void> {
    // 名册 upsert 由 onEnroll 监听先行送出（redeem 内同步触发），
    // 此处只回结果——顺序保证手机拿到令牌时名册已就位。
    const outcome = await args.pairing.redeemSealedForRelay(sealedRequest);
    sendJson({
      type: "pair.result",
      requestId,
      ok: outcome.ok,
      sealedResult: outcome.sealedResult,
    });
    log("uplink.pair", { ok: outcome.ok ? 1 : 0 });
  }

  function scheduleReconnect(): void {
    if (stopped) {
      return;
    }
    state = "backoff";
    const delay = Math.min(BACKOFF_INITIAL_MS * 2 ** attempt, BACKOFF_MAX_MS);
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect().catch(() => undefined);
    }, delay);
    retryTimer.unref?.();
  }

  async function connect(): Promise<void> {
    if (stopped) {
      return;
    }
    state = "connecting";
    await args.pairing.ensureReady();
    const identity = args.pairing.getIdentity();
    if (identity === null) {
      // 无 secrets 注入（纯 LAN 形态）：uplink 无法自证明，停机。
      log("uplink.no-identity");
      state = "stopped";
      stopped = true;
      return;
    }
    if (stopped) {
      return;
    }
    const ws = createWebSocket(`${args.relayUrl}/uplink`);
    socket = ws;
    ws.on("message", (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(data));
      } catch {
        return;
      }
      const frame = uplinkServerFrameSchema.safeParse(parsed);
      if (!frame.success) {
        return;
      }
      if (frame.data.type === "server.challenge") {
        sendJson({
          type: "uplink.hello",
          protocolVersion: RELAY_PROTOCOL_VERSION,
          hostId: identity.hostId,
          hostPubKey: identity.publicKeyRaw,
          signature: identity.sign(frame.data.nonce),
          roster: args.pairing.listRoster(),
        });
        return;
      }
      if (frame.data.type === "uplink.ready") {
        state = "connected";
        attempt = 0;
        log("uplink.connected");
        return;
      }
      if (frame.data.type === "envelope") {
        enqueueRoute(frame.data.deviceId, frame.data.frame);
        return;
      }
      if (frame.data.type === "pair.request") {
        handlePairRequest(frame.data.requestId, frame.data.sealedRequest).catch(
          (error: unknown) => {
            log("uplink.pair-failed", {
              message: error instanceof Error ? error.message : "unknown",
            });
            failPairBlind(frame.data.requestId).catch(() => undefined);
          }
        );
        return;
      }
      if (frame.data.type === "downlink.gone") {
        channels.get(frame.data.deviceId)?.destroy();
        channels.delete(frame.data.deviceId);
        return;
      }
      // server.error：记录后交由 close 事件走重连。
      log("uplink.server-error", { code: frame.data.code });
    });
    ws.on("close", () => {
      if (socket === ws) {
        socket = null;
        destroyChannels();
        scheduleReconnect();
      }
    });
    ws.on("error", () => {
      ws.close();
    });
  }

  return {
    start() {
      if (!stopped) {
        return;
      }
      stopped = false;
      attempt = 0;
      unsubscribeEnroll = args.pairing.onEnroll((entry) => {
        sendJson({ type: "roster.update", upsert: [entry] });
      });
      unsubscribeRevoke = args.pairing.onRevoke((deviceId) => {
        channels.get(deviceId)?.destroy();
        channels.delete(deviceId);
        sendJson({ type: "roster.update", remove: [deviceId] });
      });
      connect().catch(() => undefined);
    },
    stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      unsubscribeEnroll?.();
      unsubscribeEnroll = null;
      unsubscribeRevoke?.();
      unsubscribeRevoke = null;
      const ws = socket;
      socket = null;
      ws?.close();
      destroyChannels();
      state = "stopped";
    },
    state() {
      return state;
    },
  };
}
