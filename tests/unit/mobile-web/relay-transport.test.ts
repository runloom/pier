// @vitest-environment node
/**
 * Web 壳会合传输层（M2 Task 9）：downlink 握手 + channel 握手（PSK+ECDHE）
 * + E2E 密封往返。假 relay 端用 e2e-seal 原语扮演宿主 device-channel 的另一
 * 端，验证「密文进出 + 明文只在两端」。
 */

import type { RelayEnvelopeFrame } from "@shared/contracts/relay/index.ts";
import {
  deriveChannelKey,
  deriveE2eKey,
  fromBase64Url,
  generateEphemeral,
  sealFrame,
  toBase64Url,
  unsealFrame,
} from "@shared/crypto/e2e-seal.ts";
import { describe, expect, it, vi } from "vitest";
import {
  createRelayWebSocketFactory,
  type RawSocket,
} from "../../../apps/mobile-web/src/lib/relay-transport.ts";

const ARGS = {
  deviceId: "dev-1",
  deviceToken: "device-token-abcdefghijklmnopqrstuvwxyz012345",
  fingerprint: "abcdef0123456789",
  hostId: "h".repeat(64),
  relayUrl: "wss://relay.example.com",
};

/**
 * 假 relay + 假宿主：模拟 downlink 端点，收 hello 回 ready、收 channel.init
 * 用宿主侧 ephemeral 回 channel.ack 并派生同一 channelKey，其后密文回环。
 */
class FakeRelaySocket implements RawSocket {
  private readonly handlers = new Map<
    string,
    Set<(event?: { data?: unknown }) => void>
  >();
  hostChannelKey: Uint8Array | null = null;
  private hostSeqOut = 0;
  private hostLastSeqIn = -1;
  readonly received: string[] = [];

  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event?: { data?: unknown }) => void
  ): void {
    const set = this.handlers.get(type) ?? new Set();
    set.add(listener);
    this.handlers.set(type, set);
  }

  private fire(type: string, event?: { data?: unknown }): void {
    for (const handler of this.handlers.get(type) ?? []) {
      handler(event);
    }
  }

  /** 触发 open（测试驱动：raw socket 连上）。 */
  open(): void {
    this.fire("open");
  }

  send(data: string): void {
    const frame = JSON.parse(data) as Record<string, unknown>;
    if (frame.type === "downlink.hello") {
      this.fire("message", {
        data: JSON.stringify({ type: "downlink.ready" }),
      });
      return;
    }
    if (frame.kind === "plain") {
      this.handleChannelInit(frame as unknown as RelayEnvelopeFrame).catch(
        () => undefined
      );
      return;
    }
    if (frame.kind === "sealed") {
      this.decryptClientFrame(frame as unknown as RelayEnvelopeFrame).catch(
        () => undefined
      );
    }
  }

  close(): void {
    this.fire("close");
  }

  private async handleChannelInit(frame: RelayEnvelopeFrame): Promise<void> {
    if (frame.kind !== "plain" || frame.handshake.type !== "channel.init") {
      return;
    }
    const e2eKey = await deriveE2eKey({
      deviceToken: ARGS.deviceToken,
      fingerprint: ARGS.fingerprint,
    });
    const ephemeral = await generateEphemeral();
    const hostNonce = crypto.getRandomValues(new Uint8Array(16));
    this.hostChannelKey = await deriveChannelKey(
      e2eKey,
      await ephemeral.exchange(fromBase64Url(frame.handshake.clientEphPub)),
      fromBase64Url(frame.handshake.clientNonce),
      hostNonce
    );
    this.fire("message", {
      data: JSON.stringify({
        handshake: {
          hostEphPub: toBase64Url(ephemeral.publicKey),
          hostNonce: toBase64Url(hostNonce),
          type: "channel.ack",
        },
        kind: "plain",
      }),
    });
  }

  private async decryptClientFrame(frame: RelayEnvelopeFrame): Promise<void> {
    if (frame.kind !== "sealed" || this.hostChannelKey === null) {
      return;
    }
    const line = await unsealFrame(
      this.hostChannelKey,
      frame,
      this.hostLastSeqIn
    );
    this.hostLastSeqIn = frame.seq;
    this.received.push(line);
  }

  /** 宿主侧密封一帧回给客户端。 */
  async pushToClient(line: string): Promise<void> {
    if (this.hostChannelKey === null) {
      throw new Error("channel not established");
    }
    this.hostSeqOut += 1;
    const sealed = await sealFrame(this.hostChannelKey, this.hostSeqOut, line);
    this.fire("message", { data: JSON.stringify(sealed) });
  }
}

function connectVirtual(): {
  socket: ReturnType<ReturnType<typeof createRelayWebSocketFactory>>;
  relay: FakeRelaySocket;
} {
  const relay = new FakeRelaySocket();
  const factory = createRelayWebSocketFactory(ARGS, () => relay);
  const socket = factory("ws://ignored/ws");
  return { relay, socket };
}

describe("createRelayWebSocketFactory", () => {
  it("握手后 open：downlink.hello → ready → channel.init/ack → channelKey 双端一致", async () => {
    const { relay, socket } = connectVirtual();
    const opened = vi.fn();
    socket.addEventListener("open", opened);

    relay.open();
    await vi.waitFor(() => {
      expect(opened).toHaveBeenCalledTimes(1);
    });
    expect(relay.hostChannelKey).not.toBeNull();
  });

  it("open 后 send 明文 → relay 收到密文并能解封为原文", async () => {
    const { relay, socket } = connectVirtual();
    await new Promise<void>((resolve) => {
      socket.addEventListener("open", () => resolve());
      relay.open();
    });
    socket.send('{"type":"client.hello"}');
    await vi.waitFor(() => {
      expect(relay.received).toEqual(['{"type":"client.hello"}']);
    });
  });

  it("relay 回密文 → 客户端解封为 message 明文（防重放 seq 单调）", async () => {
    const { relay, socket } = connectVirtual();
    const messages: string[] = [];
    socket.addEventListener("message", (event) => {
      messages.push(String(event?.data));
    });
    await new Promise<void>((resolve) => {
      socket.addEventListener("open", () => resolve());
      relay.open();
    });
    await relay.pushToClient('{"type":"server.hello"}');
    await relay.pushToClient('{"type":"response","ok":true}');
    await vi.waitFor(() => {
      expect(messages).toEqual([
        '{"type":"server.hello"}',
        '{"type":"response","ok":true}',
      ]);
    });
  });

  it("host_offline server.error → 关闭虚拟 socket（上层按传输错误处理）", async () => {
    const relay = new FakeRelaySocket();
    const factory = createRelayWebSocketFactory(ARGS, () => relay);
    const socket = factory("ws://ignored/ws");
    const closed = vi.fn();
    socket.addEventListener("close", closed);
    // downlink.hello 之后 relay 直接答 host_offline。
    relay.addEventListener("open", () => undefined);
    relay.open();
    // 手动注入 server.error（绕过 ready 分支）。
    (relay as unknown as { fire: (t: string, e?: unknown) => void }).fire?.(
      "message",
      { data: JSON.stringify({ code: "host_offline", type: "server.error" }) }
    );
    await vi.waitFor(() => {
      expect(closed).toHaveBeenCalled();
    });
  });
});
