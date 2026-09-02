/**
 * 每设备虚拟通道（服务端设计 §6）：把 relay 转发来的载体帧解封成
 * session-bridge 可消费的「WebSocketLike + 文本行」，出向帧密封后交 dialer。
 *
 * - 通道握手：收 channel.init（明文，nonce 与临时公钥非秘密）→ 生成宿主侧
 *   P-256 临时密钥 → channelKey = HKDF(e2eKey ‖ ECDH)（PSK+ECDHE，前向保密）
 *   → 回 channel.ack；此后帧一律 AES-256-GCM 密封、seq 入 AAD 防重放。
 * - 入向/出向各自 Promise 链序列化，保证帧序与 seq 单调。
 * - 解封失败 / 重放 / 未握手先发密文 → 销毁通道（bridge 收 close 即清会话）。
 */
import type { RelayEnvelopeFrame } from "@shared/contracts/relay/index.ts";
import {
  deriveChannelKey,
  fromBase64Url,
  generateEphemeral,
  sealFrame,
  toBase64Url,
  unsealFrame,
} from "@shared/crypto/e2e-seal.ts";
import type { WebSocketLike, WebSocketMessageData } from "../session-bridge.ts";

export interface UplinkDeviceChannel {
  /** 管道终结（吊销 / uplink 断开 / 握手失败）：向桥发 close。 */
  destroy(): void;
  /** relay 转发来的载体帧入口（dialer 按 deviceId 路由）。 */
  handleFrame(frame: RelayEnvelopeFrame): void;
  /** 已完成通道握手（测试与 dialer 防御分支消费）。 */
  isReady(): boolean;
  /** 交给 attachMobileSession 的桥接口。 */
  socket: WebSocketLike;
}

export function createUplinkDeviceChannel(args: {
  e2eKey: Uint8Array;
  /** 出向载体帧（dialer 包 envelope + deviceId 后送 relay）。 */
  sendFrame(frame: RelayEnvelopeFrame): void;
  /** 桥主动 close 或通道销毁后的清册回调（dialer 移除映射）。 */
  onClosed(): void;
}): UplinkDeviceChannel {
  const messageListeners: Array<(data: WebSocketMessageData) => void> = [];
  const closeListeners: Array<() => void> = [];
  let channelKey: Uint8Array | null = null;
  let lastSeqIn = -1;
  let seqOut = 0;
  let destroyed = false;
  let inbound: Promise<void> = Promise.resolve();
  let outbound: Promise<void> = Promise.resolve();

  function destroy(): void {
    if (destroyed) {
      return;
    }
    destroyed = true;
    channelKey = null;
    for (const listener of closeListeners) {
      listener();
    }
    args.onClosed();
  }

  async function handleInit(frame: {
    clientNonce: string;
    clientEphPub: string;
  }): Promise<void> {
    const ephemeral = await generateEphemeral();
    const ecdhSecret = await ephemeral.exchange(
      fromBase64Url(frame.clientEphPub)
    );
    const hostNonce = crypto.getRandomValues(new Uint8Array(16));
    channelKey = await deriveChannelKey(
      args.e2eKey,
      ecdhSecret,
      fromBase64Url(frame.clientNonce),
      hostNonce
    );
    args.sendFrame({
      kind: "plain",
      handshake: {
        type: "channel.ack",
        hostNonce: toBase64Url(hostNonce),
        hostEphPub: toBase64Url(ephemeral.publicKey),
      },
    });
  }

  async function handleSealed(frame: RelayEnvelopeFrame): Promise<void> {
    if (frame.kind !== "sealed" || destroyed) {
      return;
    }
    const key = channelKey;
    if (key === null) {
      // 未握手先发密文：协议误用，终结通道。
      destroy();
      return;
    }
    let line: string;
    try {
      line = await unsealFrame(key, frame, lastSeqIn);
    } catch {
      // GCM 认证失败或重放：终结通道（手机侧按传输错误重建管道）。
      destroy();
      return;
    }
    lastSeqIn = frame.seq;
    for (const listener of messageListeners) {
      listener(line);
    }
  }

  return {
    socket: {
      close() {
        destroy();
      },
      on(event: "message" | "close", listener: unknown): void {
        if (event === "message") {
          messageListeners.push(
            listener as (data: WebSocketMessageData) => void
          );
        } else {
          closeListeners.push(listener as () => void);
        }
      },
      send(data: string) {
        if (destroyed) {
          return;
        }
        seqOut += 1;
        const seq = seqOut;
        outbound = outbound.then(async () => {
          const key = channelKey;
          if (destroyed || key === null) {
            return;
          }
          args.sendFrame(await sealFrame(key, seq, data));
        });
        outbound = outbound.catch(() => destroy());
      },
    },
    handleFrame(frame) {
      inbound = inbound
        .then(() => {
          if (destroyed) {
            return;
          }
          if (frame.kind === "plain") {
            if (frame.handshake.type === "channel.init") {
              return handleInit(frame.handshake);
            }
            // 宿主侧不消费 channel.ack（那是发给手机的），忽略。
            return;
          }
          return handleSealed(frame);
        })
        .catch(() => destroy());
    },
    destroy,
    isReady() {
      return channelKey !== null && !destroyed;
    },
  };
}
