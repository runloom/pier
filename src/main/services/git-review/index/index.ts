import {
  type GitReviewFailure,
  type GitReviewGroup,
  type GitReviewIndexResult,
  type GitReviewScope,
  type GitReviewTarget,
  gitReviewFailureSchema,
  gitReviewIndexOkSchema,
  gitReviewRelativePathSchema,
  gitReviewRootPathSchema,
  gitReviewScopeSchema,
} from "../../../../shared/contracts/git/review.ts";
import { readGitUntrackedPathStats } from "../../git/change-summary.ts";
import { type ExecGitRaw, execGitRaw } from "../../git/exec.ts";
import {
  GitReviewIdentityResolver,
  type GitReviewRepositoryIdentity,
} from "../identity.ts";
import {
  createGitReviewExactPathspecs,
  hasGitReviewExactPathspecConflict,
} from "../path/spec.ts";
import {
  type AssembledGitReviewIndex,
  assembleGitReviewIndex,
  type GitReviewIndexResolvedEntry,
} from "./assembler.ts";
import {
  type GitReviewIndexExecutionBudget,
  GitReviewIndexInputError,
  type GitReviewIndexPrimaryParseResult,
  type GitReviewIndexStatParseResult,
} from "./contract.ts";
import {
  assertGitReviewIndexExecutionActive,
  gitReviewIdentityExecutionOptions,
  runGitReviewIndexParser,
  toGitReviewIndexFailure,
} from "./execution.ts";
import { GitReviewNumstatParser } from "./numstat-parser.ts";
import { GitReviewPorcelainV2Parser } from "./primary-parser.ts";
import {
  filterCommittedPrimaryEntries,
  GitReviewCommittedRawParser,
  type GitReviewRangeBounds,
  resolveGitReviewRangeBounds,
} from "./range.ts";
import {
  createGitReviewIndexRevision,
  createGitReviewWorkingTreeRevision,
} from "./revision.ts";
import {
  applyScopedMovements,
  GitReviewScopedMovementParser,
  mergeScopedPrimaryReads,
} from "./scoped.ts";
import {
  buildGitReviewGroupSummaries,
  type GitReviewUntrackedPathStatsReader,
} from "./summary.ts";

const DIFF_MACHINE_ARGS = [
  "--no-ext-diff",
  "--no-textconv",
  "--no-color",
  "--ignore-submodules=none",
  "--find-renames=50%",
  "--find-copies=50%",
  "-l0",
] as const;

export interface ReadGitReviewIndexRequest {
  /** document 稳定性检查只需 entries/revision；跳过可能读取工作区正文的摘要。 */
  readonly includeGroupSummaries?: boolean;
  /** main-only 单文件探测；公开 index 请求不设置。 */
  readonly paths?: readonly string[];
  readonly scope: GitReviewScope;
}

export interface ReadGitReviewIndexOptions {
  budget: GitReviewIndexExecutionBudget;
  signal: AbortSignal;
}

interface CreateGitReviewIndexReaderOptions {
  execGitRaw?: ExecGitRaw;
  identityResolver?: Pick<GitReviewIdentityResolver, "resolveRepository">;
  readUntrackedPathStats?: GitReviewUntrackedPathStatsReader;
}

export type GitReviewIndexResolution =
  | GitReviewFailure
  | {
      readonly kind: "ok";
      readonly metadata: GitReviewIndexMetadata;
      readonly resolvedEntries: readonly GitReviewIndexResolvedEntry[];
      readonly result: Extract<GitReviewIndexResult, { kind: "ok" }>;
    };

export interface GitReviewIndexMetadata {
  readonly canonicalRoot: string;
  readonly headOid: string | null;
  readonly indexRevision: string;
  /** commit/branch 目标的不可变 range 边界；uncommitted 为 null。 */
  readonly rangeBounds: GitReviewRangeBounds | null;
}

/**
 * 只负责从已允许的 scope 中构建索引；contextId 授权由上层 service 完成。
 */
export class GitReviewIndexReader {
  readonly #execGitRaw: ExecGitRaw;
  readonly #identityResolver: Pick<
    GitReviewIdentityResolver,
    "resolveRepository"
  >;
  readonly #readUntrackedPathStats: GitReviewUntrackedPathStatsReader;

  constructor(options: CreateGitReviewIndexReaderOptions = {}) {
    this.#execGitRaw = options.execGitRaw ?? execGitRaw;
    this.#identityResolver =
      options.identityResolver ?? new GitReviewIdentityResolver();
    this.#readUntrackedPathStats =
      options.readUntrackedPathStats ?? readGitUntrackedPathStats;
  }

  async read(
    request: ReadGitReviewIndexRequest,
    options: ReadGitReviewIndexOptions
  ): Promise<GitReviewIndexResult> {
    const resolution = await this.resolve(request, options);
    return resolution.kind === "ok" ? resolution.result : resolution;
  }

  /** main-only 解析结果；T4 文档服务用它取得与同一 revision 绑定的 group 路径。 */
  async resolve(
    request: ReadGitReviewIndexRequest,
    options: ReadGitReviewIndexOptions
  ): Promise<GitReviewIndexResolution> {
    const { budget, signal } = options;
    try {
      const { paths, scope } = parseGitReviewIndexRequest(request);
      const identity = await this.#identityResolver.resolveRepository(
        scope.gitRootPath,
        gitReviewIdentityExecutionOptions(budget, signal)
      );
      const canonicalRoot = gitReviewRootPathSchema.parse(
        identity.canonicalRoot
      );
      const read =
        scope.target.kind === "uncommitted"
          ? await this.#readUncommitted(
              { ...identity, canonicalRoot },
              budget,
              signal,
              paths
            )
          : await this.#readRange(
              { ...identity, canonicalRoot },
              budget,
              signal,
              paths,
              scope.target
            );
      const summaryResult =
        request.includeGroupSummaries === false
          ? {
              groupSummaries: {},
              stableUntrackedStatTokens: new Map<string, string>(),
            }
          : await buildGitReviewGroupSummaries({
              budget,
              canonicalRoot,
              entries: read.assembled.entries,
              readUntrackedPathStats: this.#readUntrackedPathStats,
              resolvedEntries: read.assembled.resolvedEntries,
              signal,
            });
      const indexRevision = createGitReviewIndexRevision(
        read.assembled.revision,
        read.rangeBounds?.headOid ?? identity.headOid,
        scope.target.kind === "uncommitted"
          ? await createGitReviewWorkingTreeRevision(
              canonicalRoot,
              read.assembled.resolvedEntries,
              summaryResult.stableUntrackedStatTokens,
              budget,
              signal
            )
          : null
      );
      const result = gitReviewIndexOkSchema.parse({
        entries: read.assembled.entries,
        groupSummaries: summaryResult.groupSummaries,
        indexRevision,
        kind: "ok",
        warnings: read.assembled.warnings,
      });
      assertGitReviewIndexExecutionActive(budget, signal);
      return Object.freeze({
        kind: "ok" as const,
        metadata: Object.freeze({
          canonicalRoot,
          headOid: identity.headOid,
          indexRevision,
          rangeBounds: read.rangeBounds ?? null,
        }),
        resolvedEntries: read.assembled.resolvedEntries,
        result,
      });
    } catch (error) {
      return gitReviewFailureSchema.parse(toGitReviewIndexFailure(error));
    }
  }

  /**
   * commit/branch 目标的 range diff 读取。始终跑 full-range raw(保证 rename
   * 检测与 index 请求一致),document 请求的 paths 通过结果过滤实现。
   */
  async #readRange(
    identity: GitReviewRepositoryIdentity,
    budget: GitReviewIndexExecutionBudget,
    signal: AbortSignal | undefined,
    paths: readonly string[] | undefined,
    target: Exclude<GitReviewTarget, { kind: "uncommitted" }>
  ): Promise<{
    assembled: AssembledGitReviewIndex;
    rangeBounds: GitReviewRangeBounds;
  }> {
    const rangeBounds = await resolveGitReviewRangeBounds(
      this.#execGitRaw,
      {
        cwd: identity.canonicalRoot,
        headOid: identity.headOid,
        objectFormat: identity.objectFormat,
        target,
      },
      { budget, signal }
    );
    const parser = new GitReviewCommittedRawParser(rangeBounds);
    await runGitReviewIndexParser(
      this.#execGitRaw,
      [
        "--literal-pathspecs",
        "diff",
        ...DIFF_MACHINE_ARGS,
        "--raw",
        "--no-abbrev",
        "-z",
        rangeBounds.baseOid,
        rangeBounds.headOid,
        "--",
      ],
      identity.canonicalRoot,
      budget,
      signal,
      (record) => parser.push(record)
    );
    let primary = parser.finish();
    if (paths !== undefined) {
      primary = filterCommittedPrimaryEntries(primary, paths);
    }
    const statParser = new GitReviewNumstatParser("committed");
    await runGitReviewIndexParser(
      this.#execGitRaw,
      [
        "--literal-pathspecs",
        "diff",
        ...DIFF_MACHINE_ARGS,
        "--numstat",
        "-z",
        rangeBounds.baseOid,
        rangeBounds.headOid,
        "--",
      ],
      identity.canonicalRoot,
      budget,
      signal,
      (record) => statParser.push(record)
    );
    const committedStats = statParser.finish();
    assertGitReviewIndexExecutionActive(budget, signal);
    const assembled = assembleGitReviewIndex({
      primary,
      statsByGroup: { committed: committedStats },
    });
    assertGitReviewIndexExecutionActive(budget, signal);
    return { assembled, rangeBounds };
  }

  async #readUncommitted(
    identity: GitReviewRepositoryIdentity,
    budget: GitReviewIndexExecutionBudget,
    signal: AbortSignal | undefined,
    paths: readonly string[] | undefined
  ): Promise<{
    assembled: AssembledGitReviewIndex;
    rangeBounds?: undefined;
  }> {
    const readPrimary = async (
      selectedPaths: readonly string[] | undefined
    ): Promise<GitReviewIndexPrimaryParseResult> => {
      const primaryParser = new GitReviewPorcelainV2Parser();
      await runGitReviewIndexParser(
        this.#execGitRaw,
        [
          "-c",
          "status.renames=copies",
          "-c",
          "status.renameLimit=0",
          ...(selectedPaths === undefined ? ["--literal-pathspecs"] : []),
          "status",
          "--porcelain=v2",
          "-z",
          "--ignore-submodules=none",
          "--untracked-files=all",
          ...(selectedPaths === undefined
            ? []
            : ["--", ...createGitReviewExactPathspecs(selectedPaths)]),
        ],
        identity.canonicalRoot,
        budget,
        signal,
        (record) => primaryParser.push(record)
      );
      return primaryParser.finish();
    };
    const pathspecConflict =
      paths !== undefined && hasGitReviewExactPathspecConflict(paths);
    let primary: GitReviewIndexPrimaryParseResult;
    if (paths === undefined || !pathspecConflict) {
      primary = await readPrimary(paths);
    } else {
      const reads: GitReviewIndexPrimaryParseResult[] = [];
      for (const path of paths) {
        reads.push(await readPrimary([path]));
      }
      primary = mergeScopedPrimaryReads(reads);
      for (const group of ["unstaged", "staged"] as const) {
        const parser = new GitReviewScopedMovementParser(group);
        await runGitReviewIndexParser(
          this.#execGitRaw,
          [
            "--literal-pathspecs",
            "diff",
            ...DIFF_MACHINE_ARGS,
            ...(group === "staged" ? ["--cached"] : []),
            "--raw",
            "--no-abbrev",
            "--diff-filter=RC",
            "-z",
            "--",
            ...paths,
          ],
          identity.canonicalRoot,
          budget,
          signal,
          (record) => parser.push(record)
        );
        const parsed = parser.finish();
        primary = applyScopedMovements(primary, group, parsed, paths);
      }
    }
    const rangePaths =
      paths === undefined ? [] : scopedRangePaths(primary, paths);
    const rangePathspecConflict =
      paths !== undefined && hasGitReviewExactPathspecConflict(rangePaths);
    const rangePathspecs =
      paths === undefined || rangePathspecConflict
        ? []
        : createGitReviewExactPathspecs(rangePaths);
    const statsByGroup: Partial<
      Record<GitReviewGroup, GitReviewIndexStatParseResult>
    > = {};
    // unstaged / staged numstat 互不依赖，各自独占 parser。串行等于白等一次
    // git 索引刷新——大仓下这一步就是 document 读取的主要耗时来源。
    const statReads = await Promise.all(
      (rangePathspecConflict ? [] : (["unstaged", "staged"] as const)).map(
        async (group) => {
          const parser = new GitReviewNumstatParser(group);
          await runGitReviewIndexParser(
            this.#execGitRaw,
            [
              ...(paths === undefined ? ["--literal-pathspecs"] : []),
              "diff",
              ...DIFF_MACHINE_ARGS,
              ...(group === "staged" ? ["--cached"] : []),
              "--numstat",
              "-z",
              "--",
              ...rangePathspecs,
            ],
            identity.canonicalRoot,
            budget,
            signal,
            (record) => parser.push(record)
          );
          return [group, parser.finish()] as const;
        }
      )
    );
    for (const [group, parsed] of statReads) {
      statsByGroup[group] = parsed;
    }
    assertGitReviewIndexExecutionActive(budget, signal);
    const assembled = assembleGitReviewIndex({
      primary,
      statsByGroup,
    });
    assertGitReviewIndexExecutionActive(budget, signal);
    return { assembled };
  }
}

function parseGitReviewIndexRequest(request: ReadGitReviewIndexRequest): {
  paths: readonly string[] | undefined;
  scope: GitReviewScope;
} {
  const scope = gitReviewScopeSchema.safeParse(request.scope);
  if (!scope.success) {
    throw new GitReviewIndexInputError("Git Review scope 非法", {
      cause: scope.error,
    });
  }
  let paths: readonly string[] | undefined;
  if (request.paths !== undefined) {
    // 单文件 document 探测：path + 最多 3 条 oldPaths。批摘录禁止走这条通道。
    const parsedPaths = gitReviewRelativePathSchema
      .array()
      .min(1)
      .max(4)
      .safeParse(request.paths);
    if (!parsedPaths.success) {
      throw new GitReviewIndexInputError("Git Review paths 非法", {
        cause: parsedPaths.error,
      });
    }
    paths = [...new Set(parsedPaths.data)];
  }
  return {
    paths,
    scope: scope.data,
  };
}

function scopedRangePaths(
  primary: GitReviewIndexPrimaryParseResult,
  requestedPaths: readonly string[]
): string[] {
  const paths = new Set(requestedPaths);
  for (const entry of primary.entries) {
    if (!paths.has(entry.path)) {
      continue;
    }
    paths.add(entry.path);
    for (const fact of Object.values(entry.groupFacts)) {
      if (fact?.oldPath !== null && fact?.oldPath !== undefined) {
        paths.add(fact.oldPath);
      }
      if (fact !== undefined) {
        paths.add(fact.targetPath);
      }
    }
  }
  return [...paths];
}
