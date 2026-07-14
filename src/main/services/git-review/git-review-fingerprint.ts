import { createHmac, randomBytes } from "node:crypto";

const GIT_REVIEW_FINGERPRINT_DOMAIN = "pier.git-review.source.v1";
const GIT_REVIEW_FINGERPRINT_KEY_BYTES = 32;

export interface GitReviewFingerprinter {
  fingerprint(parts: readonly string[]): string;
}

function updateFramedPart(
  hmac: ReturnType<typeof createHmac>,
  part: string
): void {
  const bytes = Buffer.from(part, "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.byteLength);
  hmac.update(length);
  hmac.update(bytes);
}

/**
 * 为单个进程创建独立的 source 指纹器。
 *
 * key 只存在于闭包内；调用方只能取得 HMAC 结果，不能取得或持久化 key。
 * 分段使用长度前缀编码，避免不同字段拼接成同一字节序列。
 */
export function createGitReviewFingerprinter(): GitReviewFingerprinter {
  const key = randomBytes(GIT_REVIEW_FINGERPRINT_KEY_BYTES);
  return Object.freeze({
    fingerprint(parts: readonly string[]): string {
      const hmac = createHmac("sha256", key);
      updateFramedPart(hmac, GIT_REVIEW_FINGERPRINT_DOMAIN);
      for (const part of parts) {
        updateFramedPart(hmac, part);
      }
      return `hmac-sha256:${hmac.digest("base64url")}`;
    },
  });
}

const processGitReviewFingerprinter = createGitReviewFingerprinter();

/** 使用本进程随机 key 生成不可跨进程关联的 source 摘要。 */
export function fingerprintGitReviewSource(parts: readonly string[]): string {
  return processGitReviewFingerprinter.fingerprint(parts);
}
