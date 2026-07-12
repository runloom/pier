import type { OfficialPluginEntry } from "@shared/contracts/managed-plugin.ts";
import { rcompare, satisfies, valid, validRange } from "semver";

/**
 * semver wrappers used by managed plugin install service. Delegates to the
 * `semver` package for correctness (never a hand-rolled range parser).
 */

export function compareSemver(a: string, b: string): number {
  return rcompare(a, b);
}

/** 返回候选中的最高合法语义版本；无合法版本时返回 null。 */
export function selectNewestVersion(
  versions: readonly (string | null | undefined)[]
): string | null {
  const candidates = versions.filter(
    (version): version is string =>
      typeof version === "string" && !!valid(version)
  );
  candidates.sort(rcompare);
  return candidates[0] ?? null;
}

export function isPierRangeCompatible(
  range: string,
  pierVersion: string
): boolean {
  if (!validRange(range)) {
    return false;
  }
  if (!valid(pierVersion)) {
    return false;
  }
  return satisfies(pierVersion, range, { includePrerelease: false });
}

/**
 * Returns the highest version in `versions` whose `pier` range accepts
 * `pierVersion`, or `null` if none match.
 */
export function selectLatestCompatibleVersion(
  entry: OfficialPluginEntry,
  pierVersion: string
): { version: string; entry: OfficialPluginEntry["versions"][string] } | null {
  const compatible = Object.entries(entry.versions).filter(([, verEntry]) =>
    isPierRangeCompatible(verEntry.pier, pierVersion)
  );
  if (compatible.length === 0) {
    return null;
  }
  compatible.sort(([a], [b]) => rcompare(a, b));
  const top = compatible[0];
  if (!top) {
    return null;
  }
  return { version: top[0], entry: top[1] };
}
