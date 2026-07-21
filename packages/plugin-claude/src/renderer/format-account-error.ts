export type Translate = (key: string, fallback: string) => string;

/**
 * Map low-level Claude account RPC failures to short user-facing copy.
 */
export function formatAccountError(err: unknown, t: Translate): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (lower.includes("no rpc handler registered")) {
    return t(
      "pier.claude.errors.pluginNotReady",
      "Claude plugin is still starting — try again in a moment"
    );
  }
  if (
    lower.includes("no valid claude login") ||
    lower.includes("no valid login found")
  ) {
    return t(
      "pier.claude.errors.noLocalLogin",
      "No valid local Claude login found. Sign in with the Claude CLI first."
    );
  }
  if (lower.includes("could not capture the current claude credential")) {
    return t(
      "pier.claude.errors.captureFailed",
      "Couldn't capture the current Claude login. Try signing in again with the Claude CLI."
    );
  }
  if (
    lower.includes("no stored claude credential") ||
    lower.includes("stored credential is missing") ||
    lower.includes("credential is invalid")
  ) {
    return t(
      "pier.claude.errors.credentialMissing",
      "This account's stored credential is missing — remove it and import again."
    );
  }
  if (lower.includes("no active claude account")) {
    return t(
      "pier.claude.errors.noActiveAccount",
      "No active account — add or switch to a Claude account first"
    );
  }
  if (lower.includes("re-authorize in the browser")) {
    return t(
      "pier.claude.errors.reAuthorize",
      "Claude login could not be completed — open the authorization page again and paste the new code"
    );
  }
  if (
    lower.includes("login cancelled") ||
    (err instanceof Error && err.name === "AbortError")
  ) {
    return t("pier.claude.errors.loginCancelled", "Login cancelled");
  }
  if (lower.includes("no claude login in progress")) {
    return t(
      "pier.claude.errors.noLoginInProgress",
      "The login expired — start again from Add account"
    );
  }
  if (lower.includes("authorization code is empty")) {
    return t(
      "pier.claude.errors.emptyCode",
      "Paste the authorization code from the browser first"
    );
  }
  if (
    lower.includes("oauth token request failed") ||
    lower.includes("missing access_token")
  ) {
    return t(
      "pier.claude.errors.codeExchangeFailed",
      "Could not verify the authorization code — copy it again and retry"
    );
  }
  if (
    lower.includes("session expired") ||
    lower.includes("sign in again") ||
    lower.includes("invalid_grant")
  ) {
    return t(
      "pier.claude.errors.sessionExpired",
      "Claude session expired — sign in again"
    );
  }
  if (lower.includes("rate limited")) {
    return t(
      "pier.claude.errors.usageRateLimited",
      "Claude usage is rate limited — try again later"
    );
  }
  if (lower.includes("usage request timed out")) {
    return t(
      "pier.claude.errors.usageTimeout",
      "Claude usage request timed out"
    );
  }
  return raw;
}
