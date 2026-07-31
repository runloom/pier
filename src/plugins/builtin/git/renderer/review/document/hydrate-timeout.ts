/**
 * content 槽 demand 内水合超时（金标准 G2）。
 * @see docs/superpowers/specs/2026-07-31-git-review-gold-standard-endstate-design.md §5
 */
export const GIT_REVIEW_BODY_HYDRATE_TIMEOUT_MS = 8000;

export type HydrateTimeoutResourceKind =
  | "idle"
  | "loading"
  | "cancelling"
  | "loaded"
  | "error"
  | "unchanged";

/**
 * 跟踪「进入 demand 且仍未终态」的 entry，超时后回调。
 * 终态：loaded / error（unchanged 视为已有 soft body，不算超时目标）。
 */
export function createHydrateTimeoutWatchdog(options?: {
  readonly now?: () => number;
  readonly timeoutMs?: number;
}): {
  readonly clear: () => void;
  readonly noteDemanded: (
    entryKeys: Iterable<string>,
    kindOf: (entryKey: string) => HydrateTimeoutResourceKind | undefined
  ) => readonly string[];
} {
  const timeoutMs = options?.timeoutMs ?? GIT_REVIEW_BODY_HYDRATE_TIMEOUT_MS;
  const now = options?.now ?? Date.now;
  /** entryKey → first demanded while pending ms */
  const pendingSince = new Map<string, number>();

  return {
    clear: () => {
      pendingSince.clear();
    },
    noteDemanded: (entryKeys, kindOf) => {
      const demanded = new Set(entryKeys);
      const timedOut: string[] = [];
      const t = now();
      for (const entryKey of [...pendingSince.keys()]) {
        if (!demanded.has(entryKey)) {
          pendingSince.delete(entryKey);
        }
      }
      for (const entryKey of demanded) {
        const kind = kindOf(entryKey);
        if (
          kind === undefined ||
          kind === "loaded" ||
          kind === "error" ||
          kind === "unchanged"
        ) {
          pendingSince.delete(entryKey);
          continue;
        }
        // idle / loading / cancelling
        let since = pendingSince.get(entryKey);
        if (since === undefined) {
          since = t;
          pendingSince.set(entryKey, since);
        }
        if (t - since >= timeoutMs) {
          timedOut.push(entryKey);
          pendingSince.delete(entryKey);
        }
      }
      return timedOut;
    },
  };
}
