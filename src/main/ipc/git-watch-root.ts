import { gitReviewRootPathSchema } from "@shared/contracts/git-review.ts";
import { execGit, type GitExecOptions } from "../services/git-exec.ts";
import { parseGitSinglePathOutput } from "../services/git-path-output.ts";
import {
  type WatchFileSystemProbe,
  watchRealpathProbe,
} from "../services/git-watch-file-system.ts";

const GIT_WATCH_ROOT_FILE_SYSTEM_TIMEOUT_MS = 1500;
const GIT_WATCH_ROOT_GIT_TIMEOUT_MS = 5000;
const GIT_WATCH_ROOT_MAX_OUTPUT_BYTES = 65_536;

type GitWatchRootExec = (
  args: readonly string[],
  options: GitExecOptions
) => Promise<string>;
type GitWatchRootRealpathProbe = (
  path: string,
  context: { readonly signal?: AbortSignal; readonly timeoutMs?: number }
) => WatchFileSystemProbe<string>;

type GitWatchRootResolutionTracker = (operation: Promise<void>) => void;

export function createCanonicalGitWatchRootResolver({
  execute = execGit,
  realpathProbe = watchRealpathProbe,
}: {
  readonly execute?: GitWatchRootExec;
  readonly realpathProbe?: GitWatchRootRealpathProbe;
} = {}): (
  rawRoot: unknown,
  signal?: AbortSignal,
  trackRawOperation?: GitWatchRootResolutionTracker
) => Promise<string | null> {
  return async (rawRoot, signal, trackRawOperation) => {
    const parsed = gitReviewRootPathSchema.safeParse(rawRoot);
    if (!parsed.success || signal?.aborted) {
      return null;
    }
    const context = {
      ...(signal === undefined ? {} : { signal }),
      timeoutMs: GIT_WATCH_ROOT_FILE_SYSTEM_TIMEOUT_MS,
    };
    try {
      const requestProbe = realpathProbe(parsed.data, context);
      trackRawOperation?.(requestProbe.settled);
      const requestRoot = await requestProbe.result;
      const reportedRoot = parseGitSinglePathOutput(
        await execute(
          ["rev-parse", "--path-format=absolute", "--show-toplevel"],
          {
            cwd: requestRoot,
            maxOutputBytes: GIT_WATCH_ROOT_MAX_OUTPUT_BYTES,
            ...(signal === undefined ? {} : { signal }),
            timeoutMs: GIT_WATCH_ROOT_GIT_TIMEOUT_MS,
          }
        )
      );
      if (reportedRoot === null) {
        return null;
      }
      const reported = gitReviewRootPathSchema.safeParse(reportedRoot);
      if (!reported.success || signal?.aborted) {
        return null;
      }
      const reportedProbe = realpathProbe(reported.data, context);
      trackRawOperation?.(reportedProbe.settled);
      return await reportedProbe.result;
    } catch {
      return null;
    }
  };
}

export const resolveCanonicalGitWatchRoot =
  createCanonicalGitWatchRootResolver();
