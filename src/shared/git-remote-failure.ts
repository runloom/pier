/**
 * Git 远程失败分类（main / renderer 共用）。
 * 只看 stderr/message 文本；不依赖 i18n。
 */
export type GitRemoteFailureKind =
  | "auth"
  | "generic"
  | "network"
  | "noRemote"
  | "noUpstream"
  | "rejected";

const NO_UPSTREAM_RE =
  /no tracking information|no upstream configured|There is no tracking information|No upstream is configured for the current branch/i;
const NO_REMOTE_RE = /No remote is configured|no remote/i;
const AUTH_RE =
  /terminal prompts disabled|authentication failed|could not read Username|host key verification failed|permission denied \(publickey|could not read Password|Permission denied \(publickey/i;
const NETWORK_RE =
  /Could not resolve host|Failed to connect|Connection timed out|Network is unreachable|Operation timed out|SSL_ERROR|Connection reset/i;
const REJECTED_RE =
  /\[rejected\]|non-fast-forward|fetch first|Updates were rejected/i;

export function classifyGitRemoteFailure(
  message: string
): GitRemoteFailureKind {
  if (NO_UPSTREAM_RE.test(message)) {
    return "noUpstream";
  }
  if (NO_REMOTE_RE.test(message)) {
    return "noRemote";
  }
  if (AUTH_RE.test(message)) {
    return "auth";
  }
  if (NETWORK_RE.test(message)) {
    return "network";
  }
  if (REJECTED_RE.test(message)) {
    return "rejected";
  }
  return "generic";
}

export function isAuthRemoteFailure(message: string): boolean {
  return classifyGitRemoteFailure(message) === "auth";
}
