import type { Translate } from "./usage-meter.tsx";

/**
 * Map low-level account RPC / peer-sync failures to short user-facing copy.
 * Technical detail is intentionally collapsed — users should know what to do,
 * not how SQLite bound parameters failed.
 */
export function formatAccountError(err: unknown, t: Translate): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (
    lower.includes("unknown named parameter") ||
    lower.includes("omp database not found") ||
    /(^|;\s*)omp:/.test(raw)
  ) {
    return t(
      "pier.codex.accounts.settings.syncPeersFailedOmp",
      "Couldn't sync credentials to OMP. Make sure OMP is installed and has been opened at least once on this device."
    );
  }
  if (
    /(^|;\s*)opencode:/.test(raw) ||
    (lower.includes("opencode") && lower.includes("not found"))
  ) {
    return t(
      "pier.codex.accounts.settings.syncPeersFailedOpencode",
      "Couldn't sync credentials to OpenCode. Make sure OpenCode is installed on this device."
    );
  }
  if (
    /(^|;\s*)pi:/.test(raw) ||
    (lower.includes("pi ") && lower.includes("not found"))
  ) {
    return t(
      "pier.codex.accounts.settings.syncPeersFailedPi",
      "Couldn't sync credentials to Pi. Make sure Pi is installed on this device."
    );
  }
  if (lower.includes("no active managed account")) {
    return t(
      "pier.codex.accounts.settings.syncPeersFailedNoActive",
      "Select a managed Codex account first, then try syncing again."
    );
  }
  if (
    lower.includes("select at least one tool") ||
    lower.includes("at least one tool to sync")
  ) {
    return t(
      "pier.codex.accounts.settings.syncPeersFailedNoTargets",
      "Select at least one tool to sync."
    );
  }
  // Multi-target peer-sync aggregate errors look like "opencode: ...; pi: ...".
  if (/opencode:|pi:|omp:/.test(raw)) {
    return t(
      "pier.codex.accounts.settings.syncPeersFailed",
      "Couldn't sync credentials to the selected tools. Try again after opening those tools once."
    );
  }
  return raw;
}
