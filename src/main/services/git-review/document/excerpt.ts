import type {
  GitReviewExcerptBatchItem,
  GitReviewExcerptBatchRequest,
  GitReviewExcerptBatchResult,
  GitReviewExcerptFile,
  GitReviewFailure,
  GitReviewFileDocumentResult,
  GitReviewFileSource,
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
import {
  GitReviewDocumentProtocolError,
  GitReviewDocumentStaleError,
} from "./patch.ts";

const GIT_REVIEW_DOCUMENT_MAX_ATTEMPTS = 3;
/** 单世代内有界 git 池；与 scheduler 每仓 2 对齐，不另开无界子进程。 */
const GIT_REVIEW_EXCERPT_GIT_POOL = 2;

export interface ReadGitReviewExcerptBatchOptions {
  readonly budget: GitReviewIndexExecutionBudget;
  readonly execGitRaw: ExecGitRaw;
  readonly indexReader: Pick<GitReviewIndexReader, "resolve">;
  readonly rememberEvidence: (
    revision: string,
    evidence: GitReviewDocumentEvidence
  ) => void;
  readonly request: GitReviewExcerptBatchRequest;
  readonly signal: AbortSignal;
}

export async function readGitReviewExcerptBatch(
  options: ReadGitReviewExcerptBatchOptions
): Promise<GitReviewExcerptBatchResult> {
  assertActive(options.budget, options.signal);
  try {
    for (
      let attempt = 0;
      attempt < GIT_REVIEW_DOCUMENT_MAX_ATTEMPTS;
      attempt += 1
    ) {
      assertActive(options.budget, options.signal);
      const before = await resolveExcerptIndex(options);
      if (before.kind !== "ok") {
        return before;
      }
      let stale = false;
      const items = await mapPool(
        options.request.files,
        GIT_REVIEW_EXCERPT_GIT_POOL,
        async (file): Promise<GitReviewExcerptBatchItem> => {
          if (stale) {
            return {
              path: file.path,
              result: unchangedResult(),
            };
          }
          try {
            const result = await materializeExcerptFile({
              file,
              options,
              resolution: before,
            });
            return { path: file.path, result };
          } catch (error) {
            if (
              error instanceof GitReviewDocumentStaleError &&
              attempt + 1 < GIT_REVIEW_DOCUMENT_MAX_ATTEMPTS
            ) {
              stale = true;
              return { path: file.path, result: unchangedResult() };
            }
            if (
              error instanceof GitReviewDocumentStaleError ||
              error instanceof GitReviewIndexExecutionError
            ) {
              throw error;
            }
            return {
              path: file.path,
              result: {
                kind: "error" as const,
                message: error instanceof Error ? error.message : String(error),
                reason: "internal" as const,
                retryable: !(error instanceof GitReviewDocumentProtocolError),
              },
            };
          }
        }
      );
      if (stale) {
        continue;
      }
      const after = await resolveExcerptIndex(options);
      if (after.kind !== "ok") {
        return after;
      }
      if (after.metadata.indexRevision !== before.metadata.indexRevision) {
        continue;
      }
      assertActive(options.budget, options.signal);
      return { items, kind: "ok" as const };
    }
    return failure(
      "staleRevision",
      true,
      "Git Review index 在 excerpt 读取期间持续变化"
    );
  } catch (error) {
    if (error instanceof GitReviewDocumentStaleError) {
      return failure("staleRevision", true, error.message);
    }
    return toGitReviewIndexFailure(error);
  }
}

async function materializeExcerptFile(input: {
  readonly file: GitReviewExcerptFile;
  readonly options: ReadGitReviewExcerptBatchOptions;
  readonly resolution: Extract<GitReviewIndexResolution, { kind: "ok" }>;
}): Promise<GitReviewFileDocumentResult> {
  const selected = selectGitReviewEntry(input.resolution, input.file.path);
  if (selected === null) {
    return unchangedResult();
  }
  const source: GitReviewFileSource = {
    ...input.options.request.source,
    oldPaths: [...input.file.oldPaths],
    path: input.file.path,
  };
  const built = await buildGitReviewDocumentWithEvidence({
    budget: input.options.budget,
    entry: selected.entry,
    execGitRaw: input.options.execGitRaw,
    metadata: input.resolution.metadata,
    resolvedEntry: selected.resolvedEntry,
    signal: input.options.signal,
    source,
  });
  input.options.rememberEvidence(built.document.revision, built.evidence);
  if (input.file.previousRevision === built.document.revision) {
    return unchangedResult();
  }
  return built.document;
}

async function resolveExcerptIndex(
  options: ReadGitReviewExcerptBatchOptions
): Promise<GitReviewIndexResolution> {
  // 单文件 document 的 scoped resolve 把 paths 钉死在 ≤4（path + oldPaths）。
  // 批摘录必须吃同一世代全量 index 快照，禁止把 32 条 path 塞进那条单文件通道。
  return options.indexReader.resolve(
    {
      includeGroupSummaries: false,
      scope: {
        contextId: options.request.source.contextId,
        gitRootPath: options.request.source.gitRootPath,
        target: options.request.source.target,
      },
    },
    { budget: options.budget, signal: options.signal }
  );
}

export function selectGitReviewEntry(
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

async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = next;
        next += 1;
        const item = items[index];
        if (item === undefined) {
          return;
        }
        results[index] = await mapper(item);
      }
    })
  );
  return results;
}

function unchangedResult(): Extract<
  GitReviewFileDocumentResult,
  { kind: "unchanged" }
> {
  return { kind: "unchanged" };
}

function assertActive(
  budget: GitReviewIndexExecutionBudget,
  signal: AbortSignal
): void {
  const reason = budget.failureReason();
  if (reason !== null) {
    throw new GitReviewIndexExecutionError(
      reason,
      `Git Review excerpt ${reason}`
    );
  }
  if (signal.aborted) {
    throw new GitReviewIndexExecutionError(
      "aborted",
      "Git Review excerpt 已取消"
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
