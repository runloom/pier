import type { GitReviewGroup } from "../../../shared/contracts/git-review.ts";
import {
  type GitReviewIndexGroupFact,
  type GitReviewIndexPrimaryEntry,
  type GitReviewIndexPrimaryParseResult,
  GitReviewIndexProtocolError,
} from "./git-review-index-contract.ts";
import {
  decodeGitReviewPath,
  GitReviewRecordDigest,
  gitReviewStatsExpected,
  gitReviewStatusFromCode,
  joinDigestProjection,
  splitFixedAsciiFields,
} from "./git-review-index-protocol.ts";

interface PendingPorcelainRename {
  readonly fields: readonly Buffer[];
  readonly path: Buffer;
  readonly record: Buffer;
}

type GitReviewIndexGroupFactDraft = Omit<GitReviewIndexGroupFact, "targetPath">;

export class GitReviewPorcelainV2Parser {
  readonly #digests = {
    conflict: new GitReviewRecordDigest("pier.git-review.status.conflict.v1"),
    staged: new GitReviewRecordDigest("pier.git-review.status.staged.v1"),
    unstaged: new GitReviewRecordDigest("pier.git-review.status.unstaged.v1"),
  };
  readonly #entries: GitReviewIndexPrimaryEntry[] = [];
  #finished = false;
  #invalidPathEntries = 0;
  #pending: PendingPorcelainRename | null = null;

  push(record: Buffer): "continue" | "stop" {
    this.#assertPushable();
    if (this.#pending !== null) {
      const pending = this.#pending;
      this.#pending = null;
      return this.#acceptPorcelainEntry(pending.fields, pending.path, record, [
        pending.record,
        record,
      ]);
    }
    const tag = record[0];
    if (tag === 0x31) {
      const parsed = splitFixedAsciiFields(record, 8, "porcelain v2 ordinary");
      return this.#acceptPorcelainEntry(parsed.fields, parsed.remainder, null, [
        record,
      ]);
    }
    if (tag === 0x32) {
      const parsed = splitFixedAsciiFields(record, 9, "porcelain v2 rename");
      this.#pending = {
        fields: parsed.fields,
        path: parsed.remainder,
        record: Buffer.from(record),
      };
      return "continue";
    }
    if (tag === 0x75) {
      const parsed = splitFixedAsciiFields(record, 10, "porcelain v2 conflict");
      return this.#acceptConflict(parsed.fields, parsed.remainder, record);
    }
    if (tag === 0x3f) {
      if (record[1] !== 0x20 || record.length <= 2) {
        throw new GitReviewIndexProtocolError(
          "porcelain v2 untracked 记录非法"
        );
      }
      return this.#acceptUntracked(record.subarray(2), record);
    }
    if (tag === 0x21 || tag === 0x23) {
      return "continue";
    }
    throw new GitReviewIndexProtocolError("porcelain v2 返回了未知记录类型");
  }

  finish(): GitReviewIndexPrimaryParseResult {
    if (this.#finished) {
      throw new GitReviewIndexProtocolError("porcelain parser 已结束");
    }
    if (this.#pending !== null) {
      throw new GitReviewIndexProtocolError("porcelain v2 rename 缺少旧路径");
    }
    this.#finished = true;
    return Object.freeze({
      digestByGroup: Object.freeze({
        conflict: this.#digests.conflict.digest(),
        staged: this.#digests.staged.digest(),
        unstaged: this.#digests.unstaged.digest(),
      }),
      entries: Object.freeze(this.#entries),
      invalidPathEntries: this.#invalidPathEntries,
    });
  }

  #acceptPorcelainEntry(
    fields: readonly Buffer[],
    pathBytes: Buffer,
    oldPathBytes: Buffer | null,
    records: readonly Buffer[]
  ): "continue" | "stop" {
    validatePorcelainFields(fields, oldPathBytes === null ? "1" : "2");
    const xy = fields[1]?.toString("ascii") ?? "";
    if (xy.length !== 2) {
      throw new GitReviewIndexProtocolError("porcelain v2 XY 字段非法");
    }
    const groupFacts: Partial<
      Record<GitReviewGroup, GitReviewIndexGroupFactDraft>
    > = {};
    const stagedStatus = gitReviewStatusFromCode(
      xy[0] ?? "",
      "porcelain staged"
    );
    const unstagedStatus = gitReviewStatusFromCode(
      xy[1] ?? "",
      "porcelain unstaged"
    );
    if (stagedStatus !== null) {
      groupFacts.staged = {
        movement: movementFromStatusCode(xy[0] ?? ""),
        oldPath: null,
        origin: "tracked",
        sourceOid: fields[6]?.toString("ascii") ?? null,
        statsExpected: gitReviewStatsExpected(fields[3], fields[4]),
        status: stagedStatus,
        targetOid: fields[7]?.toString("ascii") ?? null,
      };
    }
    if (unstagedStatus !== null) {
      groupFacts.unstaged = {
        movement: movementFromStatusCode(xy[1] ?? ""),
        oldPath: null,
        origin: "tracked",
        sourceOid: fields[7]?.toString("ascii") ?? null,
        statsExpected: gitReviewStatsExpected(fields[4], fields[5]),
        status: unstagedStatus,
        targetOid: null,
      };
    }
    if (Object.keys(groupFacts).length === 0) {
      throw new GitReviewIndexProtocolError("porcelain v2 文件记录没有变更组");
    }
    return this.#acceptLogical(
      pathBytes,
      oldPathBytes,
      groupFacts,
      records,
      fields
    );
  }

  #acceptConflict(
    fields: readonly Buffer[],
    pathBytes: Buffer,
    record: Buffer
  ): "continue" | "stop" {
    validatePorcelainFields(fields, "u");
    return this.#acceptLogical(
      pathBytes,
      null,
      {
        conflict: {
          movement: null,
          oldPath: null,
          origin: "conflict",
          sourceOid: null,
          statsExpected: false,
          status: "conflicted",
          targetOid: null,
        },
      },
      [record],
      fields
    );
  }

  #acceptUntracked(pathBytes: Buffer, record: Buffer): "continue" | "stop" {
    return this.#acceptLogical(
      pathBytes,
      null,
      {
        unstaged: {
          movement: null,
          oldPath: null,
          origin: "untracked",
          sourceOid: null,
          statsExpected: false,
          status: "added",
          targetOid: null,
        },
      },
      [record],
      null
    );
  }

  #acceptLogical(
    pathBytes: Buffer,
    oldPathBytes: Buffer | null,
    groupFacts: Partial<Record<GitReviewGroup, GitReviewIndexGroupFactDraft>>,
    records: readonly Buffer[],
    fields: readonly Buffer[] | null
  ): "continue" | "stop" {
    for (const group of Object.keys(groupFacts) as GitReviewGroup[]) {
      let digest = this.#digests.unstaged;
      if (group === "conflict") {
        digest = this.#digests.conflict;
      } else if (group === "staged") {
        digest = this.#digests.staged;
      }
      digest.update(
        createPorcelainGroupProjection(
          group,
          groupFacts[group],
          fields,
          pathBytes,
          oldPathBytes,
          records
        )
      );
    }
    const path = decodeGitReviewPath(pathBytes);
    const oldPath =
      oldPathBytes === null ? null : decodeGitReviewPath(oldPathBytes);
    if (path === null || (oldPathBytes !== null && oldPath === null)) {
      this.#invalidPathEntries += 1;
      return "continue";
    }
    const decodedFacts: Partial<
      Record<GitReviewGroup, GitReviewIndexGroupFact>
    > = {};
    for (const [group, fact] of Object.entries(groupFacts) as [
      GitReviewGroup,
      GitReviewIndexGroupFactDraft,
    ][]) {
      decodedFacts[group] = Object.freeze({
        ...fact,
        oldPath: fact.status === "renamed" ? oldPath : null,
        targetPath: path,
      });
    }
    this.#entries.push({ groupFacts: Object.freeze(decodedFacts), path });
    return "continue";
  }

  #assertPushable(): void {
    if (this.#finished) {
      throw new GitReviewIndexProtocolError(
        "不能继续使用已结束的 porcelain parser"
      );
    }
  }
}

function movementFromStatusCode(
  code: string
): GitReviewIndexGroupFact["movement"] {
  if (code === "R") {
    return "rename";
  }
  if (code === "C") {
    return "copy";
  }
  return null;
}

function validatePorcelainFields(
  fields: readonly Buffer[],
  tag: "1" | "2" | "u"
): void {
  const strings = fields.map((field) => field.toString("ascii"));
  if (strings[0] !== tag || strings[1]?.length !== 2) {
    throw new GitReviewIndexProtocolError(`porcelain v2 ${tag} 固定字段非法`);
  }
  if (!/^(?:N\.\.\.|S[C.][M.][U.])$/u.test(strings[2] ?? "")) {
    throw new GitReviewIndexProtocolError(`porcelain v2 ${tag} sub 字段非法`);
  }
  const modeFields = tag === "u" ? strings.slice(3, 7) : strings.slice(3, 6);
  if (modeFields.some((field) => !/^[0-7]{6}$/u.test(field))) {
    throw new GitReviewIndexProtocolError(`porcelain v2 ${tag} mode 字段非法`);
  }
  const oidFields = tag === "u" ? strings.slice(7, 10) : strings.slice(6, 8);
  if (
    oidFields.some((field) => !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(field))
  ) {
    throw new GitReviewIndexProtocolError(`porcelain v2 ${tag} OID 字段非法`);
  }
  const xy = strings[1] ?? "";
  if (tag === "u") {
    if (!/^(?:DD|AU|UD|UA|DU|AA|UU)$/u.test(xy)) {
      throw new GitReviewIndexProtocolError(
        "porcelain v2 conflict XY 字段非法"
      );
    }
    return;
  }
  if (!/^[.ACDMRT]{2}$/u.test(xy)) {
    throw new GitReviewIndexProtocolError(`porcelain v2 ${tag} XY 字段非法`);
  }
  if (tag === "2") {
    const score = strings[8] ?? "";
    const kind = score[0] ?? "";
    const numericScore = Number(score.slice(1));
    if (
      !(
        /^[RC]\d{1,3}$/u.test(score) &&
        xy.includes(kind) &&
        Number.isInteger(numericScore)
      ) ||
      numericScore > 100
    ) {
      throw new GitReviewIndexProtocolError(
        "porcelain v2 rename/copy score 字段非法"
      );
    }
  }
}

function createPorcelainGroupProjection(
  group: GitReviewGroup,
  fact: GitReviewIndexGroupFactDraft | undefined,
  fields: readonly Buffer[] | null,
  path: Buffer,
  oldPath: Buffer | null,
  records: readonly Buffer[]
): Buffer {
  if (fields === null || group === "conflict") {
    return joinDigestProjection(records);
  }
  const xy = fields[1] ?? Buffer.alloc(0);
  const common = [fields[0] ?? Buffer.alloc(0)];
  const projection =
    group === "staged"
      ? [
          ...common,
          xy.subarray(0, 1),
          fields[3] ?? Buffer.alloc(0),
          fields[4] ?? Buffer.alloc(0),
          fields[6] ?? Buffer.alloc(0),
          fields[7] ?? Buffer.alloc(0),
          ...(fields[8] === undefined ? [] : [fields[8]]),
          path,
        ]
      : [
          ...common,
          xy.subarray(1, 2),
          fields[4] ?? Buffer.alloc(0),
          fields[5] ?? Buffer.alloc(0),
          fields[7] ?? Buffer.alloc(0),
          path,
        ];
  if (fact?.status === "renamed" && oldPath !== null) {
    projection.push(oldPath);
  }
  return joinDigestProjection(projection);
}
