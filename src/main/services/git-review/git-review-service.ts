import {
  type GitReviewCancelRequest,
  type GitReviewFailure,
  type GitReviewFileDocumentRequest,
  type GitReviewFileDocumentResult,
  type GitReviewIndexRequest,
  type GitReviewIndexResult,
  type GitReviewScope,
  getGitReviewFileSourceIdentity,
  gitReviewCancelRequestSchema,
  gitReviewFailureSchema,
  gitReviewFileDocumentRequestSchema,
  gitReviewIndexRequestSchema,
} from "../../../shared/contracts/git-review.ts";
import { type ExecGitRaw, execGitRaw } from "../git-exec.ts";
import type { GitReviewBudget } from "./git-review-budget.ts";
import { GitReviewDocumentReader } from "./git-review-document-reader.ts";
import { GitReviewIndexReader } from "./git-review-index.ts";
import { toGitReviewIndexFailure } from "./git-review-index-execution.ts";
import {
  createGitReviewScheduler,
  type GitReviewExecutionBudget,
  type GitReviewOperationOwner,
  type GitReviewScheduler,
  GitReviewSchedulerError,
} from "./git-review-scheduler.ts";

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
  readonly #indexReader: GitReviewIndexReaderDependency;
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
        return this.#indexReader.read(
          {
            scope: canonicalRequest.data.source,
          },
          { budget: context.budget, signal: context.signal }
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
    const requestIdentity = getGitReviewFileSourceIdentity(request.source);
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
        return this.#documentReader.execute(
          canonicalRequest.data,
          context.budget,
          context.signal
        );
      },
    });
    return settleReadLease(lease);
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

function parseRequest<T>(
  schema: {
    safeParse: (
      input: unknown
    ) =>
      | { readonly success: false }
      | { readonly data: T; readonly success: true };
  },
  input: unknown,
  budget: GitReviewBudget,
  invalidMessage: string
):
  | { readonly failure: GitReviewFailure; readonly kind: "failure" }
  | { readonly kind: "ready"; readonly request: T } {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { kind: "ready", request: parsed.data };
  }
  budget.dispose();
  return {
    failure: failure("invalidSource", false, invalidMessage),
    kind: "failure",
  };
}

async function settleReadLease<T>(lease: {
  readonly promise: Promise<T>;
}): Promise<T | GitReviewFailure> {
  try {
    return await lease.promise;
  } catch (error) {
    if (error instanceof GitReviewSchedulerError) {
      return toGitReviewSchedulerFailure(error);
    }
    return gitReviewFailureSchema.parse(toGitReviewIndexFailure(error));
  }
}

function toGitReviewSchedulerFailure(
  error: GitReviewSchedulerError
): GitReviewFailure {
  if (error.reason === "busy") {
    return failure("busy", true, error.message);
  }
  if (error.reason === "duplicate-operation") {
    return failure("duplicateOperation", false, error.message);
  }
  if (error.reason === "timeout") {
    return failure("timeout", true, error.message);
  }
  if (error.reason === "output-limit") {
    return failure("outputLimit", true, error.message);
  }
  return failure("aborted", true, error.message);
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
