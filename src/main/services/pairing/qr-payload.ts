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
  host?: string;
  port?: number;
  /** M2：宿主身份 id（公钥哈希），会合路由用。 */
  hostId?: string;
  /** M2：高熵配对密钥（仅 QR 带外传递），赎回密封用。 */
  pairSecret?: string;
  /** M2：会合 wss 基址；未配置恒 null。 */
  relayHint?: string | null;
}): string {
  const payload: PairingQrPayload = {
    fingerprint: args.fingerprint,
    pairingCode: args.code,
    relayHint: args.relayHint ?? null,
    ...(args.host === undefined ? {} : { host: args.host }),
    ...(args.port === undefined ? {} : { port: args.port }),
    ...(args.hostId === undefined ? {} : { hostId: args.hostId }),
    ...(args.pairSecret === undefined ? {} : { pairSecret: args.pairSecret }),
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
