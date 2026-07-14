import {
  GIT_REVIEW_INDEX_ENTRY_LIMIT,
  GitReviewIndexProtocolError,
  type GitReviewIndexStatEntry,
  type GitReviewIndexStatParseResult,
} from "./git-review-index-contract.ts";
import {
  decodeGitReviewPath,
  GitReviewRecordDigest,
  parseSafeCount,
} from "./git-review-index-protocol.ts";

interface PendingNumstat {
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly header: Buffer;
  oldPath: Buffer | null;
}

export class GitReviewNumstatParser {
  readonly #digest: GitReviewRecordDigest;
  readonly #entries: GitReviewIndexStatEntry[] = [];
  #finished = false;
  #logicalEntries = 0;
  #pending: PendingNumstat | null = null;
  #truncated = false;

  constructor(channel: string) {
    this.#digest = new GitReviewRecordDigest(
      `pier.git-review.numstat.${channel}.v1`
    );
  }

  push(record: Buffer): "continue" | "stop" {
    this.#assertPushable();
    if (this.#pending !== null) {
      if (this.#pending.oldPath === null) {
        this.#pending.oldPath = Buffer.from(record);
        return "continue";
      }
      const pending = this.#pending;
      this.#pending = null;
      const oldPath = pending.oldPath;
      if (oldPath === null) {
        throw new GitReviewIndexProtocolError("numstat rename/copy 缺少旧路径");
      }
      return this.#accept(
        pending.additions,
        pending.deletions,
        oldPath,
        record,
        [pending.header, oldPath, record]
      );
    }

    const firstTab = record.indexOf(0x09);
    const secondTab = firstTab < 0 ? -1 : record.indexOf(0x09, firstTab + 1);
    if (firstTab <= 0 || secondTab <= firstTab + 1) {
      throw new GitReviewIndexProtocolError("numstat 记录缺少计数字段");
    }
    const additions = parseSafeCount(
      record.subarray(0, firstTab),
      "numstat additions"
    );
    const deletions = parseSafeCount(
      record.subarray(firstTab + 1, secondTab),
      "numstat deletions"
    );
    if ((additions === null) !== (deletions === null)) {
      throw new GitReviewIndexProtocolError(
        "numstat binary 计数必须同时为 '-'"
      );
    }
    const path = record.subarray(secondTab + 1);
    if (path.length === 0) {
      this.#pending = {
        additions,
        deletions,
        header: Buffer.from(record),
        oldPath: null,
      };
      return "continue";
    }
    return this.#accept(additions, deletions, null, path, [record]);
  }

  finish(): GitReviewIndexStatParseResult {
    if (this.#finished) {
      throw new GitReviewIndexProtocolError("numstat parser 已结束");
    }
    if (this.#pending !== null) {
      throw new GitReviewIndexProtocolError(
        "numstat 在 rename/copy tuple 中提前结束"
      );
    }
    this.#finished = true;
    return Object.freeze({
      digest: this.#digest.digest(),
      entries: Object.freeze(this.#entries),
      truncated: this.#truncated,
    });
  }

  #accept(
    additions: number | null,
    deletions: number | null,
    oldPathBytes: Buffer | null,
    pathBytes: Buffer,
    records: readonly Buffer[]
  ): "continue" | "stop" {
    this.#logicalEntries += 1;
    if (this.#logicalEntries > GIT_REVIEW_INDEX_ENTRY_LIMIT) {
      this.#truncated = true;
      return "stop";
    }
    for (const record of records) {
      this.#digest.update(record);
    }
    const path = decodeGitReviewPath(pathBytes);
    const oldPath =
      oldPathBytes === null ? null : decodeGitReviewPath(oldPathBytes);
    if (path !== null && (oldPathBytes === null || oldPath !== null)) {
      this.#entries.push({ additions, deletions, oldPath, path });
    }
    return "continue";
  }

  #assertPushable(): void {
    if (this.#finished || this.#truncated) {
      throw new GitReviewIndexProtocolError(
        "不能继续使用已结束的 numstat parser"
      );
    }
  }
}
