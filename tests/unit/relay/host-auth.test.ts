// @vitest-environment node
/** 宿主准入（服务端设计 §4/§5.1）：hostId 自证明 + Ed25519 挑战签名。 */

import { describe, expect, it } from "vitest";
import {
  hostIdFromRawPublicKey,
  verifyUplinkHello,
} from "../../../apps/relay/src/host-auth.ts";
import { makeHostIdentity } from "./helpers.ts";

describe("verifyUplinkHello", () => {
  const identity = makeHostIdentity();
  const nonce = "challenge-nonce-1";

  it("有效签名 + 匹配 hostId 通过", () => {
    expect(
      verifyUplinkHello({
        hostId: identity.hostId,
        hostPubKey: identity.hostPubKey,
        signature: identity.signNonce(nonce),
        challengeNonce: nonce,
      })
    ).toBe(true);
  });

  it("签名对不上挑战 nonce 拒绝（防重放旧签名）", () => {
    expect(
      verifyUplinkHello({
        hostId: identity.hostId,
        hostPubKey: identity.hostPubKey,
        signature: identity.signNonce("stale-nonce"),
        challengeNonce: nonce,
      })
    ).toBe(false);
  });

  it("hostId 与公钥哈希不符拒绝（抢注在数学上不可行）", () => {
    const other = makeHostIdentity();
    expect(
      verifyUplinkHello({
        hostId: other.hostId,
        hostPubKey: identity.hostPubKey,
        signature: identity.signNonce(nonce),
        challengeNonce: nonce,
      })
    ).toBe(false);
  });

  it("公钥长度非 32 字节或垃圾编码拒绝且不抛", () => {
    expect(
      verifyUplinkHello({
        hostId: identity.hostId,
        hostPubKey: "dG9vLXNob3J0",
        signature: identity.signNonce(nonce),
        challengeNonce: nonce,
      })
    ).toBe(false);
    expect(
      verifyUplinkHello({
        hostId: identity.hostId,
        hostPubKey: identity.hostPubKey,
        signature: "!!!not-base64url!!!",
        challengeNonce: nonce,
      })
    ).toBe(false);
  });

  it("hostIdFromRawPublicKey 是 sha256 hex（64 字符）", () => {
    expect(identity.hostId).toMatch(/^[0-9a-f]{64}$/);
    expect(
      hostIdFromRawPublicKey(Buffer.from(identity.hostPubKey, "base64url"))
    ).toBe(identity.hostId);
  });
});
