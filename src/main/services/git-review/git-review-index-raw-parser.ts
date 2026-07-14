import type { GitReviewFileStatus } from "../../../shared/contracts/git-review.ts";
import {
  GIT_REVIEW_INDEX_ENTRY_LIMIT,
  type GitReviewIndexPrimaryEntry,
  type GitReviewIndexPrimaryParseResult,
  GitReviewIndexProtocolError,
} from "./git-review-index-contract.ts";
import {
  assertAscii,
  decodeGitReviewPath,
  GitReviewRecordDigest,
  gitReviewStatsExpected,
  gitReviewStatusFromCode,
} from "./git-review-index-protocol.ts";

interface PendingRaw {
  readonly header: Buffer;
  oldPath: Buffer | null;
  readonly sourceMode: string;
  readonly status: GitReviewFileStatus;
  readonly statusCode: string;
  readonly targetMode: string;
}

export class GitReviewRawDiffParser {
  readonly #digest: GitReviewRecordDigest;
  readonly #entries: GitReviewIndexPrimaryEntry[] = [];
  readonly #group: "commit" | "branch";
  #finished = false;
  #invalidPathEntries = 0;
  #logicalEntries = 0;
  #pending: PendingRaw | null = null;
  #truncated = false;

  constructor(group: "commit" | "branch") {
    this.#group = group;
    this.#digest = new GitReviewRecordDigest(`pier.git-review.raw.${group}.v1`);
  }

  push(record: Buffer): "continue" | "stop" {
    this.#assertPushable();
    if (this.#pending === null) {
      this.#pending = parseRawHeader(record);
      return "continue";
    }
    if (
      (this.#pending.statusCode === "R" || this.#pending.statusCode === "C") &&
      this.#pending.oldPath === null
    ) {
      this.#pending.oldPath = Buffer.from(record);
      return "continue";
    }
    const pending = this.#pending;
    this.#pending = null;
    return this.#acceptRaw(pending, record);
  }

  finish(): GitReviewIndexPrimaryParseResult {
    if (this.#finished) {
      throw new GitReviewIndexProtocolError("raw parser 已结束");
    }
    if (this.#pending !== null) {
      throw new GitReviewIndexProtocolError("raw diff 在路径 tuple 中提前结束");
    }
    this.#finished = true;
    return Object.freeze({
      digestByGroup: Object.freeze({ [this.#group]: this.#digest.digest() }),
      entries: Object.freeze(this.#entries),
      indexDigest: null,
      invalidPathEntries: this.#invalidPathEntries,
      truncated: this.#truncated,
    });
  }

  #acceptRaw(pending: PendingRaw, pathBytes: Buffer): "continue" | "stop" {
    this.#logicalEntries += 1;
    if (this.#logicalEntries > GIT_REVIEW_INDEX_ENTRY_LIMIT) {
      this.#truncated = true;
      return "stop";
    }
    this.#digest.update(pending.header);
    if (pending.oldPath !== null) {
      this.#digest.update(pending.oldPath);
    }
    this.#digest.update(pathBytes);
    const path = decodeGitReviewPath(pathBytes);
    const oldPath =
      pending.oldPath === null ? null : decodeGitReviewPath(pending.oldPath);
    if (path === null || (pending.oldPath !== null && oldPath === null)) {
      this.#invalidPathEntries += 1;
      return "continue";
    }
    this.#entries.push({
      groupFacts: Object.freeze({
        [this.#group]: Object.freeze({
          movement: movementFromStatusCode(pending.statusCode),
          oldPath,
          origin: "tracked",
          statsExpected: gitReviewStatsExpected(
            pending.sourceMode,
            pending.targetMode
          ),
          status: pending.status,
          targetPath: path,
        }),
      }),
      path,
    });
    return "continue";
  }

  #assertPushable(): void {
    if (this.#finished || this.#truncated) {
      throw new GitReviewIndexProtocolError("不能继续使用已结束的 raw parser");
    }
  }
}

function movementFromStatusCode(statusCode: string): "copy" | "rename" | null {
  if (statusCode === "R") {
    return "rename";
  }
  if (statusCode === "C") {
    return "copy";
  }
  return null;
}

function parseRawHeader(record: Buffer): PendingRaw {
  assertAscii(record, "raw diff");
  const match =
    /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-9a-f]{40}|[0-9a-f]{64}) ([ACDMRT])([0-9]*)$/u.exec(
      record.toString("ascii")
    );
  if (match === null) {
    throw new GitReviewIndexProtocolError("raw diff metadata 记录非法");
  }
  const statusCode = match[5] ?? "";
  const score = match[6] ?? "";
  const numericScore = score.length === 0 ? null : Number(score);
  if (
    ((statusCode === "R" || statusCode === "C") &&
      (!(/^\d{1,3}$/u.test(score) && Number.isInteger(numericScore)) ||
        (numericScore ?? 101) > 100)) ||
    (statusCode !== "R" && statusCode !== "C" && score.length > 0)
  ) {
    throw new GitReviewIndexProtocolError("raw diff rename/copy score 非法");
  }
  if ((match[3]?.length ?? 0) !== (match[4]?.length ?? 0)) {
    throw new GitReviewIndexProtocolError("raw diff OID 长度不一致");
  }
  return {
    header: Buffer.from(record),
    oldPath: null,
    sourceMode: match[1] ?? "",
    status: gitReviewStatusFromCode(statusCode, "raw diff") ?? "modified",
    statusCode,
    targetMode: match[2] ?? "",
  };
}
