import { isUtf8 } from "node:buffer";
import { createHash, type Hash } from "node:crypto";
import {
  type GitReviewFileStatus,
  gitReviewRelativePathSchema,
} from "../../../shared/contracts/git-review.ts";
import { GitReviewIndexProtocolError } from "./git-review-index-contract.ts";

const ASCII_SPACE = 0x20;
const GITLINK_MODE = "160000";

export class GitReviewRecordDigest {
  readonly #hash: Hash;
  #finished = false;

  constructor(domain: string) {
    this.#hash = createHash("sha256");
    this.update(Buffer.from(domain, "utf8"));
  }

  update(record: Buffer): void {
    if (this.#finished) {
      throw new GitReviewIndexProtocolError("不能更新已结束的索引摘要");
    }
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(record.length);
    this.#hash.update(length);
    this.#hash.update(record);
  }

  digest(): string {
    if (this.#finished) {
      throw new GitReviewIndexProtocolError("索引摘要不能重复结束");
    }
    this.#finished = true;
    return `sha256:${this.#hash.digest("hex")}`;
  }
}

export function splitFixedAsciiFields(
  record: Buffer,
  fieldCount: number,
  label: string
): { fields: readonly Buffer[]; remainder: Buffer } {
  const fields: Buffer[] = [];
  let start = 0;
  for (let index = 0; index < record.length; index += 1) {
    if (record[index] !== ASCII_SPACE) {
      continue;
    }
    if (index === start) {
      throw new GitReviewIndexProtocolError(`${label} 包含空 metadata 字段`);
    }
    fields.push(record.subarray(start, index));
    start = index + 1;
    if (fields.length === fieldCount) {
      const remainder = record.subarray(start);
      if (remainder.length === 0) {
        throw new GitReviewIndexProtocolError(`${label} 缺少路径字节`);
      }
      for (const field of fields) {
        assertAscii(field, label);
      }
      return { fields, remainder };
    }
  }
  throw new GitReviewIndexProtocolError(`${label} metadata 字段不完整`);
}

export function decodeGitReviewPath(bytes: Buffer): string | null {
  if (bytes.length === 0 || !isUtf8(bytes)) {
    return null;
  }
  const decoded = bytes.toString("utf8");
  const parsed = gitReviewRelativePathSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}

export function parseSafeCount(value: Buffer, label: string): number | null {
  assertAscii(value, label);
  if (value.length === 1 && value[0] === 0x2d) {
    return null;
  }
  if (value.length === 0) {
    throw new GitReviewIndexProtocolError(`${label} 缺少数字`);
  }
  let result = 0;
  for (const byte of value) {
    if (byte < 0x30 || byte > 0x39) {
      throw new GitReviewIndexProtocolError(`${label} 不是十进制计数`);
    }
    result = result * 10 + (byte - 0x30);
    if (!Number.isSafeInteger(result)) {
      throw new GitReviewIndexProtocolError(`${label} 超过安全整数上限`);
    }
  }
  return result;
}

export function assertAscii(value: Buffer, label: string): void {
  for (const byte of value) {
    if (byte > 0x7f) {
      throw new GitReviewIndexProtocolError(`${label} metadata 不是 ASCII`);
    }
  }
}

export function joinDigestProjection(parts: readonly Buffer[]): Buffer {
  const framed: Buffer[] = [];
  for (const part of parts) {
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(part.length);
    framed.push(length, part);
  }
  return Buffer.concat(framed);
}

export function gitReviewStatusFromCode(
  code: string,
  label: string
): GitReviewFileStatus | null {
  if (code === ".") {
    return null;
  }
  if (code === "A") {
    return "added";
  }
  if (code === "D") {
    return "deleted";
  }
  if (code === "M" || code === "T") {
    return "modified";
  }
  if (code === "R" || code === "C") {
    return "renamed";
  }
  throw new GitReviewIndexProtocolError(`${label} 状态码非法: ${code}`);
}

export function gitReviewStatsExpected(
  sourceMode: Buffer | string | undefined,
  targetMode: Buffer | string | undefined
): boolean {
  const source =
    typeof sourceMode === "string" ? sourceMode : sourceMode?.toString("ascii");
  const target =
    typeof targetMode === "string" ? targetMode : targetMode?.toString("ascii");
  return source !== GITLINK_MODE && target !== GITLINK_MODE;
}
