/**
 * 宿主身份密钥（M2，服务端设计 §4）：Ed25519 密钥对，自证明 hostId。
 *
 * - hostId = sha256(32 字节原始公钥) hex；fingerprint = hostId 前 16 hex
 *   （同源派生，取代 M1 instanceSecret 指纹——后者就此退役，读旧档兼容）。
 * - 私钥 PKCS8 DER base64 存 secrets-store（safeStorage）；公钥原始字节
 *   base64url 存 pairing.json additive 字段 `hostKey`。
 * - 任一半缺失（新机 / 钥匙串重置）即重生成一对：令牌体系不受影响，
 *   仅 QR 指纹更新（M2 发布本就全量作废存量令牌，见计划 Task 11）。
 */
import {
  createHash,
  createPrivateKey,
  sign as edSign,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import type { PairingStore } from "@main/state/pairing-store.ts";
import type { SecretsStore } from "@main/state/secrets-store.ts";

export const HOST_IDENTITY_SECRET_KEY = "remote.host-identity.pkcs8";

export interface HostIdentity {
  fingerprint: string;
  hostId: string;
  /** base64url(32 字节原始 Ed25519 公钥)，uplink.hello 直接携带。 */
  publicKeyRaw: string;
  /** 对挑战 nonce 签名，返回 base64url。 */
  sign(data: string): string;
}

export function hostIdFromRawPublicKey(rawPublicKey: Buffer): string {
  return createHash("sha256").update(rawPublicKey).digest("hex");
}

export function fingerprintFromHostId(hostId: string): string {
  return hostId.slice(0, 16);
}

function buildIdentity(
  rawPublicKey: Buffer,
  privateKey: KeyObject
): HostIdentity {
  const hostId = hostIdFromRawPublicKey(rawPublicKey);
  return {
    hostId,
    fingerprint: fingerprintFromHostId(hostId),
    publicKeyRaw: rawPublicKey.toString("base64url"),
    sign: (data) =>
      edSign(null, Buffer.from(data, "utf8"), privateKey).toString("base64url"),
  };
}

/**
 * 加载或生成宿主身份；幂等（同一 store/secrets 状态恒得同一身份）。
 * 调用方（pairing service ensureReady）负责保证 store 已 init。
 */
export async function ensureHostIdentity(args: {
  store: PairingStore;
  secrets: SecretsStore;
}): Promise<HostIdentity> {
  const existingPublic = args.store.get().hostKey?.publicKeyRaw ?? null;
  const existingPrivate = await args.secrets.get(HOST_IDENTITY_SECRET_KEY);
  if (existingPublic !== null && existingPrivate !== null) {
    try {
      const privateKey = createPrivateKey({
        key: Buffer.from(existingPrivate, "base64"),
        format: "der",
        type: "pkcs8",
      });
      return buildIdentity(
        Buffer.from(existingPublic, "base64url"),
        privateKey
      );
    } catch {
      // 私钥损坏（钥匙串重置等）：走重生成分支。
    }
  }

  const pair = generateKeyPairSync("ed25519");
  const spki = pair.publicKey.export({ format: "der", type: "spki" });
  const rawPublicKey = Buffer.from(spki).subarray(-32);
  const pkcs8 = pair.privateKey.export({ format: "der", type: "pkcs8" });
  await args.secrets.set(
    HOST_IDENTITY_SECRET_KEY,
    Buffer.from(pkcs8).toString("base64")
  );
  args.store.mutate((current) => ({
    ...current,
    hostKey: { publicKeyRaw: rawPublicKey.toString("base64url") },
  }));
  return buildIdentity(rawPublicKey, pair.privateKey);
}
