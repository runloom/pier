// @vitest-environment node
/** 在线表 + 名册（服务端设计 §3）：后来者胜、常数时间通行证核对、增删返回。 */

import { describe, expect, it, vi } from "vitest";
import {
  createRelayRegistry,
  sha256Hex,
} from "../../../apps/relay/src/registry.ts";

function makePort() {
  return { send: vi.fn(), close: vi.fn() };
}

describe("createRelayRegistry", () => {
  it("同 hostId 重复上线返回被踢的旧连接（后来者胜）", () => {
    const registry = createRelayRegistry();
    const first = makePort();
    const second = makePort();
    expect(registry.setOnline("h1", first, [])).toBeNull();
    expect(registry.setOnline("h1", second, [])).toBe(first);
    expect(registry.uplinkOf("h1")).toBe(second);
  });

  it("setOffline 只对当前连接生效（旧连接迟到 close 不误踢）", () => {
    const registry = createRelayRegistry();
    const first = makePort();
    const second = makePort();
    registry.setOnline("h1", first, []);
    registry.setOnline("h1", second, []);
    expect(registry.setOffline("h1", first)).toBe(false);
    expect(registry.isOnline("h1")).toBe(true);
    expect(registry.setOffline("h1", second)).toBe(true);
    expect(registry.isOnline("h1")).toBe(false);
  });

  it("verifyPass 对照名册哈希；宿主离线 / 不在名册一律 false", () => {
    const registry = createRelayRegistry();
    expect(registry.verifyPass("h1", "d1", "pass")).toBe(false);
    registry.setOnline("h1", makePort(), [
      { deviceId: "d1", relayPassHash: sha256Hex("pass") },
    ]);
    expect(registry.verifyPass("h1", "d1", "pass")).toBe(true);
    expect(registry.verifyPass("h1", "d1", "wrong")).toBe(false);
    expect(registry.verifyPass("h1", "d2", "pass")).toBe(false);
  });

  it("applyRosterUpdate：upsert 即时可用，remove 返回被删设备", () => {
    const registry = createRelayRegistry();
    registry.setOnline("h1", makePort(), [
      { deviceId: "d1", relayPassHash: sha256Hex("p1") },
    ]);
    expect(
      registry.applyRosterUpdate(
        "h1",
        [{ deviceId: "d2", relayPassHash: sha256Hex("p2") }],
        undefined
      )
    ).toEqual([]);
    expect(registry.verifyPass("h1", "d2", "p2")).toBe(true);
    expect(
      registry.applyRosterUpdate("h1", undefined, ["d1", "ghost"])
    ).toEqual(["d1"]);
    expect(registry.verifyPass("h1", "d1", "p1")).toBe(false);
    expect(registry.rosterSize("h1")).toBe(1);
  });

  it("离线宿主的名册操作是空操作", () => {
    const registry = createRelayRegistry();
    expect(registry.applyRosterUpdate("ghost", [], ["d1"])).toEqual([]);
  });
});
