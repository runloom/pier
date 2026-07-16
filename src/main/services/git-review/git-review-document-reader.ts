import type {
  GitReviewFailure,
  GitReviewFileDocumentOk,
  GitReviewFileDocumentRequest,
  GitReviewFileDocumentResult,
} from "../../../shared/contracts/git-review.ts";
import type { ExecGitRaw } from "../git-exec.ts";
import { buildGitReviewDocument } from "./git-review-document.ts";
import { GitReviewDocumentStaleError } from "./git-review-document-patch.ts";
import type {
  GitReviewIndexReader,
  GitReviewIndexResolution,
} from "./git-review-index.ts";
import {
  type GitReviewIndexExecutionBudget,
  GitReviewIndexExecutionError,
} from "./git-review-index-contract.ts";
import { toGitReviewIndexFailure } from "./git-review-index-execution.ts";

const GIT_REVIEW_DOCUMENT_MAX_ATTEMPTS = 3;

interface CreateGitReviewDocumentReaderOptions {
  readonly execGitRaw: ExecGitRaw;
  readonly indexReader: Pick<GitReviewIndexReader, "resolve">;
}

export class GitReviewDocumentReader {
  readonly #execGitRaw: ExecGitRaw;
  readonly #indexReader: Pick<GitReviewIndexReader, "resolve">;

  constructor(options: CreateGitReviewDocumentReaderOptions) {
    this.#execGitRaw = options.execGitRaw;
    this.#indexReader = options.indexReader;
  }

  async execute(
    request: GitReviewFileDocumentRequest,
    budget: GitReviewIndexExecutionBudget,
    signal: AbortSignal
  ): Promise<GitReviewFileDocumentResult> {
    assertActive(budget, signal);
    return this.#readStable(request, budget, signal);
  }

  async #readStable(
    request: GitReviewFileDocumentRequest,
    budget: GitReviewIndexExecutionBudget,
    signal: AbortSignal
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
        const selected = selectGitReviewEntry(before, request.source.path);
        if (selected === null) {
          return {
            kind: "unchanged",
          };
        }
        let document: GitReviewFileDocumentOk;
        try {
          document = await buildGitReviewDocument({
            budget,
            execGitRaw: this.#execGitRaw,
            metadata: before.metadata,
            resolvedEntry: selected,
            signal,
            source: request.source,
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
        if (after.metadata.indexRevision !== before.metadata.indexRevision) {
          continue;
        }
        assertActive(budget, signal);
        return document;
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
      return toGitReviewIndexFailure(error);
    }
  }

  async #resolveSource(
    request: GitReviewFileDocumentRequest,
    budget: GitReviewIndexExecutionBudget,
    signal: AbortSignal
  ): Promise<GitReviewIndexResolution> {
    return this.#indexReader.resolve(
      {
        paths: [request.source.path, ...request.source.oldPaths],
        scope: {
          contextId: request.source.contextId,
          gitRootPath: request.source.gitRootPath,
        },
      },
      { budget, signal }
    );
  }
}

function selectGitReviewEntry(
  resolution: Extract<GitReviewIndexResolution, { kind: "ok" }>,
  path: string
): (typeof resolution.resolvedEntries)[number] | null {
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
  return resolvedEntry;
}

function assertActive(
  budget: GitReviewIndexExecutionBudget,
  signal: AbortSignal
): void {
  const reason = budget.failureReason();
  if (reason !== null) {
    throw new GitReviewIndexExecutionError(
      reason,
      `Git Review document ${reason}`
    );
  }
  if (signal.aborted) {
    throw new GitReviewIndexExecutionError(
      "aborted",
      "Git Review document 已取消"
    );
  }
}

function failure(
  reason: "outputLimit" | "staleRevision",
  retryable: boolean,
  message: string
): GitReviewFailure {
  return {
    kind: "error",
    message,
    reason,
    retryable,
  };
}
