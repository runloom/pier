import type {
  GitReviewFailure,
  GitReviewFileDocumentOk,
  GitReviewFileDocumentRequest,
  GitReviewFileDocumentResult,
} from "../../../../shared/contracts/git/review.ts";
import type { ExecGitRaw } from "../../git/exec.ts";
import {
  type GitReviewIndexExecutionBudget,
  GitReviewIndexExecutionError,
} from "../index/contract.ts";
import { toGitReviewIndexFailure } from "../index/execution.ts";
import type {
  GitReviewIndexReader,
  GitReviewIndexResolution,
} from "../index/index.ts";
import {
  buildGitReviewDocumentWithEvidence,
  type GitReviewDocumentEvidence,
} from "./index.ts";
import { GitReviewDocumentStaleError } from "./patch.ts";

const GIT_REVIEW_DOCUMENT_MAX_ATTEMPTS = 3;

interface CreateGitReviewDocumentReaderOptions {
  readonly execGitRaw: ExecGitRaw;
  readonly indexReader: Pick<GitReviewIndexReader, "resolve">;
}

export class GitReviewDocumentReader {
  readonly #evidenceByRevision = new Map<string, GitReviewDocumentEvidence>();
  readonly #execGitRaw: ExecGitRaw;
  readonly #indexReader: Pick<GitReviewIndexReader, "resolve">;

  constructor(options: CreateGitReviewDocumentReaderOptions) {
    this.#execGitRaw = options.execGitRaw;
    this.#indexReader = options.indexReader;
  }

  getEvidence(revision: string): GitReviewDocumentEvidence | null {
    return this.#evidenceByRevision.get(revision) ?? null;
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
          const built = await buildGitReviewDocumentWithEvidence({
            budget,
            entry: selected.entry,
            execGitRaw: this.#execGitRaw,
            metadata: before.metadata,
            resolvedEntry: selected.resolvedEntry,
            signal,
            source: request.source,
          });
          document = built.document;
          this.#evidenceByRevision.delete(document.revision);
          this.#evidenceByRevision.set(document.revision, built.evidence);
          while (this.#evidenceByRevision.size > 128) {
            const oldest = this.#evidenceByRevision.keys().next().value;
            if (typeof oldest !== "string") {
              break;
            }
            this.#evidenceByRevision.delete(oldest);
          }
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
        if (request.previousRevision === document.revision) {
          return { kind: "unchanged" };
        }
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
        includeGroupSummaries: false,
        paths: [request.source.path, ...request.source.oldPaths],
        scope: {
          contextId: request.source.contextId,
          gitRootPath: request.source.gitRootPath,
          target: request.source.target,
        },
      },
      { budget, signal }
    );
  }
}

function selectGitReviewEntry(
  resolution: Extract<GitReviewIndexResolution, { kind: "ok" }>,
  path: string
): {
  readonly entry: (typeof resolution.result.entries)[number];
  readonly resolvedEntry: (typeof resolution.resolvedEntries)[number];
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
