/**
 * Pure path scoring + top-K selection for the Files path query.
 *
 * Kept dependency-free so both main and (potentially) renderer helpers can
 * exercise the same ranking. Design: docs/superpowers/specs/2026-07-17-files-path-query-and-quick-open-design.md §4.3
 *
 * Rules (locked in tests/unit/main/file-path-score.test.ts):
 * - `normalizeFilePathQuery`: trim, `\`→`/`, lower-case.
 * - Non-empty query: path must contain the normalized query (case-insensitive).
 *   - basename-contains-query: +1000
 *   - shallow-path: `-depth * 2` (segments above the file)
 *   - MRU hit: `(100 - mruIndex) * 10` (max +1000 for freshest)
 *   - earlier-input-index: sort-only tie-break (never baked into score)
 * - Sort: score desc, then path asc, then input index asc; slice to clamped `limit` (1..200).
 */
import {
  FILE_PATH_QUERY_LIMIT_DEFAULT,
  FILE_PATH_QUERY_LIMIT_MAX,
} from "@shared/contracts/file-query.ts";

const BASENAME_HIT_BONUS = 1000;
const DEPTH_PENALTY = 2;
const MRU_BONUS_MAX = 100;
const MRU_BONUS_WEIGHT = 10;
const SLASH_CHAR_CODE = 47;

export function normalizeFilePathQuery(query: string): string {
  return query.trim().replaceAll("\\", "/").toLowerCase();
}

/**
 * Score a single path against the query. Returns `null` when a non-empty query
 * has no substring match so callers can drop non-matches without a sentinel.
 * Empty query always scores.
 */
export function scoreFilePath(
  path: string,
  query: string,
  mruIndex: number | null
): number | null {
  const normalizedQuery = normalizeFilePathQuery(query);
  const lowerPath = path.toLowerCase();

  let score = 0;
  if (normalizedQuery.length > 0) {
    if (!lowerPath.includes(normalizedQuery)) return null;
    const lastSlash = lowerPath.lastIndexOf("/");
    const basename =
      lastSlash === -1 ? lowerPath : lowerPath.slice(lastSlash + 1);
    if (basename.includes(normalizedQuery)) score += BASENAME_HIT_BONUS;
  }

  let depth = 0;
  for (let i = 0; i < path.length; i += 1) {
    if (path.charCodeAt(i) === SLASH_CHAR_CODE) depth += 1;
  }
  score -= depth * DEPTH_PENALTY;

  if (mruIndex !== null && mruIndex >= 0 && mruIndex < MRU_BONUS_MAX) {
    score += (MRU_BONUS_MAX - mruIndex) * MRU_BONUS_WEIGHT;
  }

  return score;
}

export interface RankedFilePath {
  path: string;
  score: number;
}

/**
 * Rank paths against `query`, clamp to `limit`, and return the top-K.
 *
 * `mruPaths` is treated as an ordered "most-recent first" list; entries past
 * `MRU_BONUS_MAX` contribute no bonus but are otherwise scored normally.
 */
export function selectTopFilePaths(
  paths: readonly string[],
  query: string,
  mruPaths: readonly string[],
  limit: number
): RankedFilePath[] {
  const clampedLimit = Number.isFinite(limit)
    ? Math.min(Math.max(Math.trunc(limit), 1), FILE_PATH_QUERY_LIMIT_MAX)
    : FILE_PATH_QUERY_LIMIT_DEFAULT;

  const mruIndex = new Map<string, number>();
  for (let i = 0; i < mruPaths.length && i < MRU_BONUS_MAX; i += 1) {
    const entry = mruPaths[i];
    if (entry !== undefined && !mruIndex.has(entry)) mruIndex.set(entry, i);
  }

  const scored: (RankedFilePath & { inputIndex: number })[] = [];
  for (let i = 0; i < paths.length; i += 1) {
    const path = paths[i];
    if (path === undefined) continue;
    const mru = mruIndex.get(path);
    const base = scoreFilePath(path, query, mru === undefined ? null : mru);
    if (base === null) continue;
    // Keep pure score for callers; inputIndex is sort-only tie-break.
    scored.push({ inputIndex: i, path, score: base });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.path < b.path) return -1;
    if (a.path > b.path) return 1;
    return a.inputIndex - b.inputIndex;
  });

  const out: RankedFilePath[] = [];
  for (let i = 0; i < scored.length && out.length < clampedLimit; i += 1) {
    const entry = scored[i];
    if (entry === undefined) continue;
    out.push({ path: entry.path, score: entry.score });
  }
  return out;
}
