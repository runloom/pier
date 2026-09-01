// @vitest-environment jsdom
/**
 * relay 宿主存储键与 reach 判定（M2 页面接线）：hostId 稳定键防占位撞键，
 * canReachViaRelay 三要素门。
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  canReachViaRelay,
  loadHosts,
  removeHostByKey,
  type StoredHost,
  saveHost,
  storedHostKey,
} from "../../../apps/mobile-web/src/lib/paired-hosts.ts";

function relayHost(hostId: string): StoredHost {
  return {
    deviceId: `dev-${hostId}`,
    deviceToken: `token-${hostId}`,
    fingerprint: "abcdef0123456789",
    // 占位 host/port：两台 relay 宿主经同一 relayUrl 会相同（稳定键靠 hostId）。
    host: "relay.pier.codes",
    hostId,
    pairedAt: 0,
    port: 443,
    relayUrl: "wss://relay.pier.codes",
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("storedHostKey", () => {
  it("relay 宿主用 hostId；direct 宿主回落 host:port", () => {
    expect(storedHostKey(relayHost("h1"))).toBe("h1");
    expect(
      storedHostKey({
        deviceId: "d",
        deviceToken: "t",
        host: "192.168.1.5",
        pairedAt: 0,
        port: 47_000,
      })
    ).toBe("192.168.1.5:47000");
  });
});

describe("canReachViaRelay", () => {
  it("三要素齐备才为真", () => {
    expect(canReachViaRelay(relayHost("h1"))).toBe(true);
    expect(
      canReachViaRelay({
        deviceId: "d",
        deviceToken: "t",
        host: "192.168.1.5",
        pairedAt: 0,
        port: 47_000,
      })
    ).toBe(false);
  });
});

describe("saveHost / removeHostByKey 按稳定键", () => {
  it("两台占位 host 相同的 relay 宿主不互相覆盖", () => {
    saveHost(relayHost("h1"));
    saveHost(relayHost("h2"));
    const hosts = loadHosts();
    expect(hosts).toHaveLength(2);
    expect(new Set(hosts.map(storedHostKey))).toEqual(new Set(["h1", "h2"]));
  });

  it("按 hostId 键移除只删目标台", () => {
    saveHost(relayHost("h1"));
    saveHost(relayHost("h2"));
    removeHostByKey("h1");
    const hosts = loadHosts();
    expect(hosts).toHaveLength(1);
    expect(storedHostKey(hosts[0] as StoredHost)).toBe("h2");
  });

  it("relay 宿主 additive 字段 round-trip 持久化", () => {
    saveHost(relayHost("h1"));
    const [restored] = loadHosts();
    expect(restored).toMatchObject({
      fingerprint: "abcdef0123456789",
      hostId: "h1",
      relayUrl: "wss://relay.pier.codes",
    });
  });

  it("先 LAN 再会合 QR（同 host:port）合并成一条，保留 hostId", () => {
    saveHost({
      deviceId: "dev-lan",
      deviceToken: "tok-lan",
      host: "192.168.1.10",
      pairedAt: 0,
      port: 4455,
    });
    saveHost({
      deviceId: "dev-relay",
      deviceToken: "tok-relay",
      fingerprint: "abcdef0123456789",
      host: "192.168.1.10",
      hostId: "h1",
      pairedAt: 1,
      port: 4455,
      relayUrl: "wss://relay.pier.codes",
    });
    const hosts = loadHosts();
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toMatchObject({
      deviceId: "dev-relay",
      hostId: "h1",
      relayUrl: "wss://relay.pier.codes",
    });
  });

  it("会合后再 LAN 同 host:port 仍一条，不丢会合字段", () => {
    saveHost({
      deviceId: "dev-relay",
      deviceToken: "tok-relay",
      fingerprint: "abcdef0123456789",
      host: "192.168.1.10",
      hostId: "h1",
      pairedAt: 0,
      port: 4455,
      relayUrl: "wss://relay.pier.codes",
    });
    saveHost({
      deviceId: "dev-lan",
      deviceToken: "tok-lan",
      host: "192.168.1.10",
      pairedAt: 1,
      port: 4455,
    });
    const hosts = loadHosts();
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toMatchObject({
      deviceId: "dev-lan",
      hostId: "h1",
      relayUrl: "wss://relay.pier.codes",
    });
  });

  it("读取时合并已落盘的 LAN + 会合重复条目", () => {
    window.localStorage.setItem(
      "pier.mobile.hosts",
      JSON.stringify([
        {
          deviceId: "dev-relay",
          deviceToken: "tok-relay",
          fingerprint: "abcdef0123456789",
          host: "192.168.1.10",
          hostId: "h1",
          pairedAt: 1,
          port: 4455,
          relayUrl: "wss://relay.pier.codes",
        },
        {
          deviceId: "dev-lan",
          deviceToken: "tok-lan",
          host: "192.168.1.10",
          pairedAt: 0,
          port: 4455,
        },
      ])
    );
    const hosts = loadHosts();
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toMatchObject({ deviceId: "dev-relay", hostId: "h1" });
    expect(
      JSON.parse(window.localStorage.getItem("pier.mobile.hosts") ?? "[]")
    ).toHaveLength(1);
  });
});
