/**
 * M2 端到端密封与派生层（单一实现，宿主 main 与 mobile-web 共用）。
 * 文字权威：docs/superpowers/specs/2026-08-31-mobile-relay-server-design.md §6。
 *
 * - 只用平台标准原语（globalThis.crypto.subtle：HKDF-SHA256 / AES-256-GCM /
 *   P-256 ECDH），零运行时依赖、零自研密码学；
 * - 密钥派生链：deviceToken → e2eKey（长期认证根）/ relayPass（会合准入）；
 *   pairSecret → pairKey（赎回密封）；每管道 channelKey = HKDF(e2eKey ‖ ECDH)
 *   （PSK+ECDHE，前向保密）；
 * - 防重放：seq 入 GCM AAD，接收侧拒绝 ≤ 已见值；跨管道重放因 channelKey 不同失效。
 */
import type { RelaySealedFrame } from "../contracts/relay/index.ts";

const INFO_E2E = "pier-m2-e2e";
const INFO_PAIR = "pier-m2-pair";
const INFO_RELAY_PASS = "pier-m2-relay-pass";
const INFO_CHANNEL = "pier-m2-channel";
const AAD_PREFIX = "pier-m2:v1:";
const KEY_BITS = 256;
const IV_BYTES = 12;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    // biome-ignore lint/suspicious/noBitwiseOperators: base64 编码需要 6-bit 位拼接
    const chunk = ((bytes[i] ?? 0) << 16) | ((b ?? 0) << 8) | (c ?? 0);
    // biome-ignore lint/suspicious/noBitwiseOperators: base64 编码需要 6-bit 位拼接
    out += `${BASE64URL_ALPHABET[(chunk >> 18) & 63]}${BASE64URL_ALPHABET[(chunk >> 12) & 63]}`;
    if (b !== undefined) {
      // biome-ignore lint/suspicious/noBitwiseOperators: base64 编码需要 6-bit 位拼接
      out += BASE64URL_ALPHABET[(chunk >> 6) & 63];
    }
    if (c !== undefined) {
      // biome-ignore lint/suspicious/noBitwiseOperators: base64 编码需要 6-bit 位拼接
      out += BASE64URL_ALPHABET[chunk & 63];
    }
  }
  return out;
}

export function fromBase64Url(encoded: string): Uint8Array {
  const values = new Array<number>(encoded.length);
  for (let i = 0; i < encoded.length; i += 1) {
    const value = BASE64URL_ALPHABET.indexOf(encoded.charAt(i));
    if (value < 0) {
      throw new Error("invalid base64url input");
    }
    values[i] = value;
  }
  const out = new Uint8Array(Math.floor((encoded.length * 3) / 4));
  let outIndex = 0;
  for (let i = 0; i + 1 < values.length; i += 4) {
    const [a, b, c, d] = [
      values[i] ?? 0,
      values[i + 1] ?? 0,
      values[i + 2],
      values[i + 3],
    ];
    // biome-ignore lint/suspicious/noBitwiseOperators: base64 解码需要 6-bit 位重组
    out[outIndex] = (a << 2) | (b >> 4);
    outIndex += 1;
    if (c !== undefined) {
      // biome-ignore lint/suspicious/noBitwiseOperators: base64 解码需要 6-bit 位重组
      out[outIndex] = ((b & 15) << 4) | (c >> 2);
      outIndex += 1;
      if (d !== undefined) {
        // biome-ignore lint/suspicious/noBitwiseOperators: base64 解码需要 6-bit 位重组
        out[outIndex] = ((c & 3) << 6) | d;
        outIndex += 1;
      }
    }
  }
  return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    ikm as BufferSource,
    "HKDF",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      info: textEncoder.encode(info),
      salt: salt as BufferSource,
    },
    key,
    KEY_BITS
  );
  return new Uint8Array(bits);
}

/** 长期内容密钥（随 tokenEpoch 轮换）。 */
export function deriveE2eKey(args: {
  deviceToken: string;
  fingerprint: string;
}): Promise<Uint8Array> {
  return hkdf(
    textEncoder.encode(args.deviceToken),
    textEncoder.encode(args.fingerprint),
    INFO_E2E
  );
}

/** 赎回自举密钥（pairSecret 仅经 QR 带外传递）。 */
export function derivePairKey(args: {
  pairSecret: string;
  fingerprint: string;
}): Promise<Uint8Array> {
  return hkdf(
    textEncoder.encode(args.pairSecret),
    textEncoder.encode(args.fingerprint),
    INFO_PAIR
  );
}

/** 会合准入通行证（与 e2eKey 同根不同 info，互不可推；relay 只见其哈希）。 */
export async function deriveRelayPass(args: {
  deviceToken: string;
  fingerprint: string;
}): Promise<string> {
  const bytes = await hkdf(
    textEncoder.encode(args.deviceToken),
    textEncoder.encode(args.fingerprint),
    INFO_RELAY_PASS
  );
  return toBase64Url(bytes);
}

export interface EphemeralExchange {
  exchange(peerPublicKey: Uint8Array): Promise<Uint8Array>;
  publicKey: Uint8Array;
}

/** 每管道 P-256 临时密钥（前向保密来源；私钥不出函数作用域，用后即弃）。 */
export async function generateEphemeral(): Promise<EphemeralExchange> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  );
  const rawPublic = await crypto.subtle.exportKey("raw", pair.publicKey);
  return {
    publicKey: new Uint8Array(rawPublic),
    async exchange(peerPublicKey: Uint8Array): Promise<Uint8Array> {
      const peer = await crypto.subtle.importKey(
        "raw",
        peerPublicKey as BufferSource,
        { name: "ECDH", namedCurve: "P-256" },
        false,
        []
      );
      const bits = await crypto.subtle.deriveBits(
        { name: "ECDH", public: peer },
        pair.privateKey,
        KEY_BITS
      );
      return new Uint8Array(bits);
    },
  };
}

/** 管道密钥：PSK（e2eKey）+ ECDHE 混合；仅凭 e2eKey 重建不出（前向保密）。 */
export function deriveChannelKey(
  e2eKey: Uint8Array,
  ecdhSecret: Uint8Array,
  clientNonce: Uint8Array,
  hostNonce: Uint8Array
): Promise<Uint8Array> {
  return hkdf(
    concatBytes(e2eKey, ecdhSecret),
    concatBytes(clientNonce, hostNonce),
    INFO_CHANNEL
  );
}

async function importAesKey(key: Uint8Array): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"]
  );
}

function aadFor(seq: number): BufferSource {
  return textEncoder.encode(`${AAD_PREFIX}${seq}`) as BufferSource;
}

/** 密封一帧：seq 入 AAD；一次性密封（赎回）固定 seq=0。 */
export async function sealFrame(
  key: Uint8Array,
  seq: number,
  frameJson: string
): Promise<RelaySealedFrame> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const aesKey = await importAesKey(key);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aadFor(seq) },
    aesKey,
    textEncoder.encode(frameJson)
  );
  return {
    kind: "sealed",
    v: 1,
    seq,
    iv: toBase64Url(iv),
    ct: toBase64Url(new Uint8Array(ciphertext)),
  };
}

/**
 * 解封一帧：`sealed.seq` 必须大于 `lastSeq`（防重放），GCM 认证失败即抛。
 * 一次性解封（赎回）以 `lastSeq = -1` 调用。
 */
export async function unsealFrame(
  key: Uint8Array,
  sealed: RelaySealedFrame,
  lastSeq: number
): Promise<string> {
  if (sealed.v !== 1) {
    throw new Error("unsupported sealed frame version");
  }
  if (sealed.seq <= lastSeq) {
    throw new Error("replayed sealed frame rejected");
  }
  const aesKey = await importAesKey(key);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64Url(sealed.iv) as BufferSource,
      additionalData: aadFor(sealed.seq),
    },
    aesKey,
    fromBase64Url(sealed.ct) as BufferSource
  );
  return textDecoder.decode(plaintext);
}
