/**
 * 配对服务：配对码 / 设备令牌签发 / 常数时间认证 / 吊销与 epoch 核对。
 *
 * 状态全部落在 PairingStore（同步 get/mutate，调用方负责 init）；服务本体
 * 只持 store 引用、注入时钟与 onRevoke 监听者集合。安全不变量：
 * - 配对码一次性：redeem 成功即清 pendingPairing；过期 redeem 一并清除。
 * - 令牌原文永不出内存：磁盘只见 sha256Hex(token)。
 * - 认证与配对码比较都走 crypto.timingSafeEqual（先哈希到定长再比）。
 * - epoch 语义 = 「设备存在且 epoch 相等」；吊销即删设备，旧 epoch 自然失效。
 */

// 命名空间调用 timingSafeEqual：内置模块 CJS exports 可变，单测经
// vi.spyOn(nodeCrypto, "timingSafeEqual") 跨模块验证常数时间比较真实发生。
import nodeCrypto from "node:crypto";
import type { PairingStore } from "@main/state/pairing-store.ts";
import {
  DEFAULT_CAPABILITIES_BY_CLIENT_KIND,
  type PierCapability,
} from "@shared/contracts/permissions.ts";
import type {
  PierPairedDevice,
  PierPairingRequest,
} from "@shared/contracts/remote.ts";
import { buildPairingQrPayload } from "./qr-payload.ts";
import {
  fingerprintFromSecret,
  generateDeviceToken,
  generatePairingCode,
  sha256Hex,
} from "./tokens.ts";

/** 配对码有效期：5 分钟。 */
export const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;

const MOBILE_GRANT_CAPABILITIES: readonly PierCapability[] =
  DEFAULT_CAPABILITIES_BY_CLIENT_KIND["mobile-paired"];

export type PairingRedeemResult =
  | {
      ok: true;
      deviceId: string;
      deviceToken: string;
      grantedCapabilities: PierCapability[];
      tokenEpoch: number;
    }
  | { ok: false; reason: "pairing_expired" | "pairing_invalid" };

export type PairingAuthResult =
  | { ok: true; device: PierPairedDevice }
  | { ok: false };

export interface PairingService {
  /** 每命令核对：设备存在且 epoch 相等。 */
  assertEpochCurrent(deviceId: string, tokenEpoch: number): boolean;
  authenticate(deviceId: string, token: string): PairingAuthResult;
  beginPairing(args: { host: string; port: number }): {
    code: string;
    qrPayload: string;
    expiresAt: number;
  };
  cancelPairing(): void;
  listDevices(): PierPairedDevice[];
  /** 适配器订阅吊销以踢会话；返回退订函数。 */
  onRevoke(listener: (deviceId: string) => void): () => void;
  /**
   * 待决配对的内存态 QR 视图（remoteAccess.getState 消费）：占位未过期
   * 且为本进程签发 → { qrPayload, expiresAt }；否则 null。qrPayload 含
   * 明码配对码，只活内存不落盘；重启后既有占位不可再展示为 QR。
   */
  pendingPairing(): { expiresAt: number; qrPayload: string } | null;
  redeemPairingCode(req: PierPairingRequest): PairingRedeemResult;
  revokeDevice(deviceId: string): { revoked: boolean };
  touchLastSeen(deviceId: string): void;
}

export function createPairingService(args: {
  store: PairingStore;
  now?: () => number;
}): PairingService {
  const { store } = args;
  const now = args.now ?? Date.now;
  const revokeListeners = new Set<(deviceId: string) => void>();
  /** 本进程最近签发的配对 QR 载荷（含明码配对码，只活内存）。 */
  let lastIssuedPairing: {
    codeHash: string;
    expiresAt: number;
    qrPayload: string;
  } | null = null;

  /** 定长哈希后的常数时间比较（长度不一致直接判负，不进入比较）。 */
  function hashesEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    return (
      bufA.length === bufB.length && nodeCrypto.timingSafeEqual(bufA, bufB)
    );
  }

  function findDevice(deviceId: string): PierPairedDevice | undefined {
    return store.get().devices.find((device) => device.deviceId === deviceId);
  }

  return {
    beginPairing({ host, port }) {
      const code = generatePairingCode();
      const codeHash = sha256Hex(code);
      const expiresAt = now() + PAIRING_CODE_TTL_MS;
      const state = store.mutate((current) => ({
        ...current,
        pendingPairing: { codeHash, expiresAt },
      }));
      const qrPayload = buildPairingQrPayload({
        code,
        fingerprint: fingerprintFromSecret(state.instanceSecret),
        host,
        port,
      });
      lastIssuedPairing = { codeHash, expiresAt, qrPayload };
      return { code, expiresAt, qrPayload };
    },

    cancelPairing() {
      store.mutate((current) => ({ ...current, pendingPairing: null }));
    },

    redeemPairingCode(req) {
      const pending = store.get().pendingPairing;
      if (!pending) {
        return { ok: false, reason: "pairing_invalid" };
      }
      if (now() >= pending.expiresAt) {
        store.mutate((current) => ({ ...current, pendingPairing: null }));
        return { ok: false, reason: "pairing_expired" };
      }
      if (!hashesEqual(sha256Hex(req.code), pending.codeHash)) {
        // 错误尝试不消耗配对码，有效窗口内仍可重试。
        return { ok: false, reason: "pairing_invalid" };
      }

      const grantedCapabilities = req.requestedCapabilities.filter(
        (capability) => MOBILE_GRANT_CAPABILITIES.includes(capability)
      );
      const deviceToken = generateDeviceToken();
      const deviceId = nodeCrypto.randomUUID();
      const device: PierPairedDevice = {
        capabilities: grantedCapabilities,
        createdAt: now(),
        deviceId,
        lastSeenAt: now(),
        // 优先用请求自报的 name；缺省以 id 派生占位名。
        name: req.name ?? `mobile-${deviceId.slice(0, 8)}`,
        shell: req.shell ?? "web",
        tokenEpoch: 0,
        tokenHash: sha256Hex(deviceToken),
      };
      store.mutate((current) => ({
        ...current,
        devices: [...current.devices, device],
        pendingPairing: null,
      }));
      return {
        ok: true,
        deviceId,
        deviceToken,
        grantedCapabilities,
        tokenEpoch: device.tokenEpoch,
      };
    },

    authenticate(deviceId, token) {
      const device = findDevice(deviceId);
      if (!(device && hashesEqual(sha256Hex(token), device.tokenHash))) {
        return { ok: false };
      }
      return { ok: true, device: { ...device } };
    },

    revokeDevice(deviceId) {
      if (!findDevice(deviceId)) {
        return { revoked: false };
      }
      store.mutate((current) => ({
        ...current,
        devices: current.devices.filter(
          (device) => device.deviceId !== deviceId
        ),
      }));
      for (const listener of revokeListeners) {
        listener(deviceId);
      }
      return { revoked: true };
    },

    assertEpochCurrent(deviceId, tokenEpoch) {
      const device = findDevice(deviceId);
      return device !== undefined && device.tokenEpoch === tokenEpoch;
    },

    listDevices() {
      return store.get().devices.map((device) => ({
        ...device,
        capabilities: [...device.capabilities],
      }));
    },
    pendingPairing() {
      const pending = store.get().pendingPairing;
      if (!pending || now() >= pending.expiresAt) {
        return null;
      }
      if (
        !lastIssuedPairing ||
        lastIssuedPairing.codeHash !== pending.codeHash
      ) {
        return null;
      }
      return {
        expiresAt: pending.expiresAt,
        qrPayload: lastIssuedPairing.qrPayload,
      };
    },

    touchLastSeen(deviceId) {
      if (!findDevice(deviceId)) {
        return;
      }
      store.mutate((current) => ({
        ...current,
        devices: current.devices.map((device) =>
          device.deviceId === deviceId
            ? { ...device, lastSeenAt: now() }
            : device
        ),
      }));
    },

    onRevoke(listener) {
      revokeListeners.add(listener);
      return () => {
        revokeListeners.delete(listener);
      };
    },
  };
}
