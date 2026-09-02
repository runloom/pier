// @vitest-environment node
/**
 * 会合 HTTP 客户端（M2 Task 9）：在线态批量查询与密封赎回。
 * relayPass 从 deviceToken 派生（不落盘）；赎回请求与结果全程密文。
 */

import { describe, expect, it, vi } from "vitest";
import {
  fetchHostsStatus,
  httpBaseFromRelayUrl,
  redeemViaRelay,
} from "../../../apps/mobile-web/src/lib/relay-api.ts";
import type { RelaySealedFrame } from "../../../src/shared/contracts/relay/index.ts";
import {
  derivePairKey,
  sealFrame,
  unsealFrame,
} from "../../../src/shared/crypto/e2e-seal.ts";

const FINGERPRINT = "abcdef0123456789";

describe("httpBaseFromRelayUrl", () => {
  it("wss→https、ws→http，去掉尾斜杠", () => {
    expect(httpBaseFromRelayUrl("wss://relay.pier.codes")).toBe(
      "https://relay.pier.codes"
    );
    expect(httpBaseFromRelayUrl("ws://127.0.0.1:8787/")).toBe(
      "http://127.0.0.1:8787"
    );
  });
});

describe("fetchHostsStatus", () => {
  it("派生 relayPass 后 POST；返回 hostId→online 映射", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            { hostId: "h1", online: true },
            { hostId: "h2", online: false },
          ]),
          { status: 200 }
        )
    );
    const result = await fetchHostsStatus(
      "wss://relay.example.com",
      [
        {
          deviceId: "d1",
          deviceToken: "token-1",
          fingerprint: FINGERPRINT,
          hostId: "h1",
        },
      ],
      fetchImpl as unknown as typeof fetch
    );
    expect(result).not.toBeNull();
    expect(result?.get("h1")).toBe(true);
    expect(result?.get("h2")).toBe(false);
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://relay.example.com/hosts/status");
    const body = JSON.parse(call[1].body as string);
    // 请求体带 relayPass 而非 deviceToken（令牌不出网）。
    expect(body[0]).toHaveProperty("relayPass");
    expect(JSON.stringify(body)).not.toContain("token-1");
  });

  it("空查询零请求 → 空 Map；非 200 / 网络异常 → null（状态未知，非离线）", async () => {
    const fetchImpl = vi.fn();
    expect(await fetchHostsStatus("wss://r", [], fetchImpl as never)).toEqual(
      new Map()
    );
    expect(fetchImpl).not.toHaveBeenCalled();

    const query = [
      {
        deviceId: "d1",
        deviceToken: "t",
        fingerprint: FINGERPRINT,
        hostId: "h1",
      },
    ];
    const failing = vi.fn(async () => new Response("", { status: 500 }));
    expect(
      await fetchHostsStatus("wss://r", query, failing as never)
    ).toBeNull();

    const throwing = vi.fn(async () => {
      throw new Error("network down");
    });
    expect(
      await fetchHostsStatus("wss://r", query, throwing as never)
    ).toBeNull();
  });
});

describe("redeemViaRelay", () => {
  const PAIR_SECRET = "pair-secret-000000000000000000000000000000";

  it("密封请求 → 宿主解封验证 → 密封结果解封为令牌", async () => {
    const pairKey = await derivePairKey({
      fingerprint: FINGERPRINT,
      pairSecret: PAIR_SECRET,
    });
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const { sealed } = JSON.parse(init.body as string) as {
        sealed: RelaySealedFrame;
      };
      // 宿主侧：解封请求（证明 relay 未见明文），回密封结果。
      const requestJson = await unsealFrame(pairKey, sealed, -1);
      expect(JSON.parse(requestJson)).toMatchObject({ code: "123456" });
      const result = await sealFrame(
        pairKey,
        0,
        JSON.stringify({
          deviceId: "dev-9",
          deviceToken: "granted-token",
          grantedCapabilities: ["app:read"],
          tokenEpoch: 0,
        })
      );
      return new Response(JSON.stringify({ sealed: result }), { status: 200 });
    });

    const outcome = await redeemViaRelay(
      {
        fingerprint: FINGERPRINT,
        hostId: "h1",
        pairSecret: PAIR_SECRET,
        relayUrl: "wss://relay.example.com",
        request: {
          code: "123456",
          requestedCapabilities: ["app:read"],
          shell: "web",
        },
      },
      fetchImpl as unknown as typeof fetch
    );
    expect(outcome).toEqual({
      deviceId: "dev-9",
      deviceToken: "granted-token",
      grantedCapabilities: ["app:read"],
      ok: true,
      tokenEpoch: 0,
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://relay.example.com/pair/relay"
    );
  });

  it("非 200 → 带 reason 的失败", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ reason: "host_offline" }), {
          status: 502,
        })
    );
    const outcome = await redeemViaRelay(
      {
        fingerprint: FINGERPRINT,
        hostId: "h1",
        pairSecret: PAIR_SECRET,
        relayUrl: "wss://r",
        request: {
          code: "000000",
          requestedCapabilities: [],
          shell: "web",
        },
      },
      fetchImpl as unknown as typeof fetch
    );
    expect(outcome).toEqual({ ok: false, reason: "host_offline" });
  });
});
