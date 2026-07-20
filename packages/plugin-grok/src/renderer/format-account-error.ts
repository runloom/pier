export type Translate = (key: string, fallback: string) => string;

/**
 * Map low-level account RPC / peer-sync failures to short user-facing copy.
 */
export function formatAccountError(err: unknown, t: Translate): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (lower.includes("no rpc handler registered")) {
    return t(
      "pier.grok.errors.pluginNotReady",
      "Grok plugin is still starting — try again in a moment"
    );
  }
  if (
    lower.includes("grok cli not found") ||
    (lower.includes("enoent") && lower.includes("grok"))
  ) {
    return t("pier.grok.errors.cliNotFound", "Grok CLI not found on PATH");
  }
  if (
    lower.includes("login cancelled") ||
    (err instanceof Error && err.name === "AbortError")
  ) {
    return t("pier.grok.errors.loginCancelled", "Login cancelled");
  }
  if (lower.includes("login timed out")) {
    return t("pier.grok.errors.loginTimedOut", "Login timed out");
  }
  if (lower.includes("no identity found")) {
    return t(
      "pier.grok.errors.noIdentity",
      "Login completed but no identity found"
    );
  }
  if (
    lower.includes("no valid grok login") ||
    lower.includes("no valid login found at auth.json")
  ) {
    return t(
      "pier.grok.errors.noLocalLogin",
      "No valid local Grok login found. Sign in with the Grok CLI first."
    );
  }
  if (
    lower.includes("api key accounts cannot report") ||
    lower.includes("cannot report grok quota")
  ) {
    return t(
      "pier.grok.errors.apiKeyQuotaUnsupported",
      "API key accounts cannot report Grok quota — switch to an OIDC account"
    );
  }
  if (
    lower.includes("session expired") ||
    lower.includes("re-login required") ||
    lower.includes("invalid_grant") ||
    lower.includes("refresh token")
  ) {
    return t(
      "pier.grok.errors.sessionExpired",
      "Grok session expired — re-login required"
    );
  }
  if (
    lower.includes("cannot access billing") ||
    lower.includes("access_denied") ||
    lower.includes("insufficient_permissions") ||
    lower.includes("insufficient_scope")
  ) {
    return t(
      "pier.grok.errors.accessDenied",
      "This Grok account cannot access billing for this product."
    );
  }
  if (
    lower.includes("billing request timed out") ||
    lower.includes("billing request failed") ||
    lower.includes("no grok quota windows") ||
    lower.includes("session token missing")
  ) {
    return t(
      "pier.grok.errors.billingUnavailable",
      "Could not load Grok quota. Try refresh, or re-login if the session expired."
    );
  }
  if (
    lower.includes("unknown named parameter") ||
    lower.includes("omp database not found") ||
    /(^|;\s*)omp:/.test(raw)
  ) {
    return t(
      "pier.grok.accounts.settings.syncPeersFailedOmp",
      "Couldn't sync credentials to OMP. Make sure OMP is installed and has been opened at least once on this device."
    );
  }
  if (
    /(^|;\s*)opencode:/.test(raw) ||
    (lower.includes("opencode") && lower.includes("not found"))
  ) {
    return t(
      "pier.grok.accounts.settings.syncPeersFailedOpencode",
      "Couldn't sync credentials to OpenCode. Make sure OpenCode is installed on this device."
    );
  }
  if (
    /(^|;\s*)pi:/.test(raw) ||
    lower.includes("pi does not support xai oauth") ||
    (lower.includes("pi ") && lower.includes("not found"))
  ) {
    return t(
      "pier.grok.accounts.settings.syncPeersFailedPi",
      "Couldn't sync credentials to Pi. Make sure Pi is installed on this device. For login accounts, Pi needs a Grok API-key account (or XAI_API_KEY) because it has no xAI OAuth support."
    );
  }
  if (lower.includes("no active managed account")) {
    return t(
      "pier.grok.accounts.settings.syncPeersFailedNoActive",
      "Select a managed Grok account first, then try syncing again."
    );
  }
  if (
    lower.includes("select at least one tool") ||
    lower.includes("at least one tool to sync")
  ) {
    return t(
      "pier.grok.accounts.settings.syncPeersFailedNoTargets",
      "Select at least one tool to sync."
    );
  }
  if (/opencode:|pi:|omp:/.test(raw)) {
    return t(
      "pier.grok.accounts.settings.syncPeersFailed",
      "Couldn't sync credentials to the selected tools. Try again after opening those tools once."
    );
  }
  return raw;
}
