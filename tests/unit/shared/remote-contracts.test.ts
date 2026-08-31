/**
 * 配对/QR 契约与 M2 冻结数据模型（规格 §17.2 / §17.3）。
 * QR payload 必含 relayHint 键；四个 M2 冻结类型各一正一负形状用例；
 * PierPairedDevice 源码注释锁 additive 演进约束。
 * @see docs/superpowers/specs/2026-08-26-mobile-companion-design.md
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  pairingFailureReasonSchema,
  pairingQrPayloadSchema,
  pairingRedeemResultSchema,
  pierAccountRefSchema,
  pierCompanionShellSchema,
  pierHostRegistrationSchema,
  pierPairingRequestSchema,
  pierPushHandleSchema,
  pierRelayEnvelopeSchema,
} from "@shared/contracts/remote.ts";
import { describe, expect, it } from "vitest";

describe("pairing QR payload (§17.2)", () => {
  it("round-trips and always carries the relayHint key", () => {
    const payload = {
      pairingCode: "123456",
      fingerprint: "abcdef0123456789",
      host: "192.168.1.10",
      port: 4477,
      relayHint: null,
    };
    const parsed = pairingQrPayloadSchema.parse(payload);
    expect(parsed).toEqual(payload);
    expect(Object.keys(parsed)).toContain("relayHint");
    expect(JSON.parse(JSON.stringify(parsed))).toHaveProperty(
      "relayHint",
      null
    );
  });

  it("rejects a payload missing relayHint or carrying extra keys", () => {
    expect(() =>
      pairingQrPayloadSchema.parse({
        pairingCode: "123456",
        fingerprint: "abcdef0123456789",
      })
    ).toThrow();
    expect(() =>
      pairingQrPayloadSchema.parse({
        pairingCode: "123456",
        fingerprint: "abcdef0123456789",
        relayHint: null,
        unexpected: true,
      })
    ).toThrow();
  });

  it("M2 additive：hostId 与 pairSecret 可选字段 round-trip（≥43 字符）", () => {
    const payload = {
      pairingCode: "123456",
      fingerprint: "abcdef0123456789",
      hostId: "a".repeat(64),
      pairSecret: "s".repeat(43),
      relayHint: "wss://relay.example.com",
    };
    expect(pairingQrPayloadSchema.parse(payload)).toEqual(payload);
    expect(() =>
      pairingQrPayloadSchema.parse({ ...payload, pairSecret: "too-short" })
    ).toThrow();
  });

  it("relayHint 注释锁定 M2 会合 wss 语义；账号类型锁定为保留位", () => {
    const source = readFileSync(
      join(process.cwd(), "src/shared/contracts/remote.ts"),
      "utf8"
    );
    expect(source).toMatch(/wss/u);
    expect(source).toMatch(/保留位（未来可选账号层）/u);
    expect(source).toMatch(/第十三次修订/u);
  });
});

describe("pairing HTTP contract (§17.2)", () => {
  it("round-trips a redeem result", () => {
    const result = {
      deviceId: "dev_1",
      deviceToken: "tok_1",
      grantedCapabilities: ["git:read", "app:read"],
      tokenEpoch: 0,
    };
    expect(pairingRedeemResultSchema.parse(result)).toEqual(result);
  });

  it("rejects a redeem result with unknown capabilities or extra keys", () => {
    expect(() =>
      pairingRedeemResultSchema.parse({
        deviceId: "dev_1",
        deviceToken: "tok_1",
        grantedCapabilities: ["not:a-capability"],
        tokenEpoch: 0,
      })
    ).toThrow();
    expect(() =>
      pairingRedeemResultSchema.parse({
        deviceId: "dev_1",
        deviceToken: "tok_1",
        grantedCapabilities: [],
        tokenEpoch: 0,
        extra: 1,
      })
    ).toThrow();
  });

  it("locks the pairing failure reasons", () => {
    expect(pairingFailureReasonSchema.parse("pairing_expired")).toBe(
      "pairing_expired"
    );
    expect(pairingFailureReasonSchema.parse("pairing_invalid")).toBe(
      "pairing_invalid"
    );
    expect(() => pairingFailureReasonSchema.parse("pairing_denied")).toThrow();
  });

  it("accepts an optional device name up to 64 chars on the pairing request", () => {
    const request = {
      code: "123456",
      requestedCapabilities: ["git:read"],
      shell: "web",
      name: "小明的手机",
    };
    expect(pierPairingRequestSchema.parse(request)).toEqual(request);
    expect(() =>
      pierPairingRequestSchema.parse({
        code: "123456",
        requestedCapabilities: [],
        name: "x".repeat(65),
      })
    ).toThrow();
  });
});

describe("M2 frozen data models (§17.3)", () => {
  it("PierAccountRef: opaque accountId only", () => {
    expect(pierAccountRefSchema.parse({ accountId: "acct_1" })).toEqual({
      accountId: "acct_1",
    });
    expect(() => pierAccountRefSchema.parse({})).toThrow();
    expect(() =>
      pierAccountRefSchema.parse({ accountId: "acct_1", email: "a@b.c" })
    ).toThrow();
  });

  it("PierHostRegistration: relay registry entry shape", () => {
    const entry = {
      hostId: "host_1",
      accountId: "acct_1",
      fingerprint: "abcdef0123456789",
      online: true,
      lastSeenAt: 1_700_000_000_000,
    };
    expect(pierHostRegistrationSchema.parse(entry)).toEqual(entry);
    expect(() =>
      pierHostRegistrationSchema.parse({ ...entry, online: "yes" })
    ).toThrow();
  });

  it("PierPushHandle: per-shell push handle with optional Web Push", () => {
    const minimal = { deviceId: "dev_1", shell: "app" };
    expect(pierPushHandleSchema.parse(minimal)).toEqual(minimal);
    const withWebPush = {
      deviceId: "dev_1",
      shell: "web",
      webPush: {
        endpoint: "https://push.example.com/sub/1",
        keys: { p256dh: "p256dh-key", auth: "auth-secret" },
      },
    };
    expect(pierPushHandleSchema.parse(withWebPush)).toEqual(withWebPush);
    expect(() =>
      pierPushHandleSchema.parse({
        deviceId: "dev_1",
        shell: "web",
        webPush: {
          endpoint: "not-a-url",
          keys: { p256dh: "k", auth: "a" },
        },
      })
    ).toThrow();
  });

  it("PierRelayEnvelope: opaque frame passthrough", () => {
    const envelope = {
      hostId: "host_1",
      deviceId: "dev_1",
      frame: { type: "command", requestId: "r1", command: {} },
    };
    expect(pierRelayEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(() =>
      pierRelayEnvelopeSchema.parse({ hostId: "host_1", frame: {} })
    ).toThrow();
  });

  it("shares one companion shell schema across contracts", () => {
    expect(pierCompanionShellSchema.parse("miniprogram")).toBe("miniprogram");
    expect(() => pierCompanionShellSchema.parse("desktop")).toThrow();
  });
});

describe("PierPairedDevice evolution freeze", () => {
  it("source comment locks additive-only evolution", () => {
    const source = readFileSync(
      join(process.cwd(), "src/shared/contracts/remote.ts"),
      "utf8"
    );
    expect(source).toMatch(/演进只许 additive/u);
    expect(source).toMatch(/M2 冻结/u);
  });
});
