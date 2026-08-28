/**
 * 配对 QR 载荷：编码/解码移动端扫码连入所需的自描述 JSON。
 * schema 单一来源在 contracts/remote.ts（规格 §17.2），此处仅存编解码助手。
 */

import {
  type PairingQrPayload,
  pairingQrPayloadSchema,
} from "@shared/contracts/remote.ts";

export function buildPairingQrPayload(args: {
  code: string;
  fingerprint: string;
  host: string;
  port: number;
}): string {
  const payload: PairingQrPayload = {
    fingerprint: args.fingerprint,
    host: args.host,
    pairingCode: args.code,
    port: args.port,
    relayHint: null,
  };
  return JSON.stringify(payload);
}

/** 解析扫码结果；非 JSON 或形状不合法一律返回 null（调用侧按无效码处理）。 */
export function parsePairingQrPayload(raw: string): PairingQrPayload | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = pairingQrPayloadSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
