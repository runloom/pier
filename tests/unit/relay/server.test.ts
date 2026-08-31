// @vitest-environment node
/** HTTP 面（服务端设计 §5.2/§5.3/§8）：健康检查、在线态不泄露、赎回限速。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import {
  connectUplink,
  makeHostIdentity,
  type RunningRelay,
  sha256Hex,
  startRelay,
} from "./helpers.ts";

let relay: RunningRelay | null = null;
afterEach(async () => {
  await relay?.stop();
  relay = null;
});

describe("GET /healthz 与未知路由", () => {
  it("healthz 200；未知路由 404", async () => {
    relay = await startRelay();
    const ok = await fetch(`${relay.httpUrl}/healthz`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    const missing = await fetch(`${relay.httpUrl}/nope`, { method: "POST" });
    expect(missing.status).toBe(404);
  });
});

describe("POST /hosts/status：无有效通行证探测不到任何存在性", () => {
  it("在线 + 通行证正确 → online；错通行证 / 离线 / 未知 hostId 全部 offline", async () => {
    relay = await startRelay();
    const identity = makeHostIdentity();
    const uplink = await connectUplink({
      wsUrl: relay.wsUrl,
      identity,
      roster: [{ deviceId: "d1", relayPassHash: sha256Hex("pass-1") }],
    });

    const query = async (entries: unknown) => {
      const response = await fetch(`${relay?.httpUrl}/hosts/status`, {
        method: "POST",
        body: JSON.stringify(entries),
      });
      expect(response.status).toBe(200);
      return response.json();
    };

    expect(
      await query([
        { hostId: identity.hostId, deviceId: "d1", relayPass: "pass-1" },
        { hostId: identity.hostId, deviceId: "d1", relayPass: "wrong" },
        { hostId: "f".repeat(64), deviceId: "d1", relayPass: "pass-1" },
      ])
    ).toEqual([
      { hostId: identity.hostId, online: true },
      { hostId: identity.hostId, online: false },
      { hostId: "f".repeat(64), online: false },
    ]);

    uplink.close();
    await uplink.closed;
    // 服务端 close 处理器与客户端 close 事件存在竞态：轮询收敛到离线。
    await vi.waitFor(async () => {
      expect(
        await query([
          { hostId: identity.hostId, deviceId: "d1", relayPass: "pass-1" },
        ])
      ).toEqual([{ hostId: identity.hostId, online: false }]);
    });
  });

  it("坏 body 400；超限 429", async () => {
    relay = await startRelay({ statusPerIpPerMinute: 2 });
    const bad = await fetch(`${relay.httpUrl}/hosts/status`, {
      method: "POST",
      body: JSON.stringify([{ hostId: "h1" }]),
    });
    expect(bad.status).toBe(400);
    await fetch(`${relay.httpUrl}/hosts/status`, {
      method: "POST",
      body: "[]",
    });
    const limited = await fetch(`${relay.httpUrl}/hosts/status`, {
      method: "POST",
      body: "[]",
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ reason: "rate_limited" });
  });

  it("loopback 反代下 X-Forwarded-For 第一跳分 IP 限速", async () => {
    relay = await startRelay({ statusPerIpPerMinute: 1 });
    const query = (forwarded: string) =>
      fetch(`${relay?.httpUrl}/hosts/status`, {
        method: "POST",
        headers: { "x-forwarded-for": forwarded },
        body: "[]",
      });
    expect((await query("10.0.0.1")).status).toBe(200);
    expect((await query("10.0.0.1")).status).toBe(429);
    expect((await query("10.0.0.2")).status).toBe(200);
  });
});

describe("WS 心跳：一轮无 pong 则 terminate", () => {
  it("autoPong 关闭的下行在错过心跳后被断开", async () => {
    relay = await startRelay({ heartbeatIntervalMs: 40 });
    const identity = makeHostIdentity();
    const uplink = await connectUplink({
      wsUrl: relay.wsUrl,
      identity,
      roster: [{ deviceId: "d1", relayPassHash: sha256Hex("p") }],
    });
    const socket = new WebSocket(`${relay.wsUrl}/downlink`, {
      autoPong: false,
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    socket.send(
      JSON.stringify({
        type: "downlink.hello",
        protocolVersion: 1,
        hostId: identity.hostId,
        deviceId: "d1",
        relayPass: "p",
      })
    );
    await new Promise<void>((resolve, reject) => {
      socket.once("message", () => resolve());
      setTimeout(() => reject(new Error("no ready")), 2000);
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("close", () => resolve());
      setTimeout(() => reject(new Error("heartbeat did not terminate")), 2000);
    });
    uplink.close();
  });
});

describe("POST /pair/relay：宿主离线与限速", () => {
  const sealedBody = {
    hostId: "a".repeat(64),
    sealed: { kind: "sealed", v: 1, seq: 0, iv: "aXY", ct: "Y3Q" },
  };

  it("宿主离线 → 502 host_offline", async () => {
    relay = await startRelay();
    const response = await fetch(`${relay.httpUrl}/pair/relay`, {
      method: "POST",
      body: JSON.stringify(sealedBody),
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ reason: "host_offline" });
  });

  it("明文赎回体（缺 sealed）被契约拒绝 → 400", async () => {
    relay = await startRelay();
    const response = await fetch(`${relay.httpUrl}/pair/relay`, {
      method: "POST",
      body: JSON.stringify({ hostId: "a".repeat(64), code: "123456" }),
    });
    expect(response.status).toBe(400);
  });

  it("单 IP 赎回超限 → 429", async () => {
    relay = await startRelay({ redeemsPerIpPerMinute: 1 });
    await fetch(`${relay.httpUrl}/pair/relay`, {
      method: "POST",
      body: JSON.stringify(sealedBody),
    });
    const limited = await fetch(`${relay.httpUrl}/pair/relay`, {
      method: "POST",
      body: JSON.stringify(sealedBody),
    });
    expect(limited.status).toBe(429);
  });

  it("单宿主赎回超限 → 429（跨 IP 维度独立计数）", async () => {
    relay = await startRelay({ redeemsPerHostPerHour: 1 });
    await fetch(`${relay.httpUrl}/pair/relay`, {
      method: "POST",
      body: JSON.stringify(sealedBody),
    });
    const limited = await fetch(`${relay.httpUrl}/pair/relay`, {
      method: "POST",
      body: JSON.stringify(sealedBody),
    });
    expect(limited.status).toBe(429);
  });
});
