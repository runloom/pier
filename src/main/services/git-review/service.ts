import {
  type GitReviewCancelRequest,
  type GitReviewConflictResolveRequest,
  type GitReviewExcerptBatchRequest,
  type GitReviewExcerptBatchResult,
  type GitReviewFailure,
  type GitReviewFileDocumentRequest,
  type GitReviewFileDocumentResult,
  type GitReviewIndexRequest,
  type GitReviewIndexResult,
  type GitReviewMutationRequest,
  type GitReviewMutationResult,
  type GitReviewPathMutationRequest,
  type GitReviewScope,
  getGitReviewFileSourceIdentity,
  gitReviewCancelRequestSchema,
  gitReviewFileDocumentRequestSchema,
  gitReviewIndexRequestSchema,
  gitReviewMutationRequestSchema,
  gitReviewPathMutationRequestSchema,
} from "../../../shared/contracts/git/review.ts";
import { type ExecGitRaw, execGitRaw } from "../git/exec.ts";
import type { GitReviewBudget } from "./budget.ts";
import { GitReviewDocumentReader } from "./document/reader.ts";
import { GitReviewIndexReader } from "./index/index.ts";
import {
  applyGitReviewMutation,
  type GitReviewMutationWriter,
} from "./mutation.ts";
import { applyGitReviewPathMutation } from "./path/mutation.ts";
import { GitReviewRepositoryCoordinator } from "./repository-coordinator.ts";
import {
  createGitReviewScheduler,
  type GitReviewExecutionBudget,
  type GitReviewOperationOwner,
  type GitReviewScheduler,
} from "./scheduler/index.ts";
import { runGitReviewExcerptBatch } from "./service-excerpt.ts";
import {
  gitReviewServiceFailure as failure,
  parseGitReviewServiceRequest as parseRequest,
  rememberGitReviewMutationResult,
  settleGitReviewServiceLease as settleReadLease,
} from "./service-helpers.ts";
import { runGitReviewConflictResolve } from "./service-resolve-conflict.ts";

type GitReviewServiceScheduler = Pick<
  GitReviewScheduler,
  "cancelOwned" | "releaseOwner" | "schedule"
>;

type GitReviewIndexReaderDependency = Pick<
  GitReviewIndexReader,
  "read" | "resolve"
>;

interface CreateGitReviewServiceOptions {
  readonly execGitRaw?: ExecGitRaw;
  readonly indexReader?: GitReviewIndexReaderDependency;
  readonly scheduler?: GitReviewServiceScheduler;
}

export type { GitReviewMutationWriter } from "./mutation.ts";

interface GitReviewSourceResolutionControl {
  readonly budget: GitReviewExecutionBudget;
  readonly signal: AbortSignal;
}

export type GitReviewSourceResolver = <T extends GitReviewScope>(
  source: T,
  control: GitReviewSourceResolutionControl
) => Promise<GitReviewFailure | { readonly kind: "ok"; readonly value: T }>;

export interface GitReviewRequestOptions {
  readonly budget: GitReviewBudget;
  readonly owner: GitReviewOperationOwner;
  readonly resolveSource: GitReviewSourceResolver;
}

/** main-only Git Review 门面。公开请求必须从命令入口传入 owner、统一预算与路径授权器。 */
export class GitReviewService {
  readonly #documentReader: GitReviewDocumentReader;
  readonly #completedMutations = new Map<
    string,
    {
      readonly requestIdentity: string;
      readonly result: GitReviewMutationResult;
    }
  >();
  readonly #indexReader: GitReviewIndexReaderDependency;
  readonly #repositoryCoordinator = new GitReviewRepositoryCoordinator();
  readonly #scheduler: GitReviewServiceScheduler;

  constructor(options: CreateGitReviewServiceOptions = {}) {
    const gitExec = options.execGitRaw ?? execGitRaw;
    this.#indexReader =
      options.indexReader ?? new GitReviewIndexReader({ execGitRaw: gitExec });
    this.#documentReader = new GitReviewDocumentReader({
      execGitRaw: gitExec,
      indexReader: this.#indexReader,
    });
    this.#scheduler = options.scheduler ?? createGitReviewScheduler();
  }

  async getIndex(
    input: GitReviewIndexRequest,
    options: GitReviewRequestOptions
  ): Promise<GitReviewIndexResult> {
    const prepared = parseRequest(
      gitReviewIndexRequestSchema,
      input,
      options.budget,
      "Git Review index 请求非法"
    );
    if (prepared.kind === "failure") {
      return prepared.failure;
    }
    const { request } = prepared;
    const requestIdentity = JSON.stringify([
      request.source.contextId,
      request.source.gitRootPath,
      request.source.target,
    ]);
    const lease = this.#scheduler.schedule<GitReviewIndexResult>({
      budget: options.budget,
      key: {
        canonicalRequestKey: requestIdentity,
        operationKind: "index",
        // contextId 由 main 的 PanelContext 解析器稳定派生；在真正访问仓库前，
        // resolveSource 仍会校验该身份并返回规范 gitRootPath。
        repositoryKey: request.source.contextId,
        sourceKey: requestIdentity,
      },
      operationId: request.operationId,
      owner: options.owner,
      run: async (context) => {
        const source = await options.resolveSource(request.source, context);
        if (source.kind === "error") {
          return source;
        }
        const canonicalRequest = gitReviewIndexRequestSchema.safeParse({
          ...request,
          source: source.value,
        });
        if (!canonicalRequest.success) {
          return failure(
            "invalidSource",
            false,
            "Git Review canonical index source 非法"
          );
        }
        return this.#repositoryCoordinator.runConsistentIndexRead(
          canonicalRequest.data.source.gitRootPath,
          context.signal,
          () =>
            this.#indexReader.read(
              {
                scope: canonicalRequest.data.source,
              },
              { budget: context.budget, signal: context.signal }
            )
        );
      },
    });
    return settleReadLease(lease);
  }

  async getFileDocument(
    input: GitReviewFileDocumentRequest,
    options: GitReviewRequestOptions
  ): Promise<GitReviewFileDocumentResult> {
    const prepared = parseRequest(
      gitReviewFileDocumentRequestSchema,
      input,
      options.budget,
      "Git Review document 请求非法"
    );
    if (prepared.kind === "failure") {
      return prepared.failure;
    }
    const { request } = prepared;
    const requestIdentity = JSON.stringify([
      getGitReviewFileSourceIdentity(request.source),
      request.previousRevision ?? null,
    ]);
    const lease = this.#scheduler.schedule<GitReviewFileDocumentResult>({
      budget: options.budget,
      key: {
        canonicalRequestKey: requestIdentity,
        operationKind: "document",
        repositoryKey: request.source.contextId,
        sourceKey: JSON.stringify([
          request.source.contextId,
          request.source.target,
          request.source.path,
        ]),
      },
      operationId: request.operationId,
      owner: options.owner,
      run: async (context) => {
        const source = await options.resolveSource(request.source, context);
        if (source.kind === "error") {
          return source;
        }
        const canonicalRequest = gitReviewFileDocumentRequestSchema.safeParse({
          ...request,
          source: source.value,
        });
        if (!canonicalRequest.success) {
          return failure(
            "invalidSource",
            false,
            "Git Review canonical document source 非法"
          );
        }
        return this.#repositoryCoordinator.runConsistentRead(
          canonicalRequest.data.source.gitRootPath,
          context.signal,
          () =>
            this.#documentReader.execute(
              canonicalRequest.data,
              context.budget,
              context.signal
            )
        );
      },
    });
    return settleReadLease(lease);
  }

  async getExcerptBatch(
    input: GitReviewExcerptBatchRequest,
    options: GitReviewRequestOptions
  ): Promise<GitReviewExcerptBatchResult> {
    return runGitReviewExcerptBatch({
      documentReader: this.#documentReader,
      input,
      repositoryCoordinator: this.#repositoryCoordinator,
      requestOptions: options,
      scheduler: this.#scheduler,
    });
  }

  async applyMutation(
    input: GitReviewMutationRequest,
    options: GitReviewRequestOptions & {
      readonly onCommitted?: (canonicalGitRootPath: string) => void;
      readonly writer: GitReviewMutationWriter;
    }
  ): Promise<GitReviewMutationResult> {
    const prepared = parseRequest(
      gitReviewMutationRequestSchema,
      input,
      options.budget,
      "Git Review mutation 请求非法"
    );
    if (prepared.kind === "failure") {
      return prepared.failure;
    }
    const { request } = prepared;
    const requestIdentity = getGitReviewFileSourceIdentity(request.source);
    const mutationIdentity = JSON.stringify(request);
    const completed = this.#completedMutations.get(request.operationId);
    if (completed !== undefined) {
      options.budget.dispose();
      return completed.requestIdentity === mutationIdentity
        ? completed.result
        : failure(
            "duplicateOperation",
            false,
            "The operation id was already used for a different Git change"
          );
    }
    const lease = this.#scheduler.schedule<GitReviewMutationResult>({
      budget: options.budget,
      key: {
        canonicalRequestKey: request.operationId,
        operationKind: "mutation",
        repositoryKey: request.source.contextId,
        sourceKey: requestIdentity,
      },
      operationId: request.operationId,
      owner: options.owner,
      run: async (context) => {
        const resolved = await options.resolveSource(request.source, context);
        if (resolved.kind === "error") {
          return resolved;
        }
        if (resolved.value.target.kind !== "uncommitted") {
          return failure(
            "invalidSource",
            false,
            "Only uncommitted Git review can be changed"
          );
        }
        const canonicalRequest = gitReviewMutationRequestSchema.safeParse({
          ...request,
          source: resolved.value,
        });
        if (!canonicalRequest.success) {
          return failure(
            "invalidSource",
            false,
            "Git Review canonical mutation source 非法"
          );
        }
        return this.#repositoryCoordinator.runMutation(
          resolved.value.gitRootPath,
          context.signal,
          async () => {
            const result = await applyGitReviewMutation({
              budget: context.budget,
              documentReader: this.#documentReader,
              indexReader: this.#indexReader,
              request: canonicalRequest.data,
              signal: context.signal,
              writer: options.writer,
            });
            if (result.kind !== "ok") {
              return result;
            }
            const committed = {
              ...result,
              stateSequence: this.#repositoryCoordinator.recordMutation(
                resolved.value.gitRootPath
              ),
            };
            options.onCommitted?.(resolved.value.gitRootPath);
            return committed;
          }
        );
      },
    });
    const result = await settleReadLease(lease);
    rememberGitReviewMutationResult(
      this.#completedMutations,
      request.operationId,
      mutationIdentity,
      result
    );
    return result;
  }

  async applyPathMutation(
    input: GitReviewPathMutationRequest,
    options: GitReviewRequestOptions & {
      readonly onCommitted?: (canonicalGitRootPath: string) => void;
      readonly writer: GitReviewMutationWriter;
    }
  ): Promise<GitReviewMutationResult> {
    const prepared = parseRequest(
      gitReviewPathMutationRequestSchema,
      input,
      options.budget,
      "Git Review path mutation 请求非法"
    );
    if (prepared.kind === "failure") {
      return prepared.failure;
    }
    const { request } = prepared;
    const mutationIdentity = JSON.stringify(request);
    const completed = this.#completedMutations.get(request.operationId);
    if (completed !== undefined) {
      options.budget.dispose();
      return completed.requestIdentity === mutationIdentity
        ? completed.result
        : failure(
            "duplicateOperation",
            false,
            "The operation id was already used for a different Git change"
          );
    }
    const lease = this.#scheduler.schedule<GitReviewMutationResult>({
      budget: options.budget,
      key: {
        canonicalRequestKey: request.operationId,
        operationKind: "mutation",
        repositoryKey: request.source.contextId,
        sourceKey: JSON.stringify([
          request.source.contextId,
          request.source.gitRootPath,
          request.source.target,
        ]),
      },
      operationId: request.operationId,
      owner: options.owner,
      run: async (context) => {
        const resolved = await options.resolveSource(request.source, context);
        if (resolved.kind === "error") {
          return resolved;
        }
        if (resolved.value.target.kind !== "uncommitted") {
          return failure(
            "invalidSource",
            false,
            "Only uncommitted Git review can be changed"
          );
        }
        const canonicalRequest = gitReviewPathMutationRequestSchema.safeParse({
          ...request,
          source: resolved.value,
        });
        if (!canonicalRequest.success) {
          return failure(
            "invalidSource",
            false,
            "Git Review canonical path mutation source 非法"
          );
        }
        return this.#repositoryCoordinator.runMutation(
          resolved.value.gitRootPath,
          context.signal,
          async () => {
            const result = await applyGitReviewPathMutation({
              budget: context.budget,
              indexReader: this.#indexReader,
              request: canonicalRequest.data,
              signal: context.signal,
              writer: options.writer,
            });
            if (result.kind !== "ok") {
              return result;
            }
            const committed = {
              ...result,
              stateSequence: this.#repositoryCoordinator.recordMutation(
                resolved.value.gitRootPath
              ),
            };
            options.onCommitted?.(resolved.value.gitRootPath);
            return committed;
          }
        );
      },
    });
    const result = await settleReadLease(lease);
    rememberGitReviewMutationResult(
      this.#completedMutations,
      request.operationId,
      mutationIdentity,
      result
    );
    return result;
  }

  async resolveConflict(
    input: GitReviewConflictResolveRequest,
    options: GitReviewRequestOptions & {
      readonly onCommitted?: (canonicalGitRootPath: string) => void;
      readonly writer: GitReviewMutationWriter;
    }
  ): Promise<GitReviewMutationResult> {
    return runGitReviewConflictResolve({
      completedMutations: this.#completedMutations,
      indexReader: this.#indexReader,
      input,
      repositoryCoordinator: this.#repositoryCoordinator,
      requestOptions: options,
      scheduler: this.#scheduler,
    });
  }

  cancelReviewRequest(
    input: GitReviewCancelRequest,
    owner: GitReviewOperationOwner
  ): void {
    const parsed = gitReviewCancelRequestSchema.safeParse(input);
    if (parsed.success) {
      this.#scheduler.cancelOwned(parsed.data.operationId, owner, "caller");
    }
  }

  releaseOwner(
    owner: GitReviewOperationOwner,
    reason: "owner-disposed" | "shutdown" = "owner-disposed"
  ): void {
    this.#scheduler.releaseOwner(owner, reason);
  }
}
