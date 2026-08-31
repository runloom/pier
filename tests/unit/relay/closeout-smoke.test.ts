// @vitest-environment node
/**
 * M2 会合冒烟（收尾计划 WP4）：一条用例串起闭环路径——
 * 宿主 uplink 准入 → 手机 downlink 握手 → 密封载体往返 →
 * 名册删除踢线 → 宿主离线 host_offline。
 * in-process 起 relay，不打扰主力机 e2e。
 */
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

describe("M2 会合闭环冒烟", () => {
  it("准入 → 往返 → 吊销踢线 → 宿主离线", async () => {
    relay = await startRelay();
    const identity = makeHostIdentity();
    const uplink = await connectUplink({
      wsUrl: relay.wsUrl,
      identity,
      roster: [{ deviceId: "d1", relayPassHash: sha256Hex("pass-1") }],
    });

    const downlink = await WsClient.connect(`${relay.wsUrl}/downlink`);
    downlink.send({
      type: "downlink.hello",
      protocolVersion: 1,
      hostId: identity.hostId,
      deviceId: "d1",
      relayPass: "pass-1",
    });
    expect(await downlink.next()).toEqual({ type: "downlink.ready" });

    downlink.send(SEALED_FIXTURE);
    expect(await uplink.next()).toEqual({
      type: "envelope",
      deviceId: "d1",
      frame: SEALED_FIXTURE,
    });

    uplink.send({
      type: "envelope",
      deviceId: "d1",
      frame: SEALED_FIXTURE,
    });
    expect(await downlink.next()).toEqual(SEALED_FIXTURE);

    uplink.send({
      type: "roster.update",
      remove: ["d1"],
    });
    expect(await downlink.next()).toEqual({
      type: "server.error",
      code: "auth_failed",
    });
    await downlink.closed;

    const second = await WsClient.connect(`${relay.wsUrl}/downlink`);
    second.send({
      type: "downlink.hello",
      protocolVersion: 1,
      hostId: identity.hostId,
      deviceId: "d1",
      relayPass: "pass-1",
    });
    expect(await second.next()).toEqual({
      type: "server.error",
      code: "host_offline",
    });
    await second.closed;

    const third = await WsClient.connect(`${relay.wsUrl}/downlink`);
    third.send({
      type: "downlink.hello",
      protocolVersion: 1,
      hostId: identity.hostId,
      deviceId: "d2",
      relayPass: "pass-2",
    });
    expect(await third.next()).toEqual({
      type: "server.error",
      code: "host_offline",
    });
    await third.closed;

    const live = await connectUplink({
      wsUrl: relay.wsUrl,
      identity,
      roster: [{ deviceId: "d2", relayPassHash: sha256Hex("pass-2") }],
    });
    uplink.close();

    const fourth = await WsClient.connect(`${relay.wsUrl}/downlink`);
    fourth.send({
      type: "downlink.hello",
      protocolVersion: 1,
      hostId: identity.hostId,
      deviceId: "d2",
      relayPass: "pass-2",
    });
    expect(await fourth.next()).toEqual({ type: "downlink.ready" });
    live.close();
    expect(await fourth.next()).toEqual({
      type: "server.error",
      code: "host_offline",
    });
    await fourth.closed;
  });
});
