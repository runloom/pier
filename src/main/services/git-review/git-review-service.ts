import { realpath as fsRealpath } from "node:fs/promises";
import {
  type GitReviewFailure,
  type GitReviewFileDocumentOk,
  type GitReviewFileDocumentRequest,
  type GitReviewFileDocumentResult,
  getGitDiffPanelSourceIdentity,
  gitReviewFailureSchema,
  gitReviewFileDocumentRequestSchema,
  gitReviewFileDocumentResultSchema,
} from "../../../shared/contracts/git-review.ts";
import { type ExecGitRaw, execGitRaw } from "../git-exec.ts";
import { GitReviewBudget } from "./git-review-budget.ts";
import { GitReviewCommitLru } from "./git-review-commit-lru.ts";
import { buildGitReviewDocument } from "./git-review-document.ts";
import {
  classifyGitReviewDocumentResult,
  toGitReviewSchedulerFailure,
} from "./git-review-document-observation.ts";
import { GitReviewDocumentStaleError } from "./git-review-document-patch.ts";
import { raceGitReviewIdentityBoundary } from "./git-review-identity-boundary.ts";
import {
  GitReviewIndexReader,
  type GitReviewIndexResolution,
} from "./git-review-index.ts";
import {
  GIT_REVIEW_INDEX_ENTRY_LIMIT,
  type GitReviewIndexExecutionBudget,
  GitReviewIndexExecutionError,
} from "./git-review-index-contract.ts";
import { toGitReviewIndexFailure } from "./git-review-index-execution.ts";
import {
  createGitReviewScheduler,
  type GitReviewOperationOwner,
  type GitReviewScheduler,
  GitReviewSchedulerError,
} from "./git-review-scheduler.ts";

const GIT_REVIEW_DOCUMENT_MAX_ATTEMPTS = 3;

interface GitReviewDocumentExecution {
  readonly cacheHit: boolean;
  readonly result: GitReviewFileDocumentResult;
}

export interface ReadGitReviewDocumentOptions {
  readonly budget?: GitReviewBudget;
  readonly owner?: GitReviewOperationOwner;
  readonly signal?: AbortSignal;
}

export interface CreateGitReviewServiceOptions {
  readonly canonicalizeRoot?: (path: string) => Promise<string>;
  readonly commitCache?: GitReviewCommitLru<GitReviewFileDocumentOk>;
  readonly execGitRaw?: ExecGitRaw;
  readonly indexReader?: Pick<GitReviewIndexReader, "resolve">;
  readonly now?: () => number;
  readonly scheduler?: Pick<GitReviewScheduler, "schedule">;
}

const DEFAULT_DOCUMENT_OWNER: GitReviewOperationOwner = Object.freeze({
  clientId: "git-review-service",
  generation: 0,
  windowRecordId: "main",
});

/** T4 main-only 编排；可信 owner 的窗口生命周期与 IPC 由 T6 接入。 */
export class GitReviewService {
  readonly #canonicalizeRoot: (path: string) => Promise<string>;
  readonly #commitCache: GitReviewCommitLru<GitReviewFileDocumentOk>;
  readonly #execGitRaw: ExecGitRaw;
  readonly #indexReader: Pick<GitReviewIndexReader, "resolve">;
  readonly #now: () => number;
  readonly #scheduler: Pick<GitReviewScheduler, "schedule">;

  constructor(options: CreateGitReviewServiceOptions = {}) {
    this.#execGitRaw = options.execGitRaw ?? execGitRaw;
    this.#indexReader =
      options.indexReader ??
      new GitReviewIndexReader({ execGitRaw: this.#execGitRaw });
    this.#canonicalizeRoot =
      options.canonicalizeRoot ??
      (options.indexReader === undefined ? fsRealpath : async (path) => path);
    this.#commitCache = options.commitCache ?? new GitReviewCommitLru();
    this.#now = options.now ?? Date.now;
    this.#scheduler = options.scheduler ?? createGitReviewScheduler();
  }

  async getFileDocument(
    input: GitReviewFileDocumentRequest,
    options: ReadGitReviewDocumentOptions = {}
  ): Promise<GitReviewFileDocumentResult> {
    const startedAt = this.#now();
    const parsed = gitReviewFileDocumentRequestSchema.safeParse(input);
    if (!parsed.success) {
      options.budget?.dispose();
      return failure("invalidSource", false, "Git Review document 请求非法");
    }
    if (options.signal?.aborted) {
      options.budget?.dispose();
      return failure("aborted", true, "Git Review document 已取消");
    }
    const existingBudgetFailure = options.budget?.failureReason();
    if (existingBudgetFailure !== undefined && existingBudgetFailure !== null) {
      options.budget?.dispose();
      return failure(
        existingBudgetFailure === "timeout" ? "timeout" : "outputLimit",
        true,
        `Git Review document ${existingBudgetFailure}`
      );
    }
    let createdBudget: GitReviewBudget | undefined;
    let budget = options.budget;
    if (budget === undefined) {
      createdBudget = new GitReviewBudget({ now: this.#now });
      budget = createdBudget;
    }
    let request: GitReviewFileDocumentRequest;
    try {
      const canonicalRoot = await raceGitReviewIdentityBoundary(
        () => this.#canonicalizeRoot(parsed.data.source.gitRootPath),
        {
          budget,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        }
      );
      request = gitReviewFileDocumentRequestSchema.parse({
        ...parsed.data,
        source: { ...parsed.data.source, gitRootPath: canonicalRoot },
      });
    } catch (error) {
      budget.dispose();
      return gitReviewFailureSchema.parse(toGitReviewIndexFailure(error));
    }
    if (options.signal?.aborted) {
      budget.dispose();
      return failure("aborted", true, "Git Review document 已取消");
    }
    const cacheKey = getGitDiffPanelSourceIdentity(request.source);
    if (!(budget instanceof GitReviewBudget)) {
      createdBudget?.dispose();
      return failure(
        "internal",
        false,
        "Git Review document 调度需要公开请求预算"
      );
    }
    const lease = this.#scheduler.schedule<GitReviewDocumentExecution>({
      budget,
      intent: "manual-read",
      key: {
        canonicalRequestKey: JSON.stringify([
          cacheKey,
          request.clientHasDocument ? request.ifRevision : null,
        ]),
        contentRequirement: request.clientHasDocument ? "conditional" : "full",
        operationKind: "document",
        repositoryKey: request.source.gitRootPath,
        sourceKey: cacheKey,
      },
      operationId: request.operationId,
      owner: options.owner ?? DEFAULT_DOCUMENT_OWNER,
      observation: {
        classifyError: () => ({
          failureReason: "internal",
          result: "failure",
        }),
        classifyResult: (execution) => ({
          ...classifyGitReviewDocumentResult(execution.result),
          cacheHit: execution.cacheHit,
        }),
        queryKind: request.source.query.kind,
        sourceFingerprintParts: [
          request.source.gitRootPath,
          request.source.contextId,
          JSON.stringify(request.source.query),
          request.source.path,
        ],
      },
      run: async (context) =>
        this.#executeFileDocument(
          request,
          context.budget,
          context.signal,
          startedAt,
          cacheKey
        ),
    });
    const cancelFromSignal = () => lease.cancel("caller");
    options.signal?.addEventListener("abort", cancelFromSignal, { once: true });
    try {
      return (await lease.promise).result;
    } catch (error) {
      if (error instanceof GitReviewSchedulerError) {
        return toGitReviewSchedulerFailure(error);
      }
      return gitReviewFailureSchema.parse(toGitReviewIndexFailure(error));
    } finally {
      options.signal?.removeEventListener("abort", cancelFromSignal);
    }
  }

  async #executeFileDocument(
    request: GitReviewFileDocumentRequest,
    budget: GitReviewIndexExecutionBudget,
    signal: AbortSignal,
    startedAt: number,
    cacheKey: string
  ): Promise<GitReviewDocumentExecution> {
    assertActive(budget, signal);
    const cached =
      request.source.query.kind === "commit"
        ? this.#commitCache.get(cacheKey)
        : undefined;
    if (cached !== undefined) {
      const result =
        request.clientHasDocument && request.ifRevision === cached.revision
          ? gitReviewFileDocumentResultSchema.parse({
              kind: "notModified",
              revision: cached.revision,
              source: request.source,
            })
          : gitReviewFileDocumentResultSchema.parse({
              ...cached,
              durationMs: Math.max(0, this.#now() - startedAt),
              source: request.source,
            });
      return { cacheHit: true, result };
    }
    return {
      cacheHit: false,
      result: await this.#readFileDocument(
        request,
        budget,
        signal,
        startedAt,
        cacheKey
      ),
    };
  }

  async #readFileDocument(
    request: GitReviewFileDocumentRequest,
    budget: GitReviewIndexExecutionBudget,
    signal: AbortSignal,
    startedAt: number,
    cacheKey: string
  ): Promise<GitReviewFileDocumentResult> {
    try {
      for (
        let attempt = 0;
        attempt < GIT_REVIEW_DOCUMENT_MAX_ATTEMPTS;
        attempt += 1
      ) {
        assertActive(budget, signal);
        const before = await this.#resolveSource(request, budget, signal);
        if (before.kind !== "ok") {
          return before;
        }
        const selected = selectEntry(before, request.source.path);
        if (selected === null) {
          if (
            before.result.warnings.some(
              (warning) => warning.code === "filesTruncated"
            )
          ) {
            return failure(
              "outputLimit",
              true,
              "Git Review index 已截断，无法确认目标文件"
            );
          }
          return gitReviewFileDocumentResultSchema.parse({
            kind: "unchanged",
            source: request.source,
          });
        }
        let document: Awaited<ReturnType<typeof buildGitReviewDocument>>;
        try {
          document = await buildGitReviewDocument({
            budget,
            entry: selected.entry,
            execGitRaw: this.#execGitRaw,
            index: before.result,
            now: this.#now,
            resolvedEntry: selected.resolvedEntry,
            signal,
            source: request.source,
            startedAt,
          });
        } catch (error) {
          if (
            error instanceof GitReviewDocumentStaleError &&
            attempt + 1 < GIT_REVIEW_DOCUMENT_MAX_ATTEMPTS
          ) {
            continue;
          }
          throw error;
        }
        const after = await this.#resolveSource(request, budget, signal);
        if (after.kind !== "ok") {
          return after;
        }
        if (after.result.revision !== before.result.revision) {
          continue;
        }
        assertActive(budget, signal);
        if (request.source.query.kind === "commit") {
          const frozen = deepFreezeJson(document);
          this.#commitCache.set(
            cacheKey,
            frozen,
            Buffer.byteLength(JSON.stringify(frozen), "utf8")
          );
        }
        if (
          request.clientHasDocument &&
          request.ifRevision === document.revision
        ) {
          return gitReviewFileDocumentResultSchema.parse({
            kind: "notModified",
            revision: document.revision,
            source: request.source,
          });
        }
        return gitReviewFileDocumentResultSchema.parse({
          ...document,
          durationMs: Math.max(0, this.#now() - startedAt),
        });
      }
      return failure(
        "staleRevision",
        true,
        "Git Review index 在 document 读取期间持续变化"
      );
    } catch (error) {
      if (error instanceof GitReviewDocumentStaleError) {
        return failure("staleRevision", true, error.message);
      }
      return gitReviewFailureSchema.parse(toGitReviewIndexFailure(error));
    }
  }

  async #resolveSource(
    request: GitReviewFileDocumentRequest,
    budget: GitReviewIndexExecutionBudget,
    signal: AbortSignal | undefined
  ): Promise<GitReviewIndexResolution> {
    return this.#indexReader.resolve(
      {
        query: request.source.query,
        scope: {
          contextId: request.source.contextId,
          gitRootPath: request.source.gitRootPath,
        },
      },
      {
        budget: new GitReviewIndexProbeBudget(budget),
        ...(signal === undefined ? {} : { signal }),
      }
    );
  }
}

class GitReviewIndexProbeBudget implements GitReviewIndexExecutionBudget {
  #files = 0;
  readonly #delegate: GitReviewIndexExecutionBudget;

  constructor(delegate: GitReviewIndexExecutionBudget) {
    this.#delegate = delegate;
  }

  get signal(): AbortSignal {
    return this.#delegate.signal;
  }

  consumeOutputBytes(delta: number): "ok" | "output-limit" | "timeout" {
    return this.#delegate.consumeOutputBytes(delta);
  }

  failureReason(): "output-limit" | "timeout" | null {
    return this.#delegate.failureReason();
  }

  remainingTimeMs(): number {
    return this.#delegate.remainingTimeMs();
  }

  tryConsumeFiles(delta = 1): boolean {
    if (!Number.isSafeInteger(delta) || delta < 0) {
      throw new RangeError("Git Review probe file delta 非法");
    }
    if (this.#files + delta > GIT_REVIEW_INDEX_ENTRY_LIMIT) {
      return false;
    }
    if (!this.#delegate.tryConsumeFiles(delta)) {
      return false;
    }
    this.#files += delta;
    return true;
  }
}

function selectEntry(
  resolution: Extract<GitReviewIndexResolution, { kind: "ok" }>,
  path: string
): {
  entry: (typeof resolution.result.entries)[number];
  resolvedEntry: (typeof resolution.resolvedEntries)[number];
} | null {
  const index = resolution.result.entries.findIndex(
    (entry) => entry.path === path
  );
  if (index < 0) {
    return null;
  }
  const entry = resolution.result.entries[index];
  const resolvedEntry = resolution.resolvedEntries[index];
  if (
    entry === undefined ||
    resolvedEntry === undefined ||
    entry.path !== resolvedEntry.path
  ) {
    throw new Error("Git Review public/resolved index 未对齐");
  }
  return { entry, resolvedEntry };
}

function assertActive(
  budget: GitReviewIndexExecutionBudget,
  signal: AbortSignal | undefined
): void {
  const reason = budget.failureReason();
  if (reason !== null) {
    throw new GitReviewIndexExecutionError(
      reason,
      `Git Review document ${reason}`
    );
  }
  if (signal?.aborted) {
    throw new GitReviewIndexExecutionError(
      "aborted",
      "Git Review document 已取消"
    );
  }
}

function failure(
  reason: GitReviewFailure["reason"],
  retryable: boolean,
  message: string | null
): GitReviewFailure {
  return gitReviewFailureSchema.parse({
    kind: "error",
    message,
    reason,
    retryable,
  });
}

function deepFreezeJson<T>(value: T): T {
  const seen = new WeakSet<object>();
  const work: unknown[] = [value];
  while (work.length > 0) {
    const current = work.pop();
    if (typeof current !== "object" || current === null || seen.has(current)) {
      continue;
    }
    seen.add(current);
    if (Array.isArray(current)) {
      work.push(...current);
    } else {
      work.push(...Object.values(current));
    }
    Object.freeze(current);
  }
  return value;
}
