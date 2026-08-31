import nodeCrypto from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPairingQrPayload,
  parsePairingQrPayload,
} from "@main/services/pairing/qr-payload.ts";
import {
  createPairingService,
  PAIRING_CODE_TTL_MS,
  type PairingService,
} from "@main/services/pairing/service.ts";
import {
  fingerprintFromSecret,
  generateDeviceToken,
  generatePairingCode,
  sha256Hex,
} from "@main/services/pairing/tokens.ts";
import {
  createPairingStore,
  type PairingStore,
} from "@main/state/pairing-store.ts";
import { DEFAULT_CAPABILITIES_BY_CLIENT_KIND } from "@shared/contracts/permissions.ts";
import {
  type PierPairingRequest,
  pairingQrPayloadSchema,
} from "@shared/contracts/remote.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MOBILE_DEFAULTS = DEFAULT_CAPABILITIES_BY_CLIENT_KIND["mobile-paired"];
const BASE_TIME = 1_700_000_000_000;

let currentTime = BASE_TIME;
const tempDirs: string[] = [];

function now(): number {
  return currentTime;
}

beforeEach(() => {
  currentTime = BASE_TIME;
});

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

async function makeService(): Promise<{
  filePath: string;
  service: PairingService;
  store: PairingStore;
}> {
  const dir = await mkdtemp(join(tmpdir(), "pier-pairing-service-"));
  tempDirs.push(dir);
  const filePath = join(dir, "pairing.json");
  const store = createPairingStore(filePath);
  await store.init();
  // resolveRelay 注入 null：本文件锁 M1 纯 LAN 语义，不随官方会合常量漂移。
  const service = createPairingService({
    now,
    resolveRelay: () => null,
    store,
  });
  return { filePath, service, store };
}

function redeemRequest(
  overrides: Partial<PierPairingRequest> = {}
): PierPairingRequest {
  return {
    code: "000000",
    requestedCapabilities: ["git:read"],
    ...overrides,
  };
}

describe("pairing tokens", () => {
  it("generates 6-digit numeric pairing codes", () => {
    for (let index = 0; index < 100; index += 1) {
      expect(generatePairingCode()).toMatch(/^\d{6}$/u);
    }
  });

  it("generates 43-char base64url device tokens with entropy", () => {
    const tokens = new Set(
      Array.from({ length: 32 }, () => generateDeviceToken())
    );
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    }
    expect(tokens.size).toBe(32);
  });

  it("hashes with sha256 hex and derives 16-char fingerprints", () => {
    expect(sha256Hex("pier")).toMatch(/^[0-9a-f]{64}$/u);
    expect(sha256Hex("pier")).toBe(sha256Hex("pier"));
    expect(fingerprintFromSecret("secret")).toBe(
      sha256Hex("secret").slice(0, 16)
    );
    expect(fingerprintFromSecret("secret")).toHaveLength(16);
  });
});

describe("pairing qr payload", () => {
  it("round-trips a built payload through the schema", () => {
    const raw = buildPairingQrPayload({
      code: "123456",
      fingerprint: "abcdef0123456789",
      host: "192.168.1.10",
      port: 4477,
    });
    const parsed = parsePairingQrPayload(raw);
    expect(parsed).toEqual({
      fingerprint: "abcdef0123456789",
      host: "192.168.1.10",
      pairingCode: "123456",
      port: 4477,
      relayHint: null,
    });
    expect(pairingQrPayloadSchema.parse(JSON.parse(raw)).relayHint).toBeNull();
  });

  it("returns null for non-JSON and schema-violating input", () => {
    expect(parsePairingQrPayload("not json")).toBeNull();
    expect(parsePairingQrPayload("{}")).toBeNull();
    expect(
      parsePairingQrPayload(
        JSON.stringify({
          fingerprint: "abc",
          pairingCode: "123456",
          relayHint: null,
          unexpected: true,
        })
      )
    ).toBeNull();
  });
});

describe("pairing service", () => {
  it("beginPairing returns a 6-digit code expiring in 5 minutes with a scannable payload", async () => {
    const { service, store } = await makeService();
    const result = service.beginPairing({ host: "192.168.1.10", port: 4477 });
    expect(result.code).toMatch(/^\d{6}$/u);
    expect(result.expiresAt).toBe(BASE_TIME + PAIRING_CODE_TTL_MS);
    expect(PAIRING_CODE_TTL_MS).toBe(5 * 60 * 1000);
    const payload = parsePairingQrPayload(result.qrPayload);
    expect(payload).toMatchObject({
      host: "192.168.1.10",
      pairingCode: result.code,
      port: 4477,
      relayHint: null,
    });
    expect(payload?.fingerprint).toBe(
      fingerprintFromSecret(store.get().instanceSecret)
    );
  });

  it("a new beginPairing invalidates the previous code", async () => {
    const { service } = await makeService();
    const first = service.beginPairing({ host: "h", port: 1 });
    service.beginPairing({ host: "h", port: 1 });
    expect(
      await service.redeemPairingCode(redeemRequest({ code: first.code }))
    ).toEqual({
      ok: false,
      reason: "pairing_invalid",
    });
  });

  it("redeems a valid code exactly once and clears the pending pairing", async () => {
    const { service, store } = await makeService();
    const { code } = service.beginPairing({ host: "h", port: 1 });
    const redeemed = await service.redeemPairingCode(redeemRequest({ code }));
    expect(redeemed).toMatchObject({ ok: true, tokenEpoch: 0 });
    expect(store.get().pendingPairing).toBeNull();
    expect(await service.redeemPairingCode(redeemRequest({ code }))).toEqual({
      ok: false,
      reason: "pairing_invalid",
    });
  });

  it("rejects redemption without a pending pairing", async () => {
    const { service } = await makeService();
    expect(await service.redeemPairingCode(redeemRequest())).toEqual({
      ok: false,
      reason: "pairing_invalid",
    });
  });

  it("rejects a wrong code without consuming the pending pairing", async () => {
    const { service } = await makeService();
    const { code } = service.beginPairing({ host: "h", port: 1 });
    const wrong = code === "000000" ? "000001" : "000000";
    expect(
      await service.redeemPairingCode(redeemRequest({ code: wrong }))
    ).toEqual({
      ok: false,
      reason: "pairing_invalid",
    });
    expect(
      await service.redeemPairingCode(redeemRequest({ code }))
    ).toMatchObject({
      ok: true,
    });
  });

  it("expires the code after 5 minutes", async () => {
    const { service, store } = await makeService();
    const { code, expiresAt } = service.beginPairing({ host: "h", port: 1 });
    currentTime = expiresAt - 1;
    expect(
      await service.redeemPairingCode(redeemRequest({ code }))
    ).toMatchObject({
      ok: true,
    });

    service.cancelPairing();
    const second = service.beginPairing({ host: "h", port: 1 });
    currentTime = second.expiresAt;
    expect(
      await service.redeemPairingCode(redeemRequest({ code: second.code }))
    ).toEqual({
      ok: false,
      reason: "pairing_expired",
    });
    expect(store.get().pendingPairing).toBeNull();
  });

  it("cancelPairing voids the pending code", async () => {
    const { service } = await makeService();
    const { code } = service.beginPairing({ host: "h", port: 1 });
    service.cancelPairing();
    expect(await service.redeemPairingCode(redeemRequest({ code }))).toEqual({
      ok: false,
      reason: "pairing_invalid",
    });
  });

  it("grants only the intersection with mobile-paired defaults", async () => {
    const { service } = await makeService();
    const { code } = service.beginPairing({ host: "h", port: 1 });
    const redeemed = await service.redeemPairingCode(
      redeemRequest({
        code,
        requestedCapabilities: [
          "terminal:control",
          "git:read",
          "window:close",
          "app:read",
        ],
      })
    );
    if (!redeemed.ok) {
      throw new Error("expected redeem to succeed");
    }
    expect(redeemed.grantedCapabilities).toEqual(["git:read", "app:read"]);
    for (const capability of redeemed.grantedCapabilities) {
      expect(MOBILE_DEFAULTS).toContain(capability);
    }
    expect(service.listDevices()[0]?.capabilities).toEqual([
      "git:read",
      "app:read",
    ]);
  });

  it("uses the provided name for the persisted device", async () => {
    const { service } = await makeService();
    const { code } = service.beginPairing({ host: "h", port: 1 });
    const redeemed = await service.redeemPairingCode(
      redeemRequest({ code, name: "小明的手机" })
    );
    if (!redeemed.ok) {
      throw new Error("expected redeem to succeed");
    }
    const device = service
      .listDevices()
      .find((entry) => entry.deviceId === redeemed.deviceId);
    expect(device?.name).toBe("小明的手机");
  });

  it("defaults shell to web and records an explicit shell", async () => {
    const { service } = await makeService();
    const first = service.beginPairing({ host: "h", port: 1 });
    const webRedeemed = await service.redeemPairingCode(
      redeemRequest({ code: first.code })
    );
    if (!webRedeemed.ok) {
      throw new Error("expected redeem to succeed");
    }
    const second = service.beginPairing({ host: "h", port: 1 });
    const appRedeemed = await service.redeemPairingCode(
      redeemRequest({ code: second.code, shell: "app" })
    );
    if (!appRedeemed.ok) {
      throw new Error("expected redeem to succeed");
    }
    const devices = service.listDevices();
    expect(
      devices.find((device) => device.deviceId === webRedeemed.deviceId)?.shell
    ).toBe("web");
    expect(
      devices.find((device) => device.deviceId === appRedeemed.deviceId)?.shell
    ).toBe("app");
  });

  it("persists only the token hash, never the raw token", async () => {
    const { filePath, service, store } = await makeService();
    const { code } = service.beginPairing({ host: "h", port: 1 });
    const redeemed = await service.redeemPairingCode(redeemRequest({ code }));
    if (!redeemed.ok) {
      throw new Error("expected redeem to succeed");
    }
    const device = service
      .listDevices()
      .find((entry) => entry.deviceId === redeemed.deviceId);
    expect(device?.tokenHash).toBe(sha256Hex(redeemed.deviceToken));
    expect(device?.tokenHash).not.toBe(redeemed.deviceToken);
    await store.flush();
    const onDisk = await readFile(filePath, "utf-8");
    expect(onDisk).not.toContain(redeemed.deviceToken);
    expect(onDisk).toContain(sha256Hex(redeemed.deviceToken));
  });

  it("authenticates with a constant-time token comparison", async () => {
    const { service } = await makeService();
    const { code } = service.beginPairing({ host: "h", port: 1 });
    const redeemed = await service.redeemPairingCode(redeemRequest({ code }));
    if (!redeemed.ok) {
      throw new Error("expected redeem to succeed");
    }

    const timingSpy = vi.spyOn(nodeCrypto, "timingSafeEqual");
    timingSpy.mockClear(); // 忽略 redeem 阶段的配对码比较
    const authed = service.authenticate(
      redeemed.deviceId,
      redeemed.deviceToken
    );
    expect(authed).toMatchObject({
      ok: true,
      device: { deviceId: redeemed.deviceId },
    });
    expect(timingSpy).toHaveBeenCalled();

    timingSpy.mockClear();
    expect(
      service.authenticate(redeemed.deviceId, generateDeviceToken())
    ).toEqual({ ok: false });
    expect(timingSpy).toHaveBeenCalled();
    timingSpy.mockRestore();

    expect(
      service.authenticate("no-such-device", redeemed.deviceToken)
    ).toEqual({ ok: false });
  });

  it("revokeDevice removes the device and notifies onRevoke listeners", async () => {
    const { service } = await makeService();
    const { code } = service.beginPairing({ host: "h", port: 1 });
    const redeemed = await service.redeemPairingCode(redeemRequest({ code }));
    if (!redeemed.ok) {
      throw new Error("expected redeem to succeed");
    }

    const revoked: string[] = [];
    const unsubscribe = service.onRevoke((deviceId) => {
      revoked.push(deviceId);
    });
    expect(service.revokeDevice(redeemed.deviceId)).toEqual({ revoked: true });
    expect(revoked).toEqual([redeemed.deviceId]);
    expect(service.listDevices()).toEqual([]);
    expect(
      service.authenticate(redeemed.deviceId, redeemed.deviceToken)
    ).toEqual({ ok: false });

    expect(service.revokeDevice(redeemed.deviceId)).toEqual({ revoked: false });
    expect(revoked).toEqual([redeemed.deviceId]);

    unsubscribe();
    const second = service.beginPairing({ host: "h", port: 1 });
    const secondRedeemed = await service.redeemPairingCode(
      redeemRequest({ code: second.code })
    );
    if (!secondRedeemed.ok) {
      throw new Error("expected redeem to succeed");
    }
    service.revokeDevice(secondRedeemed.deviceId);
    expect(revoked).toEqual([redeemed.deviceId]);
  });

  it("revokeDevice 同时清掉该设备的 Web Push 句柄", async () => {
    const { service, store } = await makeService();
    const { code } = service.beginPairing({ host: "h", port: 1 });
    const redeemed = await service.redeemPairingCode(redeemRequest({ code }));
    if (!redeemed.ok) {
      throw new Error("expected redeem to succeed");
    }
    store.mutate((current) => ({
      ...current,
      pushHandles: [
        {
          deviceId: redeemed.deviceId,
          shell: "web",
          webPush: {
            endpoint: "https://web.push.example/sub",
            keys: { auth: "auth", p256dh: "pub" },
          },
        },
      ],
    }));
    expect(service.revokeDevice(redeemed.deviceId)).toEqual({ revoked: true });
    expect(store.get().pushHandles).toEqual([]);
  });

  it("checks token epochs against live devices only", async () => {
    const { service } = await makeService();
    const { code } = service.beginPairing({ host: "h", port: 1 });
    const redeemed = await service.redeemPairingCode(redeemRequest({ code }));
    if (!redeemed.ok) {
      throw new Error("expected redeem to succeed");
    }
    expect(redeemed.tokenEpoch).toBe(0);
    expect(service.assertEpochCurrent(redeemed.deviceId, 0)).toBe(true);
    expect(service.assertEpochCurrent(redeemed.deviceId, 1)).toBe(false);
    expect(service.assertEpochCurrent("no-such-device", 0)).toBe(false);

    service.revokeDevice(redeemed.deviceId);
    expect(service.assertEpochCurrent(redeemed.deviceId, 0)).toBe(false);

    const second = service.beginPairing({ host: "h", port: 1 });
    const rebuilt = await service.redeemPairingCode(
      redeemRequest({ code: second.code })
    );
    if (!rebuilt.ok) {
      throw new Error("expected redeem to succeed");
    }
    expect(rebuilt.tokenEpoch).toBe(0);
    expect(service.assertEpochCurrent(rebuilt.deviceId, 0)).toBe(true);
  });

  it("touchLastSeen stamps the device with the injected clock", async () => {
    const { service } = await makeService();
    const { code } = service.beginPairing({ host: "h", port: 1 });
    const redeemed = await service.redeemPairingCode(redeemRequest({ code }));
    if (!redeemed.ok) {
      throw new Error("expected redeem to succeed");
    }
    const created = service
      .listDevices()
      .find((device) => device.deviceId === redeemed.deviceId);
    expect(created?.createdAt).toBe(BASE_TIME);
    expect(created?.lastSeenAt).toBe(BASE_TIME);

    currentTime = BASE_TIME + 60_000;
    service.touchLastSeen(redeemed.deviceId);
    expect(
      service
        .listDevices()
        .find((device) => device.deviceId === redeemed.deviceId)?.lastSeenAt
    ).toBe(BASE_TIME + 60_000);
    service.touchLastSeen("no-such-device");
  });
});
