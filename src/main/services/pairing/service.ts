/**
 * 配对服务：配对码 / 设备令牌签发 / 常数时间认证 / 吊销与 epoch 核对，
 * M2 起叠加：宿主身份（Ed25519）、E2E 密钥与会合通行证派生、名册事件、
 * relay 密封赎回（服务端设计 §4/§5.3）。
 *
 * 状态全部落在 PairingStore（同步 get/mutate，调用方负责 init）；服务本体
 * 只持 store/secrets 引用、注入时钟与监听者集合。安全不变量：
 * - 配对码一次性：redeem 成功即清 pendingPairing；过期 redeem 一并清除。
 * - 令牌原文永不出内存：磁盘只见 sha256Hex(token)；e2eKey 只进 secrets-store。
 * - 认证与配对码比较都走 crypto.timingSafeEqual（先哈希到定长再比）。
 * - epoch 语义 = 「设备存在且 epoch 相等」；吊销即删设备，旧 epoch 自然失效。
 * - pairSecret 只活内存（lastIssuedPairing）：重启后 relay 赎回自然失效，
 *   与「QR 五分钟一次性」同窗；relay 全程只见密文。
 */

// 命名空间调用 timingSafeEqual：内置模块 CJS exports 可变，单测经
// vi.spyOn(nodeCrypto, "timingSafeEqual") 跨模块验证常数时间比较真实发生。
import nodeCrypto from "node:crypto";
import type {
  PairingStore,
  StoredPairedDevice,
} from "@main/state/pairing-store.ts";
import type { SecretsStore } from "@main/state/secrets-store.ts";
import {
  DEFAULT_CAPABILITIES_BY_CLIENT_KIND,
  type PierCapability,
} from "@shared/contracts/permissions.ts";
import type { RelaySealedFrame } from "@shared/contracts/relay/index.ts";
import {
  type PierPairedDevice,
  type PierPairingRequest,
  pierPairingRequestSchema,
} from "@shared/contracts/remote.ts";
import {
  deriveE2eKey,
  derivePairKey,
  deriveRelayPass,
  fromBase64Url,
  sealFrame,
  toBase64Url,
  unsealFrame,
} from "@shared/crypto/e2e-seal.ts";
import { ensureHostIdentity, type HostIdentity } from "./host-identity.ts";
import { buildPairingQrPayload } from "./qr-payload.ts";
import { resolveRelayUrl } from "./relay-url.ts";
import {
  fingerprintFromSecret,
  generateDeviceToken,
  generatePairingCode,
  sha256Hex,
} from "./tokens.ts";

/** 配对码有效期：5 分钟。 */
export const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;

/** 设备 E2E 密钥在 secrets-store 的键前缀。 */
export const DEVICE_E2E_SECRET_PREFIX = "remote.e2e.";

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

/** 会合名册条目（宿主担保给 relay 的投影，服务端设计 §3）。 */
export interface HostRosterEntry {
  deviceId: string;
  relayPassHash: string;
}

export interface SealedRedeemOutcome {
  /** 成功时的新名册条目（uplink 先 roster.update 再 pair.result）。 */
  enrolled?: HostRosterEntry;
  ok: boolean;
  sealedResult: RelaySealedFrame;
}

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
  /** 设备 E2E 密钥（secrets-store）；未配对 / 已吊销 / 无 secrets → null。 */
  deviceE2eKey(deviceId: string): Promise<Uint8Array | null>;
  /** 首次使用前加载磁盘态并就绪宿主身份；幂等。默认关路径不得在 boot 调用。 */
  ensureReady(): Promise<void>;
  /** 宿主身份（ensureReady 之后可用；无 secrets 注入时恒 null）。 */
  getIdentity(): HostIdentity | null;
  listDevices(): PierPairedDevice[];
  /** 会合名册投影：仅含已派生通行证哈希的设备。 */
  listRoster(): HostRosterEntry[];
  /** 新设备入册（redeem 成功且派生完成）；uplink 订阅以增量担保。 */
  onEnroll(listener: (entry: HostRosterEntry) => void): () => void;
  /** 适配器订阅吊销以踢会话；返回退订函数。 */
  onRevoke(listener: (deviceId: string) => void): () => void;
  /**
   * 待决配对的内存态 QR 视图（remoteAccess.getState 消费）：占位未过期
   * 且为本进程签发 → { qrPayload, expiresAt }；否则 null。qrPayload 含
   * 明码配对码，只活内存不落盘；重启后既有占位不可再展示为 QR。
   */
  pendingPairing(): { expiresAt: number; qrPayload: string } | null;
  redeemPairingCode(req: PierPairingRequest): Promise<PairingRedeemResult>;
  /**
   * relay 盲传赎回（服务端设计 §5.3）：pairKey 解封 → 验码签发 → pairKey
   * 密封回包。无待决 pairSecret 或解封失败 → ok:false（回包尽力密封）。
   */
  redeemSealedForRelay(sealed: RelaySealedFrame): Promise<SealedRedeemOutcome>;
  /** 远程访问开关持久化视图（启动恢复消费）；缺省 false。 */
  remoteAccessEnabled(): boolean;
  revokeDevice(deviceId: string): { revoked: boolean };
  /** 用户显式开/关远程访问时写盘（重启自动恢复的唯一来源）。 */
  setRemoteAccessEnabled(enabled: boolean): void;
  touchLastSeen(deviceId: string): void;
}

export function createPairingService(args: {
  store: PairingStore;
  /** 注入后启用 M2 会合能力（身份 / E2E 派生 / 名册）；缺省为 M1 纯 LAN 形态。 */
  secrets?: SecretsStore;
  now?: () => number;
  /** 会合地址来源（测试注入 seam）；缺省读官方地址 + PIER_RELAY_URL 覆盖。 */
  resolveRelay?: () => string | null;
}): PairingService {
  const { store, secrets } = args;
  const now = args.now ?? Date.now;
  const resolveRelay = args.resolveRelay ?? resolveRelayUrl;
  const revokeListeners = new Set<(deviceId: string) => void>();
  const enrollListeners = new Set<(entry: HostRosterEntry) => void>();
  let identity: HostIdentity | null = null;
  /** 本进程最近签发的配对 QR 载荷（含明码配对码与 pairSecret，只活内存）。 */
  let lastIssuedPairing: {
    codeHash: string;
    expiresAt: number;
    qrPayload: string;
    pairSecret: string | null;
  } | null = null;

  /** 定长哈希后的常数时间比较（长度不一致直接判负，不进入比较）。 */
  function hashesEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, "utf8");
    const bufB = Buffer.from(b, "utf8");
    return (
      bufA.length === bufB.length && nodeCrypto.timingSafeEqual(bufA, bufB)
    );
  }

  function findDevice(deviceId: string): StoredPairedDevice | undefined {
    return store.get().devices.find((device) => device.deviceId === deviceId);
  }

  function currentFingerprint(): string {
    return (
      identity?.fingerprint ?? fingerprintFromSecret(store.get().instanceSecret)
    );
  }

  async function redeemCore(
    req: PierPairingRequest
  ): Promise<PairingRedeemResult> {
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

    const grantedCapabilities = req.requestedCapabilities.filter((capability) =>
      MOBILE_GRANT_CAPABILITIES.includes(capability)
    );
    const deviceToken = generateDeviceToken();
    const deviceId = nodeCrypto.randomUUID();

    // M2 派生（令牌原文仅此刻在内存）：e2eKey 进 secrets、通行证只存哈希。
    let relayPassHash: string | undefined;
    if (secrets) {
      const fingerprint = currentFingerprint();
      const e2eKey = await deriveE2eKey({ deviceToken, fingerprint });
      await secrets.set(
        `${DEVICE_E2E_SECRET_PREFIX}${deviceId}`,
        toBase64Url(e2eKey)
      );
      const relayPass = await deriveRelayPass({ deviceToken, fingerprint });
      relayPassHash = sha256Hex(relayPass);
    }

    const device: StoredPairedDevice = {
      capabilities: grantedCapabilities,
      createdAt: now(),
      deviceId,
      lastSeenAt: now(),
      // 优先用请求自报的 name；缺省以 id 派生占位名。
      name: req.name ?? `mobile-${deviceId.slice(0, 8)}`,
      shell: req.shell ?? "web",
      tokenEpoch: 0,
      tokenHash: sha256Hex(deviceToken),
      ...(relayPassHash === undefined ? {} : { relayPassHash }),
    };
    store.mutate((current) => ({
      ...current,
      devices: [...current.devices, device],
      pendingPairing: null,
    }));
    if (relayPassHash !== undefined) {
      const entry: HostRosterEntry = { deviceId, relayPassHash };
      for (const listener of enrollListeners) {
        listener(entry);
      }
    }
    return {
      ok: true,
      deviceId,
      deviceToken,
      grantedCapabilities,
      tokenEpoch: device.tokenEpoch,
    };
  }

  return {
    async ensureReady() {
      await store.init();
      if (secrets && identity === null) {
        identity = await ensureHostIdentity({ store, secrets });
      }
    },

    getIdentity() {
      return identity;
    },

    beginPairing({ host, port }) {
      const code = generatePairingCode();
      const codeHash = sha256Hex(code);
      const expiresAt = now() + PAIRING_CODE_TTL_MS;
      store.mutate((current) => ({
        ...current,
        pendingPairing: { codeHash, expiresAt },
      }));
      const pairSecret =
        identity === null
          ? null
          : nodeCrypto.randomBytes(32).toString("base64url");
      const qrPayload = buildPairingQrPayload({
        code,
        fingerprint: currentFingerprint(),
        host,
        port,
        ...(identity === null
          ? {}
          : { hostId: identity.hostId, pairSecret: pairSecret as string }),
        relayHint: resolveRelay(),
      });
      lastIssuedPairing = { codeHash, expiresAt, qrPayload, pairSecret };
      return { code, expiresAt, qrPayload };
    },

    cancelPairing() {
      store.mutate((current) => ({ ...current, pendingPairing: null }));
      lastIssuedPairing = null;
    },

    redeemPairingCode(req) {
      return redeemCore(req);
    },

    async redeemSealedForRelay(sealed) {
      const fingerprint = currentFingerprint();
      const pairSecret = lastIssuedPairing?.pairSecret ?? null;
      // 无待决密钥：以随机 key 密封拒绝（手机解不开 → 按无效配对处理），
      // 不向 relay 泄露任何可读信息。
      if (pairSecret === null) {
        const deadKey = nodeCrypto.randomBytes(32);
        return {
          ok: false,
          sealedResult: await sealFrame(
            new Uint8Array(deadKey),
            0,
            JSON.stringify({ reason: "pairing_invalid" })
          ),
        };
      }
      const pairKey = await derivePairKey({ pairSecret, fingerprint });
      let outcome: PairingRedeemResult;
      try {
        const requestJson = await unsealFrame(pairKey, sealed, -1);
        const parsed = pierPairingRequestSchema.safeParse(
          JSON.parse(requestJson)
        );
        outcome = parsed.success
          ? await redeemCore(parsed.data)
          : { ok: false, reason: "pairing_invalid" };
      } catch {
        outcome = { ok: false, reason: "pairing_invalid" };
      }
      const payload = outcome.ok
        ? {
            deviceId: outcome.deviceId,
            deviceToken: outcome.deviceToken,
            grantedCapabilities: outcome.grantedCapabilities,
            tokenEpoch: outcome.tokenEpoch,
          }
        : { reason: outcome.reason };
      const sealedResult = await sealFrame(pairKey, 0, JSON.stringify(payload));
      if (!outcome.ok) {
        return { ok: false, sealedResult };
      }
      const device = findDevice(outcome.deviceId);
      return {
        ok: true,
        sealedResult,
        ...(device?.relayPassHash === undefined
          ? {}
          : {
              enrolled: {
                deviceId: outcome.deviceId,
                relayPassHash: device.relayPassHash,
              },
            }),
      };
    },

    authenticate(deviceId, token) {
      const device = findDevice(deviceId);
      if (!(device && hashesEqual(sha256Hex(token), device.tokenHash))) {
        return { ok: false };
      }
      const { relayPassHash: _internal, ...contractShape } = device;
      return {
        ok: true,
        device: {
          ...contractShape,
          capabilities: [...device.capabilities],
        },
      };
    },

    remoteAccessEnabled() {
      return store.get().remoteAccessEnabled === true;
    },

    setRemoteAccessEnabled(enabled) {
      store.mutate((current) => ({ ...current, remoteAccessEnabled: enabled }));
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
        pushHandles: (current.pushHandles ?? []).filter(
          (handle) => handle.deviceId !== deviceId
        ),
      }));
      // E2E 密钥随吊销即刻作废；删除失败不阻断吊销（密钥无对应设备已不可用）。
      secrets
        ?.delete(`${DEVICE_E2E_SECRET_PREFIX}${deviceId}`)
        .catch(() => undefined);
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
      return store.get().devices.map((device) => {
        const { relayPassHash: _internal, ...contractShape } = device;
        return {
          ...contractShape,
          capabilities: [...device.capabilities],
        };
      });
    },

    listRoster() {
      return store
        .get()
        .devices.filter(
          (device): device is StoredPairedDevice & { relayPassHash: string } =>
            device.relayPassHash !== undefined
        )
        .map((device) => ({
          deviceId: device.deviceId,
          relayPassHash: device.relayPassHash,
        }));
    },

    async deviceE2eKey(deviceId) {
      if (!secrets) {
        return null;
      }
      const stored = await secrets.get(
        `${DEVICE_E2E_SECRET_PREFIX}${deviceId}`
      );
      if (stored === null) {
        return null;
      }
      try {
        return fromBase64Url(stored);
      } catch {
        return null;
      }
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

    onEnroll(listener) {
      enrollListeners.add(listener);
      return () => {
        enrollListeners.delete(listener);
      };
    },

    onRevoke(listener) {
      revokeListeners.add(listener);
      return () => {
        revokeListeners.delete(listener);
      };
    },
  };
}
