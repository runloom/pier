import { GitExecError } from "./exec.ts";
import { combinedGitErrorOutput, unavailable } from "./operation-helpers.ts";

/**
 * push / pull / publish / fetch / sync may run local hooks (pre-push etc.).
 * 60s write timeout kills those mid-run and surfaces partial pnpm `$ cmd` noise.
 * 20 min covers heavy monorepo gates without becoming unbounded.
 */
export const REMOTE_WRITE_TIMEOUT_MS = 20 * 60 * 1000;

const DETAIL_MAX = 1800;

const NO_UPSTREAM_RE =
  /no upstream|has no upstream|set the remote as upstream|The current branch .+ has no upstream/i;
/** Server-side rejections — must not be framed as local hooks. */
const REMOTE_REJECTED_RE =
  /remote rejected|pre-receive hook|!\s*\[remote rejected\]|remote:\s*error:/i;
/**
 * Local-only hook markers. Avoid bare "hook declined" / "hook failure" —
 * those appear in server pre-receive output and mislead product copy.
 */
const LOCAL_HOOK_FAIL_RE =
  /husky - |\.husky\/|preflight(?:-ci)?|pre-push script failed|pre-commit script failed/i;

/** Stable prefixes so renderer `classifyGitRemoteFailure` / product copy can match. */
const TIMEOUT_MESSAGE =
  "Git operation timed out (local checks or remote transfer may still be running)";
const HOOK_MESSAGE = "A local Git hook rejected or stopped this operation";

function capTail(text: string, maxLength = DETAIL_MAX): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `…${trimmed.slice(-(maxLength - 1))}`;
}

function rawDetail(error: GitExecError): string {
  const combined = combinedGitErrorOutput(error).trim();
  if (combined.length > 0) {
    return capTail(combined);
  }
  return capTail(error.message);
}

function looksLikeLocalHookFailure(
  error: GitExecError,
  detail: string
): boolean {
  if (error.hookSignal !== null) {
    return true;
  }
  if (
    REMOTE_REJECTED_RE.test(detail) ||
    REMOTE_REJECTED_RE.test(error.message)
  ) {
    return false;
  }
  return (
    LOCAL_HOOK_FAIL_RE.test(detail) || LOCAL_HOOK_FAIL_RE.test(error.message)
  );
}

function withDetail(summary: string, detail: null | string): string {
  if (!(detail && detail.length > 0)) {
    return summary;
  }
  if (detail === summary || detail.includes(summary)) {
    return detail;
  }
  return `${summary}\n\n${detail}`;
}

/**
 * Classify remote git failures into a single user-facing message (tail preferred).
 * Reason codes stay local; contract only carries `message`.
 */
export function classifyRemoteGitError(error: unknown): {
  message: null | string;
  reason: "generic" | "hook" | "no_upstream" | "timeout";
} {
  if (!(error instanceof GitExecError)) {
    const text =
      error instanceof Error ? error.message.trim() : String(error).trim();
    return {
      message: text.length > 0 ? capTail(text) : null,
      reason: "generic",
    };
  }

  if (error.causeKind === "timeout") {
    const detail = rawDetail(error);
    return {
      message: withDetail(TIMEOUT_MESSAGE, detail.length > 0 ? detail : null),
      reason: "timeout",
    };
  }

  const detail = rawDetail(error);
  if (looksLikeLocalHookFailure(error, detail)) {
    const combined = combinedGitErrorOutput(error).trim();
    let hookDetail: null | string;
    if (combined.length > 0) {
      hookDetail = capTail(combined);
    } else if (error.hookSignal !== null) {
      hookDetail = error.hookSignal.hookPath;
    } else if (detail.length > 0) {
      hookDetail = detail;
    } else {
      hookDetail = null;
    }
    return {
      message: withDetail(HOOK_MESSAGE, hookDetail),
      reason: "hook",
    };
  }

  if (NO_UPSTREAM_RE.test(detail) || NO_UPSTREAM_RE.test(error.message)) {
    return {
      message: detail.length > 0 ? detail : null,
      reason: "no_upstream",
    };
  }

  return {
    message: detail.length > 0 ? detail : null,
    reason: "generic",
  };
}

export function remoteUnavailable(error: unknown): {
  kind: "unavailable";
  message: null | string;
} {
  const classified = classifyRemoteGitError(error);
  return unavailable(classified.message ?? undefined);
}
