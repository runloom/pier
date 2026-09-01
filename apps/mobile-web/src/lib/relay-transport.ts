/**
 * 会合传输层（M2 Task 9）：把「relay downlink 管道 + channel 握手 + E2E 密封」
 * 包装成一个虚拟 PierWebSocketLike，直接喂给现有 PierMobileClient——
 * 会话逻辑（hello / command / watch / 重连）零改动复用，完全对称于宿主侧
 * device-channel 喂给 attachMobileSession（服务端设计 §5.2/§5.4/§6）。
 *
 * 虚拟 socket 的 open 在「downlink.ready + channel.ack + channelKey 就绪」后触发；
 * 上层 send(line) → 密封为 sealed frame 出站；收到 sealed frame → 解封 →
 * 转 message 事件；host_offline / auth_failed / 解封失败 → close。
 */
import {
  channelHandshakeFrameSchema,
  downlinkServerFrameSchema,
  type RelayEnvelopeFrame,
  relayEnvelopeFrameSchema,
} from "@shared/contracts/relay/index.ts";
import {
  deriveChannelKey,
  deriveE2eKey,
  deriveRelayPass,
  fromBase64Url,
  generateEphemeral,
  sealFrame,
  toBase64Url,
  unsealFrame,
} from "@shared/crypto/e2e-seal.ts";
import type {
  PierWebSocketEventType,
  PierWebSocketFactory,
  PierWebSocketLike,
} from "./client-types.ts";

export interface RelayTransportArgs {
  deviceId: string;
  deviceToken: string;
  fingerprint: string;
  hostId: string;
  relayUrl: string;
}

/** 底层真实 WebSocket 的最小接口（原生 WebSocket 满足；测试注入 mock）。 */
export interface RawSocket {
  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event?: { data?: unknown }) => void
  ): void;
  close(): void;
  send(data: string): void;
}

export type RawSocketFactory = (url: string) => RawSocket;

type Listener = (event?: { data?: unknown }) => void;

/**
 * 构造喂给 PierMobileClient 的 createWebSocket 工厂：忽略其传入的 ws:// URL，
 * 改连 relay downlink 并在其上铺设密封通道。
 */
export function createRelayWebSocketFactory(
  args: RelayTransportArgs,
  rawFactory: RawSocketFactory = (url) =>
    new WebSocket(url) as unknown as RawSocket
): PierWebSocketFactory {
  return () => new RelayWebSocket(args, rawFactory);
}

class RelayWebSocket implements PierWebSocketLike {
  private readonly args: RelayTransportArgs;
  private readonly raw: RawSocket;
  private readonly listeners = new Map<PierWebSocketEventType, Set<Listener>>();
  private channelKey: Uint8Array | null = null;
  private e2eKey: Uint8Array | null = null;
  private seqOut = 0;
  private lastSeqIn = -1;
  private closed = false;
  private inbound: Promise<void> = Promise.resolve();
  private outbound: Promise<void> = Promise.resolve();

  constructor(args: RelayTransportArgs, rawFactory: RawSocketFactory) {
    this.args = args;
    this.raw = rawFactory(`${args.relayUrl}/downlink`);
    this.raw.addEventListener("open", () => this.onRawOpen());
    this.raw.addEventListener("message", (event) =>
      this.onRawMessage(event?.data)
    );
    this.raw.addEventListener("close", () => this.emitClose());
    this.raw.addEventListener("error", () => this.raw.close());
  }

  addEventListener(type: PierWebSocketEventType, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: PierWebSocketEventType, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    if (this.closed) {
      return;
    }
    this.seqOut += 1;
    const seq = this.seqOut;
    this.outbound = this.outbound
      .then(async () => {
        const key = this.channelKey;
        if (this.closed || key === null) {
          return;
        }
        this.raw.send(JSON.stringify(await sealFrame(key, seq, data)));
      })
      .catch(() => this.close());
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.channelKey = null;
    this.raw.close();
    this.emit("close");
  }

  private emit(type: PierWebSocketEventType, event?: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  private emitClose(): void {
    if (!this.closed) {
      this.closed = true;
      this.channelKey = null;
      this.emit("close");
    }
  }

  private async onRawOpen(): Promise<void> {
    // 先派生长期 e2eKey，再发 downlink.hello（relayPass 在 relay-api 侧另派生）。
    this.e2eKey = await deriveE2eKey({
      deviceToken: this.args.deviceToken,
      fingerprint: this.args.fingerprint,
    });
    const relayPass = await deriveRelayPass({
      deviceToken: this.args.deviceToken,
      fingerprint: this.args.fingerprint,
    });
    this.raw.send(
      JSON.stringify({
        deviceId: this.args.deviceId,
        hostId: this.args.hostId,
        protocolVersion: 1,
        relayPass,
        type: "downlink.hello",
      })
    );
  }

  private onRawMessage(data: unknown): void {
    let raw: unknown;
    try {
      raw = JSON.parse(typeof data === "string" ? data : String(data));
    } catch {
      return;
    }
    // 通道就绪前：处理 downlink.ready / server.error / channel.ack。
    if (this.channelKey === null) {
      this.inbound = this.inbound
        .then(() => this.handleHandshake(raw))
        .catch(() => this.close());
      return;
    }
    const carried = relayEnvelopeFrameSchema.safeParse(raw);
    if (!carried.success) {
      return;
    }
    this.inbound = this.inbound
      .then(() => this.handleSealed(carried.data))
      .catch(() => this.close());
  }

  private async handleHandshake(raw: unknown): Promise<void> {
    const server = downlinkServerFrameSchema.safeParse(raw);
    if (server.success && "type" in server.data) {
      if (server.data.type === "downlink.ready") {
        await this.sendChannelInit();
        return;
      }
      if (server.data.type === "server.error") {
        // host_offline / auth_failed / rate_limited：终结（上层按传输错误处理）。
        this.close();
        return;
      }
    }
    // channel.ack：完成 PSK+ECDHE 派生并放行 open。
    const handshake = channelHandshakeFrameSchema.safeParse(
      (raw as { handshake?: unknown }).handshake ?? raw
    );
    if (handshake.success && handshake.data.type === "channel.ack") {
      await this.completeChannel(
        handshake.data.hostNonce,
        handshake.data.hostEphPub
      );
    }
  }

  private async sendChannelInit(): Promise<void> {
    this.ephemeral = await generateEphemeral();
    this.clientNonce = crypto.getRandomValues(new Uint8Array(16));
    const initFrame: RelayEnvelopeFrame = {
      handshake: {
        clientEphPub: toBase64Url(this.ephemeral.publicKey),
        clientNonce: toBase64Url(this.clientNonce),
        type: "channel.init",
      },
      kind: "plain",
    };
    this.raw.send(JSON.stringify(initFrame));
  }

  private ephemeral: Awaited<ReturnType<typeof generateEphemeral>> | null =
    null;
  private clientNonce: Uint8Array | null = null;

  private async completeChannel(
    hostNonce: string,
    hostEphPub: string
  ): Promise<void> {
    if (
      this.e2eKey === null ||
      this.ephemeral === null ||
      this.clientNonce === null
    ) {
      this.close();
      return;
    }
    const ecdhSecret = await this.ephemeral.exchange(fromBase64Url(hostEphPub));
    this.channelKey = await deriveChannelKey(
      this.e2eKey,
      ecdhSecret,
      this.clientNonce,
      fromBase64Url(hostNonce)
    );
    // 通道就绪：放行 open，PierMobileClient 随即发 client.hello。
    this.emit("open");
  }

  private async handleSealed(frame: RelayEnvelopeFrame): Promise<void> {
    if (frame.kind !== "sealed") {
      return;
    }
    const key = this.channelKey;
    if (key === null) {
      return;
    }
    let line: string;
    try {
      line = await unsealFrame(key, frame, this.lastSeqIn);
    } catch {
      this.close();
      return;
    }
    this.lastSeqIn = frame.seq;
    this.emit("message", { data: line });
  }
}
