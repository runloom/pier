import type { PeerSyncTarget } from "./shared.ts";

/** Minimal context surface needed to surface a peer-sync failure. */
export interface PeerSyncFailureNotifier {
  notifications: { error(message: string): void };
}

export type PeerSyncTranslate = (key: string, fallback: string) => string;

function isPeerSyncResults(
  value: unknown
): value is Array<{ error?: string; ok: boolean; target: string }> {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { ok?: unknown }).ok === "boolean" &&
        typeof (entry as { target?: unknown }).target === "string"
    )
  );
}

const TARGET_FALLBACK_LABELS: Record<PeerSyncTarget, string> = {
  omp: "OMP",
  opencode: "OpenCode",
  pi: "Pi",
};

/**
 * Surface partial peer-sync failures from an `accounts.select` result. The
 * user confirmed a checkbox action — a silently dropped failure would leave
 * the peer tool on the old account without any signal.
 *
 * `i18nPrefix` is the plugin id prefix (e.g. `"pier.codex"`); both official
 * account plugins share the same locale key shape below it.
 */
export function notifyPeerSyncFailures(options: {
  context: PeerSyncFailureNotifier;
  i18nPrefix: string;
  selectResult: unknown;
  t: PeerSyncTranslate;
}): void {
  const { context, i18nPrefix, selectResult, t } = options;
  if (!isPeerSyncResults(selectResult)) return;
  const failures = selectResult.filter((entry) => !entry.ok);
  if (failures.length === 0) return;
  const failedNames = failures
    .map((entry) => {
      const fallback =
        TARGET_FALLBACK_LABELS[entry.target as PeerSyncTarget] ?? entry.target;
      return t(`${i18nPrefix}.switch.syncTarget.${entry.target}`, fallback);
    })
    .join(", ");
  context.notifications.error(
    `${t(
      `${i18nPrefix}.accounts.settings.syncPeersFailed`,
      "Couldn't sync credentials to the selected tools. Try again after opening those tools once."
    )} (${failedNames})`
  );
}
