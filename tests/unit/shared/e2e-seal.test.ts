// @vitest-environment node
/**
 * M2 密封层（Task 2）：跨端 KAT 向量 + 密封往返 + 防重放 + 前向保密锁。
 * 向量由 node:crypto 独立实现计算（tests/fixtures/e2e-seal-vectors.json），
 * 被测实现走 WebCrypto（globalThis.crypto.subtle）——双实现交叉验证。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deriveChannelKey,
  deriveE2eKey,
  derivePairKey,
  deriveRelayPass,
  fromBase64Url,
  generateEphemeral,
  sealFrame,
  toBase64Url,
  unsealFrame,
} from "@shared/crypto/e2e-seal.ts";
import { describe, expect, it } from "vitest";

interface Vectors {
  channelKeyHex: string;
  clientNonceHex: string;
  deviceToken: string;
  e2eKeyHex: string;
  ecdhSecretHex: string;
  fingerprint: string;
  hostNonceHex: string;
  pairKeyHex: string;
  pairSecret: string;
  relayPass: string;
}

const vectors = JSON.parse(
  readFileSync(
    join(process.cwd(), "tests/fixtures/e2e-seal-vectors.json"),
    "utf8"
  )
) as Vectors;

function hexToBytes(hexString: string): Uint8Array {
  const out = new Uint8Array(hexString.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hexString.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("派生链 KAT（与 node:crypto 独立实现逐字节一致）", () => {
  it("deriveE2eKey / derivePairKey / deriveRelayPass 命中向量", async () => {
    const e2eKey = await deriveE2eKey({
      deviceToken: vectors.deviceToken,
      fingerprint: vectors.fingerprint,
    });
    expect(bytesToHex(e2eKey)).toBe(vectors.e2eKeyHex);

    const pairKey = await derivePairKey({
      pairSecret: vectors.pairSecret,
      fingerprint: vectors.fingerprint,
    });
    expect(bytesToHex(pairKey)).toBe(vectors.pairKeyHex);

    const relayPass = await deriveRelayPass({
      deviceToken: vectors.deviceToken,
      fingerprint: vectors.fingerprint,
    });
    expect(relayPass).toBe(vectors.relayPass);
  });

  it("deriveChannelKey 命中向量，且必须依赖 ECDH 秘密（前向保密锁）", async () => {
    const e2eKey = hexToBytes(vectors.e2eKeyHex);
    const clientNonce = hexToBytes(vectors.clientNonceHex);
    const hostNonce = hexToBytes(vectors.hostNonceHex);
    const channelKey = await deriveChannelKey(
      e2eKey,
      hexToBytes(vectors.ecdhSecretHex),
      clientNonce,
      hostNonce
    );
    expect(bytesToHex(channelKey)).toBe(vectors.channelKeyHex);

    const otherSecret = new Uint8Array(32).fill(0x43);
    const otherChannelKey = await deriveChannelKey(
      e2eKey,
      otherSecret,
      clientNonce,
      hostNonce
    );
    expect(bytesToHex(otherChannelKey)).not.toBe(vectors.channelKeyHex);
  });

  it("e2eKey 与 relayPass 同根不同 info，互不可推（值不同）", async () => {
    const relayPassBytes = fromBase64Url(vectors.relayPass);
    expect(bytesToHex(relayPassBytes)).not.toBe(vectors.e2eKeyHex);
  });
});

describe("P-256 ECDH 交换", () => {
  it("双方对彼此公钥派生出同一秘密", async () => {
    const a = await generateEphemeral();
    const b = await generateEphemeral();
    const secretA = await a.exchange(b.publicKey);
    const secretB = await b.exchange(a.publicKey);
    expect(bytesToHex(secretA)).toBe(bytesToHex(secretB));
    expect(secretA.length).toBe(32);
  });
});

describe("密封往返与防重放（服务端设计 §6）", () => {
  const key = hexToBytes(
    "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
  );

  it("seal → unseal round-trip；seq 单调前进", async () => {
    const sealed1 = await sealFrame(key, 1, '{"type":"command"}');
    expect(await unsealFrame(key, sealed1, 0)).toBe('{"type":"command"}');
    const sealed2 = await sealFrame(key, 2, '{"type":"response"}');
    expect(await unsealFrame(key, sealed2, 1)).toBe('{"type":"response"}');
  });

  it("重放（seq ≤ lastSeq）必抛", async () => {
    const sealed = await sealFrame(key, 5, "{}");
    await expect(unsealFrame(key, sealed, 5)).rejects.toThrow(/replayed/);
    await expect(unsealFrame(key, sealed, 9)).rejects.toThrow(/replayed/);
  });

  it("篡改 ct / iv / seq（AAD）必抛", async () => {
    const sealed = await sealFrame(key, 3, '{"secret":true}');
    await expect(
      unsealFrame(key, { ...sealed, ct: sealed.ct.slice(0, -2) }, 0)
    ).rejects.toThrow();
    await expect(
      unsealFrame(key, { ...sealed, iv: toBase64Url(new Uint8Array(12)) }, 0)
    ).rejects.toThrow();
    // seq 被改动 → AAD 不符 → GCM 认证失败（哪怕改小以后仍 > lastSeq）
    await expect(unsealFrame(key, { ...sealed, seq: 4 }, 0)).rejects.toThrow();
  });

  it("跨管道重放失效：channelKey 不同则解不开", async () => {
    const otherKey = hexToBytes(
      "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100"
    );
    const sealed = await sealFrame(key, 1, "{}");
    await expect(unsealFrame(otherKey, sealed, 0)).rejects.toThrow();
  });

  it("一次性密封（赎回）：seq 固定 0，lastSeq=-1 解封", async () => {
    const sealed = await sealFrame(key, 0, '{"code":"123456"}');
    expect(sealed.seq).toBe(0);
    expect(await unsealFrame(key, sealed, -1)).toBe('{"code":"123456"}');
  });
});

describe("base64url helpers", () => {
  it("round-trip 任意字节且拒绝非法字符", () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255, 66]);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    expect(() => fromBase64Url("not+valid/")).toThrow();
  });
});

describe("实现纪律：零依赖、仅平台原语", () => {
  it("e2e-seal.ts 只 import 契约类型，不 import node: 或第三方库", () => {
    const source = readFileSync(
      join(process.cwd(), "src/shared/crypto/e2e-seal.ts"),
      "utf8"
    );
    const imports = source.match(/^import .*$/gm) ?? [];
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain("../contracts/relay/index.ts");
    expect(source.includes("node:")).toBe(false);
    expect(source.includes("require(")).toBe(false);
  });
});
