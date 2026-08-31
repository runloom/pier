/**
 * 宿主准入：Ed25519 挑战签名 + hostId 自证明（服务端设计 §4/§5.1）。
 * hostPubKey = base64url(32 字节原始公钥)；hostId = sha256(原始公钥) hex；
 * signature = base64url(Ed25519 签名 over utf8(challenge nonce))。
 */
import { createHash, createPublicKey, verify as edVerify } from "node:crypto";

/** Ed25519 SPKI DER 前缀（RFC 8410）：包裹 32 字节原始公钥。 */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const ED25519_RAW_PUBLIC_KEY_BYTES = 32;

export function hostIdFromRawPublicKey(rawPublicKey: Buffer): string {
  return createHash("sha256").update(rawPublicKey).digest("hex");
}

export function verifyUplinkHello(args: {
  hostId: string;
  hostPubKey: string;
  signature: string;
  challengeNonce: string;
}): boolean {
  let rawPublicKey: Buffer;
  let signature: Buffer;
  try {
    rawPublicKey = Buffer.from(args.hostPubKey, "base64url");
    signature = Buffer.from(args.signature, "base64url");
  } catch {
    return false;
  }
  if (rawPublicKey.length !== ED25519_RAW_PUBLIC_KEY_BYTES) {
    return false;
  }
  if (hostIdFromRawPublicKey(rawPublicKey) !== args.hostId) {
    return false;
  }
  try {
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, rawPublicKey]),
      format: "der",
      type: "spki",
    });
    return edVerify(
      null,
      Buffer.from(args.challengeNonce, "utf8"),
      publicKey,
      signature
    );
  } catch {
    return false;
  }
}
