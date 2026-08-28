/**
 * 配对原语：一次性配对码、设备令牌与哈希派生（纯函数，无状态）。
 *
 * 配对码 6 位数字（crypto 随机，允许前导零）；设备令牌 32 字节
 * base64url（43 字符），原文只在签发瞬间出内存，持久化只存 sha256 哈希。
 */

import { createHash, randomBytes, randomInt } from "node:crypto";

/** 6 位数字配对码（000000–999999 均匀分布，保留前导零）。 */
export function generatePairingCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** 32 字节随机设备令牌，base64url 编码（43 字符）。 */
export function generateDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** 宿主实例指纹：instanceSecret 的 sha256 前 16 hex，随 QR 公开。 */
export function fingerprintFromSecret(secret: string): string {
  return sha256Hex(secret).slice(0, 16);
}
