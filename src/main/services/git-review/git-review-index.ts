import {
  type GitReviewFailure,
  type GitReviewGroup,
  type GitReviewIndexResult,
  type GitReviewPanelQuery,
  type GitReviewQuery,
  type GitReviewResolvedQuery,
  type GitReviewScope,
  gitReviewFailureSchema,
  gitReviewIndexOkSchema,
  gitReviewQuerySchema,
  gitReviewScopeSchema,
} from "../../../shared/contracts/git-review.ts";
import { type ExecGitRaw, execGitRaw } from "../git-exec.ts";
import { GitReviewBudget } from "./git-review-budget.ts";
import {
  GitReviewIdentityResolver,
  type GitReviewRepositoryIdentity,
} from "./git-review-identity.ts";
import {
  type AssembledGitReviewIndex,
  assembleGitReviewIndex,
  type GitReviewIndexResolvedEntry,
} from "./git-review-index-assembler.ts";
import {
  GIT_REVIEW_INDEX_MAX_NUL_RECORDS,
  GIT_REVIEW_INDEX_RANGE_MAX_NUL_RECORDS,
  GIT_REVIEW_RENAME_LIMIT,
  type GitReviewIndexExecutionBudget,
  GitReviewIndexInputError,
  type GitReviewIndexStatParseResult,
} from "./git-review-index-contract.ts";
import {
  assertGitReviewIndexExecutionActive,
  assertGitReviewIndexTruncation,
  createGitReviewIndexToken,
  gitReviewIdentityExecutionOptions,
  hasGitRenameLimitWarning,
  runGitReviewIndexParser,
  toGitReviewIndexFailure,
} from "./git-review-index-execution.ts";
import { GitReviewNumstatParser } from "./git-review-index-numstat-parser.ts";
import { GitReviewPorcelainV2Parser } from "./git-review-index-primary-parser.ts";
import { GitReviewRawDiffParser } from "./git-review-index-raw-parser.ts";

const DIFF_MACHINE_ARGS = [
  "--no-ext-diff",
  "--no-textconv",
  "--no-color",
  "--ignore-submodules=none",
  "--find-renames=50%",
  "--find-copies=50%",
  `-l${GIT_REVIEW_RENAME_LIMIT}`,
] as const;

export interface ReadGitReviewIndexRequest {
  readonly query: GitReviewQuery;
  readonly scope: GitReviewScope;
}

export interface ReadGitReviewIndexOptions {
  budget?: GitReviewIndexExecutionBudget;
  signal?: AbortSignal;
}

export interface CreateGitReviewIndexReaderOptions {
  execGitRaw?: ExecGitRaw;
  identityResolver?: Pick<
    GitReviewIdentityResolver,
    | "resolveBranchInRepository"
    | "resolveCommitInRepository"
    | "resolveRepository"
  >;
  now?: () => number;
}

export type GitReviewIndexResolution =
  | GitReviewFailure
  | {
      readonly kind: "ok";
      readonly resolvedEntries: readonly GitReviewIndexResolvedEntry[];
      readonly result: Extract<GitReviewIndexResult, { kind: "ok" }>;
    };

/**
 * 只负责从已允许的 scope 中构建索引；contextId 授权由上层 service 完成。
 */
export class GitReviewIndexReader {
  readonly #execGitRaw: ExecGitRaw;
  readonly #identityResolver: Pick<
    GitReviewIdentityResolver,
    | "resolveBranchInRepository"
    | "resolveCommitInRepository"
    | "resolveRepository"
  >;
  readonly #now: () => number;

  constructor(options: CreateGitReviewIndexReaderOptions = {}) {
    this.#execGitRaw = options.execGitRaw ?? execGitRaw;
    this.#identityResolver =
      options.identityResolver ?? new GitReviewIdentityResolver();
    this.#now = options.now ?? Date.now;
  }

  async read(
    request: ReadGitReviewIndexRequest,
    options: ReadGitReviewIndexOptions = {}
  ): Promise<GitReviewIndexResult> {
    const resolution = await this.resolve(request, options);
    return resolution.kind === "ok" ? resolution.result : resolution;
  }

  /** main-only 解析结果；T4 文档服务用它取得与同一 revision 绑定的 group 路径。 */
  async resolve(
    request: ReadGitReviewIndexRequest,
    options: ReadGitReviewIndexOptions = {}
  ): Promise<GitReviewIndexResolution> {
    const startedAt = this.#now();
    let createdBudget: GitReviewBudget | undefined;
    let budget = options.budget;
    if (budget === undefined) {
      createdBudget = new GitReviewBudget({ now: this.#now });
      budget = createdBudget;
    }
    try {
      const { query, scope } = parseGitReviewIndexRequest(request);
      const identity = await this.#identityResolver.resolveRepository(
        scope.gitRootPath,
        gitReviewIdentityExecutionOptions(budget, options.signal)
      );
      const read = await this.#readResolved(
        identity,
        query,
        budget,
        options.signal
      );
      const result = gitReviewIndexOkSchema.parse({
        durationMs: Math.max(0, this.#now() - startedAt),
        entries: read.assembled.entries,
        gitRootPath: identity.canonicalRoot,
        kind: "ok",
        query: read.resolvedQuery,
        revision: read.assembled.revision,
        sourceQuery: read.sourceQuery,
        warnings: read.assembled.warnings,
      });
      assertGitReviewIndexExecutionActive(budget, options.signal);
      return Object.freeze({
        kind: "ok" as const,
        resolvedEntries: read.assembled.resolvedEntries,
        result,
      });
    } catch (error) {
      return gitReviewFailureSchema.parse(toGitReviewIndexFailure(error));
    } finally {
      createdBudget?.dispose();
    }
  }

  async #readResolved(
    identity: GitReviewRepositoryIdentity,
    query: GitReviewQuery,
    budget: GitReviewIndexExecutionBudget,
    signal: AbortSignal | undefined
  ): Promise<{
    assembled: AssembledGitReviewIndex;
    resolvedQuery: GitReviewResolvedQuery;
    sourceQuery: GitReviewPanelQuery;
  }> {
    if (query.kind === "uncommitted") {
      return this.#readUncommitted(identity, query, budget, signal);
    }
    if (query.kind === "commit") {
      const commit = await this.#identityResolver.resolveCommitInRepository(
        identity,
        query.oid,
        gitReviewIdentityExecutionOptions(budget, signal)
      );
      const resolvedQuery: GitReviewResolvedQuery = {
        baseOid: commit.firstParentOid,
        commitOid: commit.oid,
        kind: "commit",
        root: commit.firstParentOid === null,
      };
      return this.#readFixedRange(
        identity,
        resolvedQuery,
        { kind: "commit", oid: commit.oid },
        commit.firstParentOid ?? identity.emptyTreeOid,
        commit.oid,
        "commit",
        budget,
        signal
      );
    }
    const branch = await this.#identityResolver.resolveBranchInRepository(
      identity,
      query.targetRef,
      identity.headOid,
      gitReviewIdentityExecutionOptions(budget, signal)
    );
    const resolvedQuery: GitReviewResolvedQuery = {
      headOid: branch.headOid,
      kind: "branch",
      mergeBaseOid: branch.mergeBaseOid,
      targetOid: branch.targetOid,
      targetRef: branch.targetRef,
    };
    return this.#readFixedRange(
      identity,
      resolvedQuery,
      { kind: "branch", targetRef: branch.targetRef },
      branch.mergeBaseOid,
      branch.headOid,
      "branch",
      budget,
      signal
    );
  }

  async #readUncommitted(
    identity: GitReviewRepositoryIdentity,
    query: Extract<GitReviewQuery, { kind: "uncommitted" }>,
    budget: GitReviewIndexExecutionBudget,
    signal: AbortSignal | undefined
  ): Promise<{
    assembled: AssembledGitReviewIndex;
    resolvedQuery: GitReviewResolvedQuery;
    sourceQuery: GitReviewPanelQuery;
  }> {
    const primaryParser = new GitReviewPorcelainV2Parser();
    const primaryResult = await runGitReviewIndexParser(
      this.#execGitRaw,
      [
        "-c",
        "status.renames=copies",
        "-c",
        `status.renameLimit=${GIT_REVIEW_RENAME_LIMIT}`,
        "--literal-pathspecs",
        "status",
        "--porcelain=v2",
        "-z",
        "--ignore-submodules=none",
        "--untracked-files=all",
      ],
      identity.canonicalRoot,
      budget,
      signal,
      GIT_REVIEW_INDEX_MAX_NUL_RECORDS,
      (record) => primaryParser.push(record)
    );
    const primary = primaryParser.finish();
    assertGitReviewIndexTruncation(primaryResult, primary.truncated);
    const resolvedQuery: GitReviewResolvedQuery = {
      groups: query.groups,
      headOid: identity.headOid,
      indexToken: createGitReviewIndexToken(primary.indexDigest),
      kind: "uncommitted",
    };
    const statsByGroup: Partial<
      Record<GitReviewGroup, GitReviewIndexStatParseResult>
    > = {};
    let renameDetectionLimited = hasGitRenameLimitWarning(primaryResult);
    for (const group of query.groups) {
      const parser = new GitReviewNumstatParser(group);
      const result = await runGitReviewIndexParser(
        this.#execGitRaw,
        [
          "--literal-pathspecs",
          "diff",
          ...DIFF_MACHINE_ARGS,
          ...(group === "staged" ? ["--cached"] : []),
          "--numstat",
          "-z",
          "--",
        ],
        identity.canonicalRoot,
        budget,
        signal,
        GIT_REVIEW_INDEX_RANGE_MAX_NUL_RECORDS,
        (record) => parser.push(record)
      );
      const parsed = parser.finish();
      assertGitReviewIndexTruncation(result, parsed.truncated);
      statsByGroup[group] = parsed;
      renameDetectionLimited ||= hasGitRenameLimitWarning(result);
    }
    assertGitReviewIndexExecutionActive(budget, signal);
    const assembled = assembleGitReviewIndex({
      budget,
      primary,
      query: resolvedQuery,
      renameDetectionLimited,
      statsByGroup,
    });
    assertGitReviewIndexExecutionActive(budget, signal);
    return {
      assembled,
      resolvedQuery,
      sourceQuery: query,
    };
  }

  async #readFixedRange(
    identity: GitReviewRepositoryIdentity,
    resolvedQuery: Extract<
      GitReviewResolvedQuery,
      { kind: "commit" | "branch" }
    >,
    sourceQuery: GitReviewPanelQuery,
    baseOid: string,
    targetOid: string,
    group: "commit" | "branch",
    budget: GitReviewIndexExecutionBudget,
    signal: AbortSignal | undefined
  ): Promise<{
    assembled: AssembledGitReviewIndex;
    resolvedQuery: GitReviewResolvedQuery;
    sourceQuery: GitReviewPanelQuery;
  }> {
    const primaryParser = new GitReviewRawDiffParser(group);
    const rawResult = await runGitReviewIndexParser(
      this.#execGitRaw,
      [
        "--literal-pathspecs",
        "diff",
        ...DIFF_MACHINE_ARGS,
        "--no-abbrev",
        "--raw",
        "-z",
        baseOid,
        targetOid,
        "--",
      ],
      identity.canonicalRoot,
      budget,
      signal,
      GIT_REVIEW_INDEX_RANGE_MAX_NUL_RECORDS,
      (record) => primaryParser.push(record)
    );
    const primary = primaryParser.finish();
    assertGitReviewIndexTruncation(rawResult, primary.truncated);
    const numstatParser = new GitReviewNumstatParser(group);
    const numstatResult = await runGitReviewIndexParser(
      this.#execGitRaw,
      [
        "--literal-pathspecs",
        "diff",
        ...DIFF_MACHINE_ARGS,
        "--numstat",
        "-z",
        baseOid,
        targetOid,
        "--",
      ],
      identity.canonicalRoot,
      budget,
      signal,
      GIT_REVIEW_INDEX_RANGE_MAX_NUL_RECORDS,
      (record) => numstatParser.push(record)
    );
    const stats = numstatParser.finish();
    assertGitReviewIndexTruncation(numstatResult, stats.truncated);
    assertGitReviewIndexExecutionActive(budget, signal);
    const assembled = assembleGitReviewIndex({
      budget,
      primary,
      query: resolvedQuery,
      renameDetectionLimited:
        hasGitRenameLimitWarning(rawResult) ||
        hasGitRenameLimitWarning(numstatResult),
      statsByGroup: { [group]: stats },
    });
    assertGitReviewIndexExecutionActive(budget, signal);
    return {
      assembled,
      resolvedQuery,
      sourceQuery,
    };
  }
}

function parseGitReviewIndexRequest(request: ReadGitReviewIndexRequest): {
  query: GitReviewQuery;
  scope: GitReviewScope;
} {
  const scope = gitReviewScopeSchema.safeParse(request.scope);
  if (!scope.success) {
    throw new GitReviewIndexInputError("Git Review scope 非法", {
      cause: scope.error,
    });
  }
  const query = gitReviewQuerySchema.safeParse(request.query);
  if (!query.success) {
    throw new GitReviewIndexInputError("Git Review query 非法", {
      cause: query.error,
    });
  }
  return { query: query.data, scope: scope.data };
}
