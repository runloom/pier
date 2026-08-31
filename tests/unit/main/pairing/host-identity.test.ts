// @vitest-environment node
/**
 * 宿主身份密钥（M2 Task 6，服务端设计 §4）：自证明 hostId、指纹同源派生、
 * 幂等加载、私钥丢失轮换；签名与 relay 侧 verifyUplinkHello 互验。
 */

import {
  ensureHostIdentity,
  fingerprintFromHostId,
  HOST_IDENTITY_SECRET_KEY,
} from "@main/services/pairing/host-identity.ts";
import type { PairingState, PairingStore } from "@main/state/pairing-store.ts";
import { describe, expect, it } from "vitest";
import { verifyUplinkHello } from "../../../../apps/relay/src/host-auth.ts";
import { makeFakeSecrets } from "./fake-secrets.ts";

function makeMemoryStore(initial: Partial<PairingState> = {}): PairingStore {
  let state: PairingState = {
    devices: [],
    instanceSecret: "legacy-secret",
    pendingPairing: null,
    ...initial,
  };
  return {
    async clear() {
      state = { devices: [], instanceSecret: "", pendingPairing: null };
    },
    async flush() {
      // 内存实现无落盘。
    },
    get: () => state,
    init: () => Promise.resolve(state),
    mutate(fn) {
      state = fn(state);
      return state;
    },
  };
}

describe("ensureHostIdentity", () => {
  it("首次生成：hostId=公钥 sha256、指纹=前 16 hex、公私钥分仓落位", async () => {
    const store = makeMemoryStore();
    const secrets = makeFakeSecrets();
    const identity = await ensureHostIdentity({ secrets, store });

    expect(identity.hostId).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.fingerprint).toBe(identity.hostId.slice(0, 16));
    expect(fingerprintFromHostId(identity.hostId)).toBe(identity.fingerprint);
    expect(store.get().hostKey?.publicKeyRaw).toBe(identity.publicKeyRaw);
    expect(secrets.dump().has(HOST_IDENTITY_SECRET_KEY)).toBe(true);
    // instanceSecret 退役：身份不再依赖它。
    expect(identity.fingerprint).not.toBe("legacy-secret");
  });

  it("幂等：二次加载得到同一身份，签名可被 relay 验签", async () => {
    const store = makeMemoryStore();
    const secrets = makeFakeSecrets();
    const first = await ensureHostIdentity({ secrets, store });
    const second = await ensureHostIdentity({ secrets, store });
    expect(second.hostId).toBe(first.hostId);

    const nonce = "relay-challenge-nonce";
    expect(
      verifyUplinkHello({
        hostId: second.hostId,
        hostPubKey: second.publicKeyRaw,
        signature: second.sign(nonce),
        challengeNonce: nonce,
      })
    ).toBe(true);
  });

  it("私钥丢失（钥匙串重置）→ 重生成新身份并回写公钥", async () => {
    const store = makeMemoryStore();
    const secrets = makeFakeSecrets();
    const first = await ensureHostIdentity({ secrets, store });
    await secrets.delete(HOST_IDENTITY_SECRET_KEY);

    const rotated = await ensureHostIdentity({ secrets, store });
    expect(rotated.hostId).not.toBe(first.hostId);
    expect(store.get().hostKey?.publicKeyRaw).toBe(rotated.publicKeyRaw);
    const nonce = "n2";
    expect(
      verifyUplinkHello({
        hostId: rotated.hostId,
        hostPubKey: rotated.publicKeyRaw,
        signature: rotated.sign(nonce),
        challengeNonce: nonce,
      })
    ).toBe(true);
  });
});
