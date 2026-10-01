import type {
  GitReviewConflictResolveRequest,
  GitReviewFailure,
  GitReviewMutationResult,
} from "../../../../shared/contracts/git/review.ts";
import { gitReviewFailureSchema } from "../../../../shared/contracts/git/review.ts";
import { type ExecGitRaw, GitExecRawError } from "../../git/exec.ts";
import { isGitPathspecError } from "../../git/stage-operations.ts";
import type { GitReviewIndexExecutionBudget } from "../index/contract.ts";
import type { GitReviewIndexReader } from "../index/index.ts";
import type { GitReviewMutationWriter } from "../mutation.ts";
import {
  GIT_REVIEW_SNAPSHOT_MAX_BYTES,
  GitReviewPathError,
  readGitReviewFileSnapshot,
} from "../path/guard.ts";
import { writeGitReviewFileContents } from "../path/write.ts";
import { readGitReviewConflictMaterial } from "./conflict.ts";
import { GitReviewDocumentStaleError } from "./patch-contract.ts";

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
  const revalidate = async (): Promise<GitReviewFailure | null> => {
    const currentIndex = await indexReader.resolve(
      { paths: [path], scope },
      { budget, signal }
    );
    if (currentIndex.kind === "error") {
      return currentIndex;
    }
    const currentFact = currentIndex.resolvedEntries.find(
      (candidate) => candidate.path === path
    )?.groupFacts.conflict;
    if (currentFact === undefined || currentFact.origin !== "conflict") {
      return failure(
        "staleRevision",
        true,
        "The conflict index changed before resolution"
      );
    }
    const current = await readGitReviewConflictMaterial({
      budget,
      execGitRaw,
      fact: currentFact,
      gitRootPath: cwd,
      signal,
    });
    return current.contentsDigest === request.expectedContentsDigest
      ? null
      : failure(
          "staleRevision",
          true,
          "The conflict changed before resolution"
        );
  };

  try {
    const material = await readGitReviewConflictMaterial({
      budget,
      execGitRaw,
      fact: conflictFact,
      gitRootPath: cwd,
      signal,
    });
    if (material.contentsDigest !== request.expectedContentsDigest) {
      return failure(
        "staleRevision",
        true,
        "The conflict changed before it could be resolved"
      );
    }
    if (request.action === "write") {
      const contents = request.resolvedContents;
      if (
        contents === undefined ||
        /^(?:<{7}|={7}|\|{7}|>{7})/mu.test(contents)
      ) {
        return failure(
          "invalidSource",
          false,
          "Conflict markers remain in the resolved contents"
        );
      }
      if (Buffer.byteLength(contents, "utf8") > GIT_REVIEW_SNAPSHOT_MAX_BYTES) {
        return failure(
          "invalidSource",
          false,
          "Resolved contents exceed the file snapshot byte limit"
        );
      }
      const before = await readGitReviewFileSnapshot({
        budget,
        gitRootPath: cwd,
        path,
        signal,
      });
      const stale = await revalidate();
      if (stale !== null) {
        return stale;
      }
      await writeGitReviewFileContents({
        budget,
        contents,
        expectedSnapshot: before,
        gitRootPath: cwd,
        path,
        signal,
      });
    } else if (request.action === "stage") {
      if (
        material.contents !== null &&
        /^(?:<{7}|={7}|\|{7}|>{7})/mu.test(material.contents)
      ) {
        return failure(
          "invalidSource",
          false,
          "Conflict markers remain in the worktree"
        );
      }
      if (
        material.presentation === "tooLarge" ||
        material.presentation === "readError"
      ) {
        return failure(
          "commandFailed",
          false,
          "The conflict worktree could not be checked before staging"
        );
      }
      const stale = await revalidate();
      if (stale !== null) {
        return stale;
      }
    } else {
      const stages = conflictFact.conflict;
      const chosenOid =
        request.action === "ours" ? stages?.oursOid : stages?.theirsOid;
      const chosenMode =
        request.action === "ours" ? stages?.oursMode : stages?.theirsMode;
      if (chosenOid !== null && chosenOid !== undefined) {
        if (
          (chosenMode === "100644" || chosenMode === "100755") &&
          (await stageBlobHasMarkers(
            execGitRaw,
            chosenOid,
            cwd,
            budget,
            signal
          ))
        ) {
          return failure(
            "invalidSource",
            false,
            "Conflict markers remain in the selected version"
          );
        }
        const stale = await revalidate();
        if (stale !== null) {
          return stale;
        }
        const side = request.action === "ours" ? "--ours" : "--theirs";
        await execGitRaw(
          [
            "--literal-pathspecs",
            "checkout",
            ...(chosenMode === "160000" ? ["--recurse-submodules"] : []),
            side,
            "--",
            path,
          ],
          { budget, cwd, mode: "collect", signal }
        );
      } else {
        const stale = await revalidate();
        if (stale !== null) {
          return stale;
        }
        await execGitRaw(["--literal-pathspecs", "rm", "-f", "--", path], {
          budget,
          cwd,
          mode: "collect",
          signal,
        });
        return { kind: "ok", operationId: request.operationId };
      }
    }
    await writer.stage(cwd, { paths: [path] });
  } catch (error) {
    if (
      error instanceof GitReviewDocumentStaleError ||
      (error instanceof GitReviewPathError && error.reason === "changed")
    ) {
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

async function stageBlobHasMarkers(
  execGitRaw: ExecGitRaw,
  oid: string,
  cwd: string,
  budget: GitReviewIndexExecutionBudget,
  signal: AbortSignal
): Promise<boolean> {
  try {
    await execGitRaw(
      [
        "grep",
        "--no-textconv",
        "-I",
        "-q",
        "-E",
        "^(<{7}|={7}|\\|{7}|>{7})",
        oid,
        "--",
      ],
      { budget, cwd, mode: "collect", signal }
    );
    return true;
  } catch (error) {
    if (
      error instanceof GitExecRawError &&
      error.causeKind === "exit" &&
      error.exitCode === 1 &&
      error.signal === null
    ) {
      return false;
    }
    throw error;
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
