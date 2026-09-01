// @vitest-environment node
/**
 * uplink 全链路集成（M2 Task 5 + Task 12 冒烟）：真 relay（进程内）+
 * 真 dialer + 真 session-bridge + 模拟手机端（密封赎回 → 通道握手 →
 * client.hello → command 往返 → 吊销断连）。
 * 契约：服务端设计 §5.3/§5.4/§6/§7。
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachMobileSession,
  createMobileSessionTracker,
} from "@main/adapters/remote-control/session-bridge.ts";
import {
  createUplinkDialer,
  type UplinkDialer,
} from "@main/adapters/remote-control/uplink/dialer.ts";
import { createClientRegistry } from "@main/app-core/client-registry.ts";
import {
  createPairingService,
  type PairingService,
} from "@main/services/pairing/service.ts";
import { createPairingStore } from "@main/state/pairing-store.ts";
import type { PierCommandEnvelope } from "@shared/contracts/commands.ts";
import { LOCAL_CONTROL_API_VERSION } from "@shared/contracts/local-control/errors.ts";
import type { RelaySealedFrame } from "@shared/contracts/relay/index.ts";
import {
  deriveChannelKey,
  deriveE2eKey,
  derivePairKey,
  deriveRelayPass,
  fromBase64Url,
  generateEphemeral,
  sealFrame,
  toBase64Url,
  unsealFrame,
} from "@shared/crypto/e2e-seal.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type RunningRelay,
  startRelay,
  WsClient,
} from "../../../relay/helpers.ts";
import { makeFakeSecrets } from "../../pairing/fake-secrets.ts";

const tempDirs: string[] = [];
let relay: RunningRelay | null = null;
let dialer: UplinkDialer | null = null;

afterEach(async () => {
  dialer?.stop();
  dialer = null;
  await relay?.stop();
  relay = null;
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

async function makeHostSide(): Promise<{
  pairing: PairingService;
  executed: string[];
  clients: ReturnType<typeof createClientRegistry>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "pier-uplink-"));
  tempDirs.push(dir);
  const store = createPairingStore(join(dir, "pairing.json"));
  await store.init();
  const pairing = createPairingService({
    secrets: makeFakeSecrets(),
    store,
  });
  await pairing.ensureReady();
  const executed: string[] = [];
  const clients = createClientRegistry();
  const sessionTracker = createMobileSessionTracker();
  const executeCommand = (envelope: PierCommandEnvelope): Promise<unknown> => {
    executed.push(envelope.command.type);
    return Promise.resolve({ ok: true, data: { echo: envelope.command.type } });
  };
  dialer = createUplinkDialer({
    attachSession: (socket, deviceId) => {
      attachMobileSession(socket, {
        clients,
        executeCommand,
        pairing,
        recordFailure: () => undefined,
        recordSuccess: () => undefined,
        remoteAddress: `relay:${deviceId}`,
        sessionDeps: { bootId: "uplink-test" },
        sessionTracker,
      });
    },
    pairing,
    relayUrl: relay?.wsUrl ?? "",
  });
  return { clients, executed, pairing };
}

describe("uplink 全链路（赎回 → 通道 → 命令 → 吊销）", () => {
  it("六步冒烟走通，relay 全程只见密文", async () => {
    relay = await startRelay();
    const { executed, pairing } = await makeHostSide();
    const activeDialer = dialer;
    if (!activeDialer) {
      throw new Error("dialer not created");
    }

    // 1) 宿主出站自证明上线。
    activeDialer.start();
    await vi.waitFor(() => {
      expect(activeDialer.state()).toBe("connected");
    });
    const identity = pairing.getIdentity();
    if (!identity) {
      throw new Error("host identity missing");
    }
    expect(relay.server.registry.isOnline(identity.hostId)).toBe(true);

    // 2) 手机密封赎回（relay 盲传）。
    const begin = pairing.beginPairing({ host: "127.0.0.1", port: 1 });
    const qr = JSON.parse(begin.qrPayload) as {
      fingerprint: string;
      hostId: string;
      pairSecret: string;
      relayHint: string | null;
    };
    expect(qr.hostId).toBe(identity.hostId);
    expect(qr.pairSecret.length).toBeGreaterThanOrEqual(43);
    const pairKey = await derivePairKey({
      fingerprint: qr.fingerprint,
      pairSecret: qr.pairSecret,
    });
    const sealedRequest = await sealFrame(
      pairKey,
      0,
      JSON.stringify({
        code: begin.code,
        name: "集成测试手机",
        requestedCapabilities: [
          "app:read",
          "git:read",
          "notification:write",
          "terminal:read",
        ],
        shell: "web",
      })
    );
    const redeemResponse = await fetch(`${relay.httpUrl}/pair/relay`, {
      body: JSON.stringify({ hostId: qr.hostId, sealed: sealedRequest }),
      method: "POST",
    });
    expect(redeemResponse.status).toBe(200);
    const { sealed } = (await redeemResponse.json()) as {
      sealed: RelaySealedFrame;
    };
    const redeem = JSON.parse(await unsealFrame(pairKey, sealed, -1)) as {
      deviceId: string;
      deviceToken: string;
      tokenEpoch: number;
    };
    expect(redeem.tokenEpoch).toBe(0);

    // 3) 手机派生密钥并建 downlink 管道（名册已由 onEnroll 担保）。
    const relayPass = await deriveRelayPass({
      deviceToken: redeem.deviceToken,
      fingerprint: qr.fingerprint,
    });
    const e2eKey = await deriveE2eKey({
      deviceToken: redeem.deviceToken,
      fingerprint: qr.fingerprint,
    });
    const downlink = await WsClient.connect(`${relay.wsUrl}/downlink`);
    downlink.send({
      deviceId: redeem.deviceId,
      hostId: qr.hostId,
      protocolVersion: 1,
      relayPass,
      type: "downlink.hello",
    });
    expect(await downlink.next()).toEqual({ type: "downlink.ready" });

    // 4) 通道握手（PSK+ECDHE）。
    const ephemeral = await generateEphemeral();
    const clientNonce = crypto.getRandomValues(new Uint8Array(16));
    downlink.send({
      handshake: {
        clientEphPub: toBase64Url(ephemeral.publicKey),
        clientNonce: toBase64Url(clientNonce),
        type: "channel.init",
      },
      kind: "plain",
    });
    const ack = (await downlink.next()) as {
      kind: string;
      handshake: { hostEphPub: string; hostNonce: string; type: string };
    };
    expect(ack.handshake.type).toBe("channel.ack");
    const channelKey = await deriveChannelKey(
      e2eKey,
      await ephemeral.exchange(fromBase64Url(ack.handshake.hostEphPub)),
      clientNonce,
      fromBase64Url(ack.handshake.hostNonce)
    );

    let seqOut = 0;
    let lastSeqIn = -1;
    const sendSealed = async (frame: unknown): Promise<void> => {
      seqOut += 1;
      downlink.send(await sealFrame(channelKey, seqOut, JSON.stringify(frame)));
    };
    const receiveSealed = async (): Promise<Record<string, unknown>> => {
      const frame = (await downlink.next()) as RelaySealedFrame;
      expect(frame.kind).toBe("sealed");
      const line = await unsealFrame(channelKey, frame, lastSeqIn);
      lastSeqIn = frame.seq;
      return JSON.parse(line) as Record<string, unknown>;
    };

    // 5) M1 语义会话：client.hello → server.hello → command 往返。
    await sendSealed({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      auth: {
        deviceId: redeem.deviceId,
        deviceToken: redeem.deviceToken,
        method: "device-token",
        shell: "web",
      },
      clientKind: "mobile-paired",
      requestId: "h1",
      type: "client.hello",
    });
    const serverHello = await receiveSealed();
    expect(serverHello.type).toBe("server.hello");

    await sendSealed({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      command: { type: "app.snapshot" },
      requestId: "c1",
      type: "command",
    });
    const commandResponse = await receiveSealed();
    expect(commandResponse).toMatchObject({
      ok: true,
      requestId: "c1",
      data: { echo: "app.snapshot" },
    });
    expect(executed).toEqual(["app.snapshot"]);

    // 6) 吊销：会话踢断 + relay 名册同步移除。
    pairing.revokeDevice(redeem.deviceId);
    await downlink.closed;
    await vi.waitFor(() => {
      expect(relay?.server.registry.hasDevice(qr.hostId, redeem.deviceId)).toBe(
        false
      );
    });
  }, 15_000);

  it("downlink 关闭后宿主会话注销（remotePush 可见离线）", async () => {
    relay = await startRelay();
    const { clients, pairing } = await makeHostSide();
    const activeDialer = dialer;
    if (!activeDialer) {
      throw new Error("dialer not created");
    }
    activeDialer.start();
    await vi.waitFor(() => {
      expect(activeDialer.state()).toBe("connected");
    });
    const identity = pairing.getIdentity();
    if (!identity) {
      throw new Error("host identity missing");
    }
    const begin = pairing.beginPairing({ host: "127.0.0.1", port: 1 });
    const qr = JSON.parse(begin.qrPayload) as {
      fingerprint: string;
      hostId: string;
      pairSecret: string;
    };
    const pairKey = await derivePairKey({
      fingerprint: qr.fingerprint,
      pairSecret: qr.pairSecret,
    });
    const sealedRequest = await sealFrame(
      pairKey,
      0,
      JSON.stringify({
        code: begin.code,
        requestedCapabilities: ["app:read"],
        shell: "web",
      })
    );
    const redeemResponse = await fetch(`${relay.httpUrl}/pair/relay`, {
      body: JSON.stringify({ hostId: qr.hostId, sealed: sealedRequest }),
      method: "POST",
    });
    expect(redeemResponse.status).toBe(200);
    const { sealed } = (await redeemResponse.json()) as {
      sealed: RelaySealedFrame;
    };
    const redeem = JSON.parse(await unsealFrame(pairKey, sealed, -1)) as {
      deviceId: string;
      deviceToken: string;
    };
    const relayPass = await deriveRelayPass({
      deviceToken: redeem.deviceToken,
      fingerprint: qr.fingerprint,
    });
    const e2eKey = await deriveE2eKey({
      deviceToken: redeem.deviceToken,
      fingerprint: qr.fingerprint,
    });
    const downlink = await WsClient.connect(`${relay.wsUrl}/downlink`);
    downlink.send({
      deviceId: redeem.deviceId,
      hostId: qr.hostId,
      protocolVersion: 1,
      relayPass,
      type: "downlink.hello",
    });
    expect(await downlink.next()).toEqual({ type: "downlink.ready" });
    const ephemeral = await generateEphemeral();
    const clientNonce = crypto.getRandomValues(new Uint8Array(16));
    downlink.send({
      handshake: {
        clientEphPub: toBase64Url(ephemeral.publicKey),
        clientNonce: toBase64Url(clientNonce),
        type: "channel.init",
      },
      kind: "plain",
    });
    const ack = (await downlink.next()) as {
      handshake: { hostEphPub: string; hostNonce: string };
    };
    const channelKey = await deriveChannelKey(
      e2eKey,
      await ephemeral.exchange(fromBase64Url(ack.handshake.hostEphPub)),
      clientNonce,
      fromBase64Url(ack.handshake.hostNonce)
    );
    downlink.send(
      await sealFrame(
        channelKey,
        1,
        JSON.stringify({
          apiVersion: LOCAL_CONTROL_API_VERSION,
          auth: {
            deviceId: redeem.deviceId,
            deviceToken: redeem.deviceToken,
            method: "device-token",
            shell: "web",
          },
          clientKind: "mobile-paired",
          requestId: "h1",
          type: "client.hello",
        })
      )
    );
    const helloFrame = (await downlink.next()) as RelaySealedFrame;
    expect(
      JSON.parse(await unsealFrame(channelKey, helloFrame, -1))
    ).toMatchObject({
      type: "server.hello",
    });
    await vi.waitFor(() => {
      expect(clients.get(`mobile:${redeem.deviceId}`)).not.toBeNull();
    });
    downlink.close();
    await downlink.closed;
    await vi.waitFor(() => {
      expect(clients.get(`mobile:${redeem.deviceId}`)).toBeNull();
    });
  }, 15_000);

  it("redeem 抛错仍立刻回 pair.result，不让 relay 空等 timeout", async () => {
    relay = await startRelay({ pairResultTimeoutMs: 8000 });
    const { pairing } = await makeHostSide();
    const activeDialer = dialer;
    if (!activeDialer) {
      throw new Error("dialer not created");
    }
    vi.spyOn(pairing, "redeemSealedForRelay").mockRejectedValue(
      new Error("seal exploded")
    );
    activeDialer.start();
    await vi.waitFor(() => {
      expect(activeDialer.state()).toBe("connected");
    });
    const hostId = pairing.getIdentity()?.hostId ?? "";
    const started = Date.now();
    const response = await fetch(`${relay.httpUrl}/pair/relay`, {
      body: JSON.stringify({
        hostId,
        sealed: { ct: "Y3Q", iv: "aXY", kind: "sealed", seq: 0, v: 1 },
      }),
      method: "POST",
    });
    expect(Date.now() - started).toBeLessThan(4000);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sealed: RelaySealedFrame };
    expect(body.sealed.kind).toBe("sealed");
  }, 15_000);

  it("stop 即离线；relay 侧在线态收敛", async () => {
    relay = await startRelay();
    const { pairing } = await makeHostSide();
    const activeDialer = dialer;
    if (!activeDialer) {
      throw new Error("dialer not created");
    }
    activeDialer.start();
    await vi.waitFor(() => {
      expect(activeDialer.state()).toBe("connected");
    });
    const hostId = pairing.getIdentity()?.hostId ?? "";
    expect(relay.server.registry.isOnline(hostId)).toBe(true);

    activeDialer.stop();
    expect(activeDialer.state()).toBe("stopped");
    await vi.waitFor(() => {
      expect(relay?.server.registry.isOnline(hostId)).toBe(false);
    });
  });
});
