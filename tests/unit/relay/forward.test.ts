// @vitest-environment node
/**
 * 转发语义六条行为契约（M2 计划 Task 4；服务端设计 §5/§7）：
 * 挑战准入与后来者胜、通行证准入与统一 host_offline、盲透传、
 * 宿主离线断管道、名册增删联动、赎回盲传。
 * 另锁：帧速限制、relay 源码无帧内容解析（静态断言）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  connectUplink,
  makeHostIdentity,
  type RunningRelay,
  SEALED_FIXTURE,
  sha256Hex,
  startRelay,
  WsClient,
} from "./helpers.ts";

let relay: RunningRelay | null = null;
afterEach(async () => {
  await relay?.stop();
  relay = null;
});

async function connectDownlink(args: {
  wsUrl: string;
  hostId: string;
  deviceId: string;
  relayPass: string;
}): Promise<WsClient> {
  const downlink = await WsClient.connect(`${args.wsUrl}/downlink`);
  downlink.send({
    type: "downlink.hello",
    protocolVersion: 1,
    hostId: args.hostId,
    deviceId: args.deviceId,
    relayPass: args.relayPass,
  });
  return downlink;
}

describe("契约 1：挑战准入与同 hostId 后来者胜", () => {
  it("签名错误 → auth_failed 断连；重复拨号踢旧连接", async () => {
    relay = await startRelay();
    const identity = makeHostIdentity();

    const bad = await WsClient.connect(`${relay.wsUrl}/uplink`);
    await bad.next(); // server.challenge
    bad.send({
      type: "uplink.hello",
      protocolVersion: 1,
      hostId: identity.hostId,
      hostPubKey: identity.hostPubKey,
      signature: identity.signNonce("wrong-nonce"),
      roster: [],
    });
    expect(await bad.next()).toEqual({
      type: "server.error",
      code: "auth_failed",
    });
    await bad.closed;

    const first = await connectUplink({
      wsUrl: relay.wsUrl,
      identity,
      roster: [],
    });
    const second = await connectUplink({
      wsUrl: relay.wsUrl,
      identity,
      roster: [],
    });
    await first.closed; // 旧连接被踢
    second.close();
  });
});

describe("契约 2：downlink 通行证准入（统一 host_offline，防探测）", () => {
  it("通行证正确 → ready；错通行证与离线宿主同样答 host_offline", async () => {
    relay = await startRelay();
    const identity = makeHostIdentity();
    const uplink = await connectUplink({
      wsUrl: relay.wsUrl,
      identity,
      roster: [{ deviceId: "d1", relayPassHash: sha256Hex("pass-1") }],
    });

    const good = await connectDownlink({
      wsUrl: relay.wsUrl,
      hostId: identity.hostId,
      deviceId: "d1",
      relayPass: "pass-1",
    });
    expect(await good.next()).toEqual({ type: "downlink.ready" });
    good.close();

    const badPass = await connectDownlink({
      wsUrl: relay.wsUrl,
      hostId: identity.hostId,
      deviceId: "d1",
      relayPass: "wrong",
    });
    expect(await badPass.next()).toEqual({
      type: "server.error",
      code: "host_offline",
    });
    await badPass.closed;

    const unknownHost = await connectDownlink({
      wsUrl: relay.wsUrl,
      hostId: "f".repeat(64),
      deviceId: "d1",
      relayPass: "pass-1",
    });
    expect(await unknownHost.next()).toEqual({
      type: "server.error",
      code: "host_offline",
    });
    await unknownHost.closed;
    uplink.close();
  });

  it("每设备并发管道超上限 → 踢掉最旧连接，新连接准入", async () => {
    relay = await startRelay({ maxDownlinksPerDevice: 1 });
    const identity = makeHostIdentity();
    const uplink = await connectUplink({
      wsUrl: relay.wsUrl,
      identity,
      roster: [{ deviceId: "d1", relayPassHash: sha256Hex("p") }],
    });
    const first = await connectDownlink({
      wsUrl: relay.wsUrl,
      hostId: identity.hostId,
      deviceId: "d1",
      relayPass: "p",
    });
    expect(await first.next()).toEqual({ type: "downlink.ready" });
    const second = await connectDownlink({
      wsUrl: relay.wsUrl,
      hostId: identity.hostId,
      deviceId: "d1",
      relayPass: "p",
    });
    expect(await second.next()).toEqual({ type: "downlink.ready" });
    expect(await first.next()).toEqual({
      type: "server.error",
      code: "rate_limited",
    });
    await first.closed;
    second.send({
      kind: "plain",
      handshake: {
        type: "channel.init",
        clientEphPub: "eph",
        clientNonce: "nonce",
      },
    });
    expect(await uplink.next()).toEqual({
      type: "envelope",
      deviceId: "d1",
      frame: {
        kind: "plain",
        handshake: {
          type: "channel.init",
          clientEphPub: "eph",
          clientNonce: "nonce",
        },
      },
    });
    second.close();
    await second.closed;
    expect(await uplink.next()).toEqual({
      type: "downlink.gone",
      deviceId: "d1",
    });
    uplink.close();
  });
});

describe("契约 3：双向盲透传（wire 扁平）", () => {
  it("downlink 直发载体 → 宿主收 envelope；宿主 envelope → downlink 收扁平载体", async () => {
    relay = await startRelay();
    const identity = makeHostIdentity();
    const uplink = await connectUplink({
      wsUrl: relay.wsUrl,
      identity,
      roster: [{ deviceId: "d1", relayPassHash: sha256Hex("p") }],
    });
    const downlink = await connectDownlink({
      wsUrl: relay.wsUrl,
      hostId: identity.hostId,
      deviceId: "d1",
      relayPass: "p",
    });
    await downlink.next(); // ready

    downlink.send(SEALED_FIXTURE);
    expect(await uplink.next()).toEqual({
      type: "envelope",
      deviceId: "d1",
      frame: SEALED_FIXTURE,
    });

    const handshake = {
      kind: "plain",
      handshake: {
        type: "channel.ack",
        hostNonce: "bm9uY2U",
        hostEphPub: "cHVi",
      },
    };
    uplink.send({ type: "envelope", deviceId: "d1", frame: handshake });
    expect(await downlink.next()).toEqual(handshake);

    downlink.close();
    uplink.close();
  });

  it("非载体帧（伪装命令）→ protocol_error 断连", async () => {
    relay = await startRelay();
    const identity = makeHostIdentity();
    const uplink = await connectUplink({
      wsUrl: relay.wsUrl,
      identity,
      roster: [{ deviceId: "d1", relayPassHash: sha256Hex("p") }],
    });
    const downlink = await connectDownlink({
      wsUrl: relay.wsUrl,
      hostId: identity.hostId,
      deviceId: "d1",
      relayPass: "p",
    });
    await downlink.next();
    downlink.send({ type: "command", requestId: "r1", command: {} });
    expect(await downlink.next()).toEqual({
      type: "server.error",
      code: "protocol_error",
    });
    await downlink.closed;
    uplink.close();
  });
});

describe("最后一条 downlink 关闭 → uplink 收 downlink.gone", () => {
  it("同设备两条管道时只在最后一条关闭后通知宿主", async () => {
    relay = await startRelay({ maxDownlinksPerDevice: 2 });
    const identity = makeHostIdentity();
    const uplink = await connectUplink({
      wsUrl: relay.wsUrl,
      identity,
      roster: [{ deviceId: "d1", relayPassHash: sha256Hex("p") }],
    });
    const first = await connectDownlink({
      wsUrl: relay.wsUrl,
      hostId: identity.hostId,
      deviceId: "d1",
      relayPass: "p",
    });
    expect(await first.next()).toEqual({ type: "downlink.ready" });
    const second = await connectDownlink({
      wsUrl: relay.wsUrl,
      hostId: identity.hostId,
      deviceId: "d1",
      relayPass: "p",
    });
    expect(await second.next()).toEqual({ type: "downlink.ready" });
    first.close();
    await first.closed;
    second.close();
    expect(await uplink.next()).toEqual({
      type: "downlink.gone",
      deviceId: "d1",
    });
    uplink.close();
  });
});

describe("诚实 host_offline 不占用 uplink 失败窗", () => {
  it("downlink 反复打离线宿主后，同 IP 的 uplink 仍能准入", async () => {
    relay = await startRelay({ helloFailuresPerMinute: 2 });
    const identity = makeHostIdentity();
    for (let i = 0; i < 4; i += 1) {
      const phone = await connectDownlink({
        wsUrl: relay.wsUrl,
        hostId: identity.hostId,
        deviceId: "d1",
        relayPass: "p",
      });
      expect(await phone.next()).toEqual({
        type: "server.error",
        code: "host_offline",
      });
      await phone.closed;
    }
    const uplink = await connectUplink({
      wsUrl: relay.wsUrl,
      identity,
      roster: [{ deviceId: "d1", relayPassHash: sha256Hex("p") }],
    });
    expect(relay.server.registry.isOnline(identity.hostId)).toBe(true);
    uplink.close();
  });
});

describe("契约 4：宿主离线 → 全部管道收 host_offline 并断开", () => {
  it("uplink 断开后 downlink 即刻收错误帧", async () => {
    relay = await startRelay();
    const identity = makeHostIdentity();
    const uplink = await connectUplink({
      wsUrl: relay.wsUrl,
      identity,
      roster: [{ deviceId: "d1", relayPassHash: sha256Hex("p") }],
    });
    const downlink = await connectDownlink({
      wsUrl: relay.wsUrl,
      hostId: identity.hostId,
      deviceId: "d1",
      relayPass: "p",
    });
    await downlink.next();
    uplink.close();
    expect(await downlink.next()).toEqual({
      type: "server.error",
      code: "host_offline",
    });
    await downlink.closed;
  });
});

describe("契约 5：名册增删联动", () => {
  it("remove 即断该设备管道；upsert 后新设备可接入", async () => {
    relay = await startRelay();
    const identity = makeHostIdentity();
    const uplink = await connectUplink({
      wsUrl: relay.wsUrl,
      identity,
      roster: [{ deviceId: "d1", relayPassHash: sha256Hex("p1") }],
    });
    const downlink = await connectDownlink({
      wsUrl: relay.wsUrl,
      hostId: identity.hostId,
      deviceId: "d1",
      relayPass: "p1",
    });
    await downlink.next();

    uplink.send({
      type: "roster.update",
      upsert: [{ deviceId: "d2", relayPassHash: sha256Hex("p2") }],
      remove: ["d1"],
    });
    expect(await downlink.next()).toEqual({
      type: "server.error",
      code: "auth_failed",
    });
    await downlink.closed;

    const fresh = await connectDownlink({
      wsUrl: relay.wsUrl,
      hostId: identity.hostId,
      deviceId: "d2",
      relayPass: "p2",
    });
    expect(await fresh.next()).toEqual({ type: "downlink.ready" });
    fresh.close();
    uplink.close();
  });
});

describe("契约 6：赎回盲传", () => {
  it("HTTP 密封体 → 宿主 pair.request → pair.result → HTTP 200 密文", async () => {
    relay = await startRelay();
    const identity = makeHostIdentity();
    const uplink = await connectUplink({
      wsUrl: relay.wsUrl,
      identity,
      roster: [],
    });

    const responsePromise = fetch(`${relay.httpUrl}/pair/relay`, {
      method: "POST",
      body: JSON.stringify({ hostId: identity.hostId, sealed: SEALED_FIXTURE }),
    });
    const request = (await uplink.next()) as {
      type: string;
      requestId: string;
      sealedRequest: unknown;
    };
    expect(request.type).toBe("pair.request");
    expect(request.sealedRequest).toEqual(SEALED_FIXTURE);

    const sealedResult = { ...SEALED_FIXTURE, ct: "cmVzdWx0" };
    uplink.send({
      type: "pair.result",
      requestId: request.requestId,
      ok: true,
      sealedResult,
    });
    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sealed: sealedResult });
    uplink.close();
  });

  it("宿主不应答 → 超时 504 relay_error", async () => {
    relay = await startRelay({ pairResultTimeoutMs: 120 });
    const identity = makeHostIdentity();
    const uplink = await connectUplink({
      wsUrl: relay.wsUrl,
      identity,
      roster: [],
    });
    const response = await fetch(`${relay.httpUrl}/pair/relay`, {
      method: "POST",
      body: JSON.stringify({ hostId: identity.hostId, sealed: SEALED_FIXTURE }),
    });
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ reason: "relay_error" });
    uplink.close();
  });
});

describe("帧速限制", () => {
  it("单连接超过每秒帧数上限 → rate_limited 断连", async () => {
    relay = await startRelay({ framesPerSecond: 3 });
    const identity = makeHostIdentity();
    const uplink = await connectUplink({
      wsUrl: relay.wsUrl,
      identity,
      roster: [{ deviceId: "d1", relayPassHash: sha256Hex("p") }],
    });
    const downlink = await connectDownlink({
      wsUrl: relay.wsUrl,
      hostId: identity.hostId,
      deviceId: "d1",
      relayPass: "p",
    });
    await downlink.next();
    // hello 已计 1 帧；再发 3 帧，第 3 帧触发超限。
    downlink.send(SEALED_FIXTURE);
    downlink.send(SEALED_FIXTURE);
    downlink.send(SEALED_FIXTURE);
    // 宿主收到前两帧的 envelope。
    await uplink.next();
    await uplink.next();
    expect(await downlink.next()).toEqual({
      type: "server.error",
      code: "rate_limited",
    });
    await downlink.closed;
    uplink.close();
  });
});

describe("治理：relay 源码盲性静态断言（服务端设计 §13 前置锁）", () => {
  it("forward.ts 不 import 密封实现、不解析载体内容", () => {
    const source = readFileSync(
      join(process.cwd(), "apps/relay/src/forward.ts"),
      "utf8"
    );
    expect(source.includes("e2e-seal")).toBe(false);
    expect(source.includes("unseal")).toBe(false);
    expect(source).not.toMatch(/JSON\.parse\([^)]*\.frame/);
    expect(source).not.toMatch(/\.ct\b/);
    expect(source.includes("deviceToken")).toBe(false);
  });
});
