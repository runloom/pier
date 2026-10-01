import type { ExecGitRaw } from "../../git/exec.ts";
import { createGitReviewExactPathspecs } from "../path/spec.ts";
import type {
  GitReviewIndexExecutionBudget,
  GitReviewIndexGroupFact,
  GitReviewIndexPrimaryParseResult,
  GitReviewIndexStatParseResult,
} from "./contract.ts";
import { runGitReviewIndexParser } from "./execution.ts";
import { GitReviewNumstatParser } from "./numstat-parser.ts";

// Leave ample space for Git's fixed arguments and the process environment.
const MAX_BATCH_BYTES = 32 * 1024;
const MAX_BATCH_PATHS = 128;

function pathspecBytes(path: string): number {
  // Conservative bound for escaped bytes, the magic prefix and terminator.
  return 2 * Buffer.byteLength(path) + ":(top,glob)".length + 2;
}

/** Keep each movement's source and target together, even at a batch boundary. */
function ordinaryPathBatches(
  facts: readonly GitReviewIndexGroupFact[]
): string[][] {
  const batches: string[][] = [];
  let paths = new Set<string>();
  let bytes = 0;
  for (const fact of facts) {
    const movementPaths =
      fact.oldPath === null
        ? [fact.targetPath]
        : [fact.oldPath, fact.targetPath];
    const additions = [...new Set(movementPaths)].filter(
      (path) => !paths.has(path)
    );
    const addedBytes = additions.reduce(
      (total, path) => total + pathspecBytes(path),
      0
    );
    if (
      paths.size > 0 &&
      (paths.size + additions.length > MAX_BATCH_PATHS ||
        bytes + addedBytes > MAX_BATCH_BYTES)
    ) {
      batches.push([...paths]);
      paths = new Set(movementPaths);
      bytes = [...paths].reduce(
        (total, path) => total + pathspecBytes(path),
        0
      );
    } else {
      for (const path of additions) paths.add(path);
      bytes += addedBytes;
    }
  }
  if (paths.size > 0) batches.push([...paths]);
  return batches;
}

export async function readGitReviewOrdinaryNumstat(options: {
  readonly execGitRaw: ExecGitRaw;
  readonly primary: GitReviewIndexPrimaryParseResult;
  readonly group: "staged" | "unstaged";
  readonly machineArgs: readonly string[];
  readonly canonicalRoot: string;
  readonly budget: GitReviewIndexExecutionBudget;
  readonly signal: AbortSignal | undefined;
}): Promise<GitReviewIndexStatParseResult> {
  const facts = options.primary.entries.flatMap((entry) => {
    const fact = entry.groupFacts[options.group];
    return fact !== undefined && fact.origin === "tracked" && fact.statsExpected
      ? [fact]
      : [];
  });
  const expectedOldPaths = new Map(
    facts.map((fact) => [fact.targetPath, fact.oldPath])
  );
  const parser = new GitReviewNumstatParser(options.group);
  for (const paths of ordinaryPathBatches(facts)) {
    await runGitReviewIndexParser(
      options.execGitRaw,
      [
        "diff",
        ...options.machineArgs,
        ...(options.group === "staged" ? ["--cached"] : []),
        "--numstat",
        "-z",
        "--",
        ...createGitReviewExactPathspecs(paths),
      ],
      options.canonicalRoot,
      options.budget,
      options.signal,
      (record) => parser.push(record)
    );
  }
  const parsed = parser.finish();
  // A shared copy source can appear in several batches. Only the primary
  // fact's exact movement is authoritative; retain its stat once.
  const seen = new Set<string>();
  return Object.freeze({
    digest: parsed.digest,
    stats: Object.freeze(
      parsed.stats.filter((stat) => {
        if (
          seen.has(stat.targetPath) ||
          !expectedOldPaths.has(stat.targetPath) ||
          expectedOldPaths.get(stat.targetPath) !== stat.oldPath
        )
          return false;
        seen.add(stat.targetPath);
        return true;
      })
    ),
  });
}
