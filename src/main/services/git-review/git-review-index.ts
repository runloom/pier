import { createHash } from "node:crypto";
import {
  type GitReviewFailure,
  type GitReviewGroup,
  type GitReviewIndexResult,
  type GitReviewScope,
  gitReviewFailureSchema,
  gitReviewIndexOkSchema,
  gitReviewRelativePathSchema,
  gitReviewRootPathSchema,
  gitReviewScopeSchema,
} from "../../../shared/contracts/git-review.ts";
import { type ExecGitRaw, execGitRaw } from "../git-exec.ts";
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
  type GitReviewIndexExecutionBudget,
  GitReviewIndexInputError,
  type GitReviewIndexPrimaryParseResult,
  type GitReviewIndexStatParseResult,
} from "./git-review-index-contract.ts";
import {
  assertGitReviewIndexExecutionActive,
  gitReviewIdentityExecutionOptions,
  runGitReviewIndexParser,
  toGitReviewIndexFailure,
} from "./git-review-index-execution.ts";
import { GitReviewNumstatParser } from "./git-review-index-numstat-parser.ts";
import { GitReviewPorcelainV2Parser } from "./git-review-index-primary-parser.ts";
import {
  applyScopedMovements,
  GitReviewScopedMovementParser,
  mergeScopedPrimaryReads,
} from "./git-review-index-scoped.ts";
import {
  createGitReviewExactPathspecs,
  hasGitReviewExactPathspecConflict,
} from "./git-review-pathspec.ts";

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

  constructor(options: CreateGitReviewIndexReaderOptions = {}) {
    this.#execGitRaw = options.execGitRaw ?? execGitRaw;
    this.#identityResolver =
      options.identityResolver ?? new GitReviewIdentityResolver();
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
      const read = await this.#readUncommitted(
        { ...identity, canonicalRoot },
        budget,
        signal,
        paths
      );
      const result = gitReviewIndexOkSchema.parse({
        entries: read.assembled.entries,
        kind: "ok",
        warnings: read.assembled.warnings,
      });
      assertGitReviewIndexExecutionActive(budget, signal);
      return Object.freeze({
        kind: "ok" as const,
        metadata: Object.freeze({
          canonicalRoot,
          headOid: identity.headOid,
          indexRevision: bindGitReviewIndexRevision(
            read.assembled.revision,
            identity.headOid
          ),
        }),
        resolvedEntries: read.assembled.resolvedEntries,
        result,
      });
    } catch (error) {
      return gitReviewFailureSchema.parse(toGitReviewIndexFailure(error));
    }
  }

  async #readUncommitted(
    identity: GitReviewRepositoryIdentity,
    budget: GitReviewIndexExecutionBudget,
    signal: AbortSignal | undefined,
    paths: readonly string[] | undefined
  ): Promise<{
    assembled: AssembledGitReviewIndex;
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
    for (const group of rangePathspecConflict
      ? []
      : (["unstaged", "staged"] as const)) {
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
      const parsed = parser.finish();
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

function bindGitReviewIndexRevision(
  contentRevision: string,
  headOid: string | null
): string {
  const digest = createHash("sha256");
  for (const part of [
    "pier.git-review.index-revision.v1",
    contentRevision,
    headOid ?? "unborn",
  ]) {
    digest.update(part, "utf8");
    digest.update("\0", "utf8");
  }
  return `sha256:${digest.digest("hex")}`;
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
