import type {
  GitReviewConflictResolveRequest,
  GitReviewFailure,
  GitReviewMutationResult,
} from "../../../../shared/contracts/git/review.ts";
import { gitReviewFailureSchema } from "../../../../shared/contracts/git/review.ts";
import type { ExecGitRaw } from "../../git/exec.ts";
import { isGitPathspecError } from "../../git/stage-operations.ts";
import type { GitReviewIndexExecutionBudget } from "../index/contract.ts";
import type { GitReviewIndexReader } from "../index/index.ts";
import type { GitReviewMutationWriter } from "../mutation.ts";
import {
  GitReviewPathError,
  readGitReviewFileSnapshot,
} from "../path/guard.ts";
import { writeGitReviewFileContents } from "../path/write.ts";

type ConflictIndexReader = Pick<GitReviewIndexReader, "resolve">;

/**
 * Mark a conflict path resolved: write body and/or checkout ours/theirs, then
 * `git add` so the path leaves the unmerged index state.
 */
export async function resolveGitReviewConflict(options: {
  readonly budget: GitReviewIndexExecutionBudget;
  readonly execGitRaw: ExecGitRaw;
  readonly indexReader: ConflictIndexReader;
  readonly request: GitReviewConflictResolveRequest;
  readonly signal: AbortSignal;
  readonly writer: GitReviewMutationWriter;
}): Promise<GitReviewMutationResult> {
  const { budget, execGitRaw, indexReader, request, signal, writer } = options;
  if (request.source.target.kind !== "uncommitted") {
    return failure(
      "invalidSource",
      false,
      "Only uncommitted review can resolve conflicts"
    );
  }

  const scope = {
    contextId: request.source.contextId,
    gitRootPath: request.source.gitRootPath,
    target: request.source.target,
  };
  const resolved = await indexReader.resolve(
    { paths: [request.source.path], scope },
    { budget, signal }
  );
  if (resolved.kind === "error") {
    return resolved;
  }
  const entry = resolved.resolvedEntries.find(
    (candidate) => candidate.path === request.source.path
  );
  const conflictFact = entry?.groupFacts.conflict;
  if (conflictFact === undefined || conflictFact.origin !== "conflict") {
    return failure(
      "changeNotFound",
      true,
      "This path is no longer in conflict"
    );
  }

  const cwd = request.source.gitRootPath;
  const path = request.source.path;

  try {
    if (request.action === "write") {
      const writeResult = await writeResolvedContents({
        budget,
        expectedDigest: request.expectedContentsDigest,
        path,
        resolvedContents: request.resolvedContents ?? "",
        root: cwd,
        signal,
      });
      if (writeResult !== null) {
        return writeResult;
      }
    } else {
      const side = request.action === "ours" ? "--ours" : "--theirs";
      await execGitRaw(["--literal-pathspecs", "checkout", side, "--", path], {
        budget,
        cwd,
        mode: "collect",
        ...(signal ? { signal } : {}),
      });
    }

    await writer.stage(cwd, { paths: [path] });
  } catch (error) {
    if (error instanceof GitReviewPathError && error.reason === "changed") {
      return failure("staleRevision", true, error.message);
    }
    if (isGitPathspecError(error)) {
      return failure(
        "changeNotFound",
        true,
        error instanceof Error ? error.message : String(error)
      );
    }
    return failure(
      "commandFailed",
      false,
      error instanceof Error ? error.message : String(error)
    );
  }

  return { kind: "ok", operationId: request.operationId };
}

async function writeResolvedContents(options: {
  readonly budget: GitReviewIndexExecutionBudget;
  readonly expectedDigest: string | undefined;
  readonly path: string;
  readonly resolvedContents: string;
  readonly root: string;
  readonly signal?: AbortSignal;
}): Promise<GitReviewFailure | null> {
  if (options.expectedDigest === undefined) {
    return failure(
      "staleRevision",
      true,
      "Resolved write requires the observed file digest"
    );
  }
  let before: Awaited<ReturnType<typeof readGitReviewFileSnapshot>>;
  try {
    before = await readGitReviewFileSnapshot({
      budget: options.budget,
      gitRootPath: options.root,
      path: options.path,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (error) {
    if (error instanceof GitReviewPathError && error.reason === "missing") {
      return failure(
        "changeNotFound",
        true,
        "Conflict file is missing; use Keep Ours or Keep Theirs"
      );
    }
    throw error;
  }
  if (before.digest !== options.expectedDigest) {
    return failure(
      "staleRevision",
      true,
      "The conflict file changed before it could be written"
    );
  }

  await writeGitReviewFileContents({
    budget: options.budget,
    contents: options.resolvedContents,
    gitRootPath: options.root,
    path: options.path,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return null;
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
