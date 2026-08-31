/**
 * relay 帧契约形状锁（M2 Task 1）：正负用例 + 协议冻结（无 DOM 依赖）。
 * 文字权威：docs/superpowers/specs/2026-08-31-mobile-relay-server-design.md §5。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  channelHandshakeFrameSchema,
  downlinkClientFrameSchema,
  downlinkServerFrameSchema,
  hostsStatusRequestSchema,
  hostsStatusResponseSchema,
  pairRelayFailureReasonSchema,
  pairRelayRequestSchema,
  pairRequestFrameSchema,
  pairResultFrameSchema,
  RELAY_PROTOCOL_VERSION,
  relayEnvelopeFrameSchema,
  relayErrorCodeSchema,
  relaySealedFrameSchema,
  rosterUpdateFrameSchema,
  uplinkClientFrameSchema,
  uplinkServerFrameSchema,
} from "@shared/contracts/relay/index.ts";
import { describe, expect, it } from "vitest";

const SEALED = {
  kind: "sealed",
  v: 1,
  seq: 7,
  iv: "aXY",
  ct: "Y3Q",
} as const;

describe("载体联合 RelayEnvelopeFrame（服务端设计 §6）", () => {
  it("接受密文帧并锁定 seq/v 字段", () => {
    expect(relaySealedFrameSchema.parse(SEALED)).toEqual(SEALED);
    expect(() =>
      relaySealedFrameSchema.parse({ ...SEALED, seq: -1 })
    ).toThrow();
    expect(() => relaySealedFrameSchema.parse({ ...SEALED, v: 2 })).toThrow();
    expect(() =>
      relaySealedFrameSchema.parse({ ...SEALED, plaintext: "x" })
    ).toThrow();
  });

  it("plain 变体只允许 channel.init / channel.ack", () => {
    const init = {
      kind: "plain",
      handshake: {
        type: "channel.init",
        clientNonce: "bm9uY2U",
        clientEphPub: "cHVi",
      },
    };
    expect(relayEnvelopeFrameSchema.parse(init)).toEqual(init);
    const ack = {
      type: "channel.ack",
      hostNonce: "bm9uY2U",
      hostEphPub: "cHVi",
    };
    expect(channelHandshakeFrameSchema.parse(ack)).toEqual(ack);
    expect(() =>
      relayEnvelopeFrameSchema.parse({
        kind: "plain",
        handshake: { type: "command", requestId: "r1" },
      })
    ).toThrow();
  });
});

describe("uplink 帧（服务端设计 §5.1）", () => {
  const hello = {
    type: "uplink.hello",
    protocolVersion: RELAY_PROTOCOL_VERSION,
    hostId: "a".repeat(64),
    hostPubKey: "cHVibGljLWtleQ",
    signature: "c2ln",
    roster: [{ deviceId: "dev_1", relayPassHash: "b".repeat(64) }],
  };

  it("挑战应答 hello 带名册通过；缺签名/错版本被拒", () => {
    expect(uplinkClientFrameSchema.parse(hello)).toEqual(hello);
    expect(() =>
      uplinkClientFrameSchema.parse({ ...hello, signature: undefined })
    ).toThrow();
    expect(() =>
      uplinkClientFrameSchema.parse({ ...hello, protocolVersion: 0 })
    ).toThrow();
  });

  it("roster.update 支持增删且拒绝未知键", () => {
    const update = {
      type: "roster.update",
      upsert: [{ deviceId: "dev_2", relayPassHash: "c".repeat(64) }],
      remove: ["dev_1"],
    };
    expect(rosterUpdateFrameSchema.parse(update)).toEqual(update);
    expect(() =>
      rosterUpdateFrameSchema.parse({ ...update, tokens: [] })
    ).toThrow();
  });

  it("downlink.gone 只带 deviceId", () => {
    const gone = { type: "downlink.gone", deviceId: "dev_1" };
    expect(uplinkServerFrameSchema.parse(gone)).toEqual(gone);
    expect(() =>
      uplinkServerFrameSchema.parse({ ...gone, hostId: "h" })
    ).toThrow();
  });

  it("uplink envelope 只带 deviceId（hostId 由连接隐含）", () => {
    const envelope = { type: "envelope", deviceId: "dev_1", frame: SEALED };
    expect(uplinkClientFrameSchema.parse(envelope)).toEqual(envelope);
    expect(uplinkServerFrameSchema.parse(envelope)).toEqual(envelope);
    expect(() =>
      uplinkClientFrameSchema.parse({ ...envelope, hostId: "h" })
    ).toThrow();
  });

  it("赎回盲传帧：请求与结果本体都是密文", () => {
    const request = {
      type: "pair.request",
      requestId: "r1",
      sealedRequest: SEALED,
    };
    expect(pairRequestFrameSchema.parse(request)).toEqual(request);
    const result = {
      type: "pair.result",
      requestId: "r1",
      ok: true,
      sealedResult: SEALED,
    };
    expect(pairResultFrameSchema.parse(result)).toEqual(result);
    expect(() =>
      pairResultFrameSchema.parse({
        ...result,
        deviceToken: "leak",
      })
    ).toThrow();
  });
});

describe("downlink 帧（服务端设计 §5.2，wire 扁平）", () => {
  it("hello 带通行证；deviceToken 字段不存在于契约", () => {
    const hello = {
      type: "downlink.hello",
      protocolVersion: RELAY_PROTOCOL_VERSION,
      hostId: "a".repeat(64),
      deviceId: "dev_1",
      relayPass: "cGFzcw",
    };
    expect(downlinkClientFrameSchema.parse(hello)).toEqual(hello);
    expect(() =>
      downlinkClientFrameSchema.parse({ ...hello, deviceToken: "leak" })
    ).toThrow();
  });

  it("hello 之后载体联合直发（不套 envelope 包装）", () => {
    expect(downlinkClientFrameSchema.parse(SEALED)).toEqual(SEALED);
    expect(downlinkServerFrameSchema.parse(SEALED)).toEqual(SEALED);
    const error = { type: "server.error", code: "host_offline" };
    expect(downlinkServerFrameSchema.parse(error)).toEqual(error);
  });

  it("传输层错误码锁定（device_revoked 是宿主域，不在 relay 码表）", () => {
    for (const code of [
      "host_offline",
      "auth_failed",
      "rate_limited",
      "protocol_too_old",
      "protocol_error",
    ]) {
      expect(relayErrorCodeSchema.parse(code)).toBe(code);
    }
    expect(() => relayErrorCodeSchema.parse("device_revoked")).toThrow();
  });
});

describe("HTTP 契约（服务端设计 §5.2/§5.3）", () => {
  it("/hosts/status 凭通行证批量查询且上限 32", () => {
    const request = [{ hostId: "h1", deviceId: "dev_1", relayPass: "cGFzcw" }];
    expect(hostsStatusRequestSchema.parse(request)).toEqual(request);
    expect(() =>
      hostsStatusRequestSchema.parse(
        Array.from({ length: 33 }, (_, i) => ({
          hostId: `h${i}`,
          deviceId: "dev_1",
          relayPass: "p",
        }))
      )
    ).toThrow();
    expect(
      hostsStatusResponseSchema.parse([{ hostId: "h1", online: false }])
    ).toEqual([{ hostId: "h1", online: false }]);
  });

  it("/pair/relay 请求体必须是密封体（明文赎回无法通过契约）", () => {
    const request = { hostId: "a".repeat(64), sealed: SEALED };
    expect(pairRelayRequestSchema.parse(request)).toEqual(request);
    expect(() =>
      pairRelayRequestSchema.parse({
        hostId: "a".repeat(64),
        code: "123456",
      })
    ).toThrow();
    expect(pairRelayFailureReasonSchema.parse("host_offline")).toBe(
      "host_offline"
    );
  });
});

describe("协议冻结：帧契约零环境依赖（规格 §11.3 冻结第 1 条）", () => {
  it("relay.ts 源码不含 window / document / ServiceWorker / IndexedDB", () => {
    const source = readFileSync(
      join(process.cwd(), "src/shared/contracts/relay/index.ts"),
      "utf8"
    );
    for (const banned of [
      "window",
      "document",
      "ServiceWorker",
      "IndexedDB",
      "node:",
    ]) {
      expect(source.includes(banned), banned).toBe(false);
    }
  });
});
