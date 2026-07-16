import type { GitReviewGroup } from "../../../shared/contracts/git-review.ts";
import {
  type GitReviewIndexGroupFact,
  type GitReviewIndexPrimaryParseResult,
  GitReviewIndexProtocolError,
} from "./git-review-index-contract.ts";
import {
  decodeGitReviewPath,
  GitReviewRecordDigest,
  gitReviewStatsExpected,
} from "./git-review-index-protocol.ts";

interface GitReviewScopedMovement {
  readonly movement: "copy" | "rename";
  readonly oldPath: string;
  readonly sourceMode: string;
  readonly sourceOid: string;
  readonly targetMode: string;
  readonly targetOid: string;
  readonly targetPath: string;
}

interface GitReviewScopedMovementParseResult {
  readonly digest: string;
  readonly invalidPathEntries: number;
  readonly movements: readonly GitReviewScopedMovement[];
}

export function mergeScopedPrimaryReads(
  reads: readonly GitReviewIndexPrimaryParseResult[]
): GitReviewIndexPrimaryParseResult {
  const entries = new Map<
    string,
    {
      groupFacts: Partial<Record<GitReviewGroup, GitReviewIndexGroupFact>>;
      path: string;
    }
  >();
  for (const read of reads) {
    for (const entry of read.entries) {
      const existing = entries.get(entry.path);
      if (existing === undefined) {
        entries.set(entry.path, {
          groupFacts: { ...entry.groupFacts },
          path: entry.path,
        });
        continue;
      }
      for (const group of ["conflict", "staged", "unstaged"] as const) {
        const fact = entry.groupFacts[group];
        if (fact === undefined) {
          continue;
        }
        const prior = existing.groupFacts[group];
        if (prior !== undefined && !sameGitReviewGroupFact(prior, fact)) {
          throw new GitReviewIndexProtocolError(
            `Git Review 精确路径返回了冲突的 ${group} 事实`
          );
        }
        existing.groupFacts[group] = fact;
      }
    }
  }
  return Object.freeze({
    digestByGroup: Object.freeze({
      conflict: combineGitReviewDigests(
        "pier.git-review.scoped.conflict.v1",
        reads.map((read) => read.digestByGroup.conflict ?? "")
      ),
      staged: combineGitReviewDigests(
        "pier.git-review.scoped.staged.v1",
        reads.map((read) => read.digestByGroup.staged ?? "")
      ),
      unstaged: combineGitReviewDigests(
        "pier.git-review.scoped.unstaged.v1",
        reads.map((read) => read.digestByGroup.unstaged ?? "")
      ),
    }),
    entries: Object.freeze(
      [...entries.values()].map((entry) =>
        Object.freeze({
          groupFacts: Object.freeze({ ...entry.groupFacts }),
          path: entry.path,
        })
      )
    ),
    invalidPathEntries: reads.reduce(
      (total, read) => total + read.invalidPathEntries,
      0
    ),
  });
}

export function applyScopedMovements(
  primary: GitReviewIndexPrimaryParseResult,
  group: "staged" | "unstaged",
  parsed: GitReviewScopedMovementParseResult,
  requestedPaths: readonly string[]
): GitReviewIndexPrimaryParseResult {
  const requested = new Set(requestedPaths);
  const entries = new Map(
    primary.entries.map((entry) => [
      entry.path,
      {
        groupFacts: { ...entry.groupFacts },
        path: entry.path,
      },
    ])
  );
  const acceptedTargets = new Set<string>();
  for (const movement of parsed.movements) {
    if (
      !(requested.has(movement.oldPath) && requested.has(movement.targetPath))
    ) {
      continue;
    }
    if (acceptedTargets.has(movement.targetPath)) {
      throw new GitReviewIndexProtocolError(
        `Git Review 精确路径返回了重复的 ${group} movement`
      );
    }
    const target = entries.get(movement.targetPath);
    if (target?.groupFacts[group] === undefined) {
      throw new GitReviewIndexProtocolError(
        `Git Review ${group} movement 缺少目标路径事实`
      );
    }
    acceptedTargets.add(movement.targetPath);
    target.groupFacts[group] = Object.freeze({
      movement: movement.movement,
      oldPath: movement.oldPath,
      origin: "tracked",
      sourceOid: isZeroGitOid(movement.sourceOid) ? null : movement.sourceOid,
      statsExpected: gitReviewStatsExpected(
        movement.sourceMode,
        movement.targetMode
      ),
      status: "renamed",
      targetOid:
        group === "staged" && !isZeroGitOid(movement.targetOid)
          ? movement.targetOid
          : null,
      targetPath: movement.targetPath,
    });
    if (movement.movement !== "rename") {
      continue;
    }
    const source = entries.get(movement.oldPath);
    if (source?.groupFacts[group]?.status !== "deleted") {
      continue;
    }
    delete source.groupFacts[group];
    if (Object.keys(source.groupFacts).length === 0) {
      entries.delete(source.path);
    }
  }
  return Object.freeze({
    digestByGroup: Object.freeze({
      ...primary.digestByGroup,
      [group]: combineGitReviewDigests(
        `pier.git-review.scoped-movement.${group}.v1`,
        [primary.digestByGroup[group] ?? "", parsed.digest]
      ),
    }),
    entries: Object.freeze(
      [...entries.values()].map((entry) =>
        Object.freeze({
          groupFacts: Object.freeze({ ...entry.groupFacts }),
          path: entry.path,
        })
      )
    ),
    invalidPathEntries: primary.invalidPathEntries + parsed.invalidPathEntries,
  });
}

export class GitReviewScopedMovementParser {
  readonly #digest: GitReviewRecordDigest;
  readonly #movements: GitReviewScopedMovement[] = [];
  #finished = false;
  #invalidPathEntries = 0;
  #pending: PendingGitReviewScopedMovement | null = null;

  constructor(group: "staged" | "unstaged") {
    this.#digest = new GitReviewRecordDigest(
      `pier.git-review.scoped-movement-raw.${group}.v1`
    );
  }

  push(record: Buffer): "continue" | "stop" {
    if (this.#finished) {
      throw new GitReviewIndexProtocolError(
        "不能继续使用已结束的 movement parser"
      );
    }
    const pending = this.#pending;
    if (pending === null) {
      this.#pending = parseGitReviewMovementHeader(record);
      this.#digest.update(record);
      return "continue";
    }
    if (pending.oldPath === undefined) {
      pending.oldPath = Buffer.from(record);
      this.#digest.update(record);
      return "continue";
    }
    this.#digest.update(record);
    const oldPath = decodeGitReviewPath(pending.oldPath);
    const targetPath = decodeGitReviewPath(record);
    if (oldPath === null || targetPath === null) {
      this.#invalidPathEntries += 1;
    } else {
      this.#movements.push(
        Object.freeze({
          movement: pending.movement,
          oldPath,
          sourceMode: pending.sourceMode,
          sourceOid: pending.sourceOid,
          targetMode: pending.targetMode,
          targetOid: pending.targetOid,
          targetPath,
        })
      );
    }
    this.#pending = null;
    return "continue";
  }

  finish(): GitReviewScopedMovementParseResult {
    if (this.#finished) {
      throw new GitReviewIndexProtocolError("movement parser 已结束");
    }
    if (this.#pending !== null) {
      throw new GitReviewIndexProtocolError(
        "movement raw 在 rename/copy tuple 中提前结束"
      );
    }
    this.#finished = true;
    return Object.freeze({
      digest: this.#digest.digest(),
      invalidPathEntries: this.#invalidPathEntries,
      movements: Object.freeze(this.#movements),
    });
  }
}

interface PendingGitReviewScopedMovement {
  readonly movement: "copy" | "rename";
  oldPath?: Buffer;
  readonly sourceMode: string;
  readonly sourceOid: string;
  readonly targetMode: string;
  readonly targetOid: string;
}

function parseGitReviewMovementHeader(
  record: Buffer
): PendingGitReviewScopedMovement {
  const match =
    /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-9a-f]{40}|[0-9a-f]{64}) ([RC])(\d{1,3})$/u.exec(
      record.toString("ascii")
    );
  const score = Number(match?.[6] ?? 101);
  if (
    match === null ||
    match[3]?.length !== match[4]?.length ||
    !Number.isSafeInteger(score) ||
    score < 0 ||
    score > 100
  ) {
    throw new GitReviewIndexProtocolError(
      "Git Review movement raw metadata 非法"
    );
  }
  return {
    movement: match[5] === "C" ? "copy" : "rename",
    sourceMode: match[1] ?? "",
    sourceOid: match[3] ?? "",
    targetMode: match[2] ?? "",
    targetOid: match[4] ?? "",
  };
}

function sameGitReviewGroupFact(
  left: GitReviewIndexGroupFact,
  right: GitReviewIndexGroupFact
): boolean {
  return (
    left.movement === right.movement &&
    left.oldPath === right.oldPath &&
    left.origin === right.origin &&
    left.sourceOid === right.sourceOid &&
    left.statsExpected === right.statsExpected &&
    left.status === right.status &&
    left.targetOid === right.targetOid &&
    left.targetPath === right.targetPath
  );
}

function combineGitReviewDigests(
  domain: string,
  digests: readonly string[]
): string {
  const digest = new GitReviewRecordDigest(domain);
  for (const value of digests) {
    digest.update(Buffer.from(value, "ascii"));
  }
  return digest.digest();
}

function isZeroGitOid(oid: string): boolean {
  return /^0+$/u.test(oid);
}
