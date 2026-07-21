import type { GitReviewTarget } from "../../../shared/contracts/git-review.ts";
import { type ExecGitRaw, GitExecRawError } from "../git-exec.ts";
import type { GitReviewObjectFormat } from "./git-review-identity-contract.ts";
import {
  type GitReviewIndexExecutionBudget,
  type GitReviewIndexGroupFact,
  GitReviewIndexInputError,
  type GitReviewIndexPrimaryParseResult,
  GitReviewIndexProtocolError,
} from "./git-review-index-contract.ts";
import {
  decodeGitReviewPath,
  GitReviewRecordDigest,
  gitReviewStatsExpected,
  gitReviewStatusFromCode,
} from "./git-review-index-protocol.ts";

const RANGE_RESOLUTION_MAX_OUTPUT_BYTES = 16 * 1024;

/** git 规范空树对象:根提交(无父)的 range diff 以它为 base。 */
const EMPTY_TREE_OID: Record<GitReviewObjectFormat, string> = {
  sha1: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
  sha256: "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321",
};

export interface GitReviewRangeBounds {
  /** range 起点 commit/tree OID(根提交时是空树)。 */
  readonly baseOid: string;
  readonly headOid: string;
}

interface RangeExecOptions {
  readonly budget: GitReviewIndexExecutionBudget;
  readonly signal: AbortSignal | undefined;
}

/**
 * 把 commit/branch 目标解析为不可变的 (base, head) OID 对:
 * - commit: base = 首父(根提交用空树), head = 该 commit
 * - branch: base = merge-base(ref, HEAD)(无共同祖先退化为 ref tip), head = HEAD
 */
export async function resolveGitReviewRangeBounds(
  execGitRaw: ExecGitRaw,
  options: {
    readonly cwd: string;
    readonly headOid: string | null;
    readonly objectFormat: GitReviewObjectFormat;
    readonly target: Exclude<GitReviewTarget, { kind: "uncommitted" }>;
  },
  control: RangeExecOptions
): Promise<GitReviewRangeBounds> {
  if (options.target.kind === "commit") {
    const headOid = await resolveCommitOid(
      execGitRaw,
      options.cwd,
      `${options.target.oid}^{commit}`,
      control
    );
    const baseOid =
      (await tryResolveCommitOid(
        execGitRaw,
        options.cwd,
        `${options.target.oid}^1`,
        control
      )) ?? EMPTY_TREE_OID[options.objectFormat];
    return Object.freeze({ baseOid, headOid });
  }
  if (options.headOid === null) {
    throw new GitReviewIndexInputError(
      "Git Review branch 目标需要仓库存在 HEAD 提交"
    );
  }
  const refTip = await resolveCommitOid(
    execGitRaw,
    options.cwd,
    `${options.target.ref}^{commit}`,
    control
  );
  const mergeBase = await tryCollectLine(
    execGitRaw,
    ["merge-base", refTip, options.headOid],
    options.cwd,
    control
  );
  return Object.freeze({
    baseOid: mergeBase ?? refTip,
    headOid: options.headOid,
  });
}

async function resolveCommitOid(
  execGitRaw: ExecGitRaw,
  cwd: string,
  revision: string,
  control: RangeExecOptions
): Promise<string> {
  const oid = await tryResolveCommitOid(execGitRaw, cwd, revision, control);
  if (oid === null) {
    throw new GitReviewIndexInputError(
      `Git Review 目标 revision 不存在: ${revision}`
    );
  }
  return oid;
}

async function tryResolveCommitOid(
  execGitRaw: ExecGitRaw,
  cwd: string,
  revision: string,
  control: RangeExecOptions
): Promise<string | null> {
  if (revision.startsWith("-")) {
    throw new GitReviewIndexInputError("Git Review 目标 revision 非法");
  }
  return tryCollectLine(
    execGitRaw,
    ["rev-parse", "--verify", "--quiet", revision],
    cwd,
    control
  );
}

async function tryCollectLine(
  execGitRaw: ExecGitRaw,
  args: readonly string[],
  cwd: string,
  control: RangeExecOptions
): Promise<string | null> {
  let result: Awaited<ReturnType<ExecGitRaw>>;
  try {
    result = await execGitRaw(args, {
      budget: control.budget,
      cwd,
      maxOutputBytes: RANGE_RESOLUTION_MAX_OUTPUT_BYTES,
      mode: "collect",
      ...(control.signal === undefined ? {} : { signal: control.signal }),
    });
  } catch (error) {
    if (
      error instanceof GitExecRawError &&
      error.causeKind === "exit" &&
      error.exitCode === 1
    ) {
      return null;
    }
    throw error;
  }
  if (result.kind !== "collected") {
    throw new GitReviewIndexProtocolError(
      "Git Review range 解析返回了非 collect 结果"
    );
  }
  const line = result.stdout.toString("ascii").trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(line)) {
    throw new GitReviewIndexProtocolError(
      "Git Review range 解析返回了非法 OID"
    );
  }
  return line;
}

/**
 * 解析 `git diff --raw --no-abbrev -z base head` 输出为 committed 分组的
 * primary parse result。记录序列:header → [oldPath(仅 R/C)] → targetPath。
 */
export class GitReviewCommittedRawParser {
  readonly #digest: GitReviewRecordDigest;
  readonly #entries: {
    groupFacts: { committed: GitReviewIndexGroupFact };
    path: string;
  }[] = [];
  #finished = false;
  #invalidPathEntries = 0;
  #pending: PendingCommittedRawEntry | null = null;

  constructor(bounds: GitReviewRangeBounds) {
    this.#digest = new GitReviewRecordDigest(
      "pier.git-review.committed-raw.v1"
    );
    this.#digest.update(
      Buffer.from(`${bounds.baseOid}..${bounds.headOid}`, "ascii")
    );
  }

  push(record: Buffer): "continue" | "stop" {
    if (this.#finished) {
      throw new GitReviewIndexProtocolError(
        "不能继续使用已结束的 committed raw parser"
      );
    }
    this.#digest.update(record);
    const pending = this.#pending;
    if (pending === null) {
      this.#pending = parseCommittedRawHeader(record);
      return "continue";
    }
    if (pending.movement !== null && pending.oldPath === undefined) {
      pending.oldPath = Buffer.from(record);
      return "continue";
    }
    this.#pending = null;
    this.#acceptEntry(pending, record);
    return "continue";
  }

  finish(): GitReviewIndexPrimaryParseResult {
    if (this.#finished) {
      throw new GitReviewIndexProtocolError("committed raw parser 已结束");
    }
    if (this.#pending !== null) {
      throw new GitReviewIndexProtocolError(
        "committed raw 在记录 tuple 中提前结束"
      );
    }
    this.#finished = true;
    return Object.freeze({
      digestByGroup: Object.freeze({
        committed: this.#digest.digest(),
      }),
      entries: Object.freeze(
        this.#entries.map((entry) =>
          Object.freeze({
            groupFacts: Object.freeze({ ...entry.groupFacts }),
            path: entry.path,
          })
        )
      ),
      invalidPathEntries: this.#invalidPathEntries,
    });
  }

  #acceptEntry(pending: PendingCommittedRawEntry, targetRecord: Buffer): void {
    const targetPath = decodeGitReviewPath(targetRecord);
    const oldPath =
      pending.oldPath === undefined
        ? null
        : decodeGitReviewPath(pending.oldPath);
    if (
      targetPath === null ||
      (pending.oldPath !== undefined && oldPath === null)
    ) {
      this.#invalidPathEntries += 1;
      return;
    }
    const status = gitReviewStatusFromCode(pending.statusCode, "committed raw");
    if (status === null) {
      throw new GitReviewIndexProtocolError("committed raw 状态码非法");
    }
    this.#entries.push({
      groupFacts: {
        committed: Object.freeze({
          movement: pending.movement,
          oldPath: status === "renamed" ? oldPath : null,
          origin: "tracked" as const,
          sourceOid: isZeroOid(pending.sourceOid) ? null : pending.sourceOid,
          statsExpected: gitReviewStatsExpected(
            pending.sourceMode,
            pending.targetMode
          ),
          status,
          targetOid: isZeroOid(pending.targetOid) ? null : pending.targetOid,
          targetPath,
        }),
      },
      path: targetPath,
    });
  }
}

interface PendingCommittedRawEntry {
  readonly movement: "copy" | "rename" | null;
  oldPath?: Buffer;
  readonly sourceMode: string;
  readonly sourceOid: string;
  readonly statusCode: string;
  readonly targetMode: string;
  readonly targetOid: string;
}

function parseCommittedRawHeader(record: Buffer): PendingCommittedRawEntry {
  const match =
    /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}|[0-9a-f]{64}) ([0-9a-f]{40}|[0-9a-f]{64}) ([ACDMRT])(\d{0,3})$/u.exec(
      record.toString("ascii")
    );
  const statusCode = match?.[5] ?? "";
  const score = match?.[6] ?? "";
  const moved = statusCode === "R" || statusCode === "C";
  if (
    match === null ||
    match[3]?.length !== match[4]?.length ||
    (moved && (!/^\d{1,3}$/u.test(score) || Number(score) > 100)) ||
    (!moved && score.length > 0)
  ) {
    throw new GitReviewIndexProtocolError("committed raw metadata 非法");
  }
  let movement: PendingCommittedRawEntry["movement"] = null;
  if (moved) {
    movement = statusCode === "C" ? "copy" : "rename";
  }
  return {
    movement,
    sourceMode: match[1] ?? "",
    sourceOid: match[3] ?? "",
    statusCode,
    targetMode: match[2] ?? "",
    targetOid: match[4] ?? "",
  };
}

function isZeroOid(oid: string): boolean {
  return /^0+$/u.test(oid);
}

/** 按 document 请求的 paths 过滤 full-range 读取结果(保持 rename 检测一致)。 */
export function filterCommittedPrimaryEntries(
  primary: GitReviewIndexPrimaryParseResult,
  paths: readonly string[]
): GitReviewIndexPrimaryParseResult {
  const requested = new Set(paths);
  return Object.freeze({
    digestByGroup: primary.digestByGroup,
    entries: Object.freeze(
      primary.entries.filter((entry) => {
        if (requested.has(entry.path)) {
          return true;
        }
        const oldPath = entry.groupFacts.committed?.oldPath;
        return oldPath !== null && oldPath !== undefined
          ? requested.has(oldPath)
          : false;
      })
    ),
    invalidPathEntries: primary.invalidPathEntries,
  });
}
