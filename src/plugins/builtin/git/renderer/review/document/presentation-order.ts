import type {
  GitReviewFileStatus,
  GitReviewGroup,
  GitReviewIndexEntry,
} from "@shared/contracts/git/review.ts";
import { GIT_REVIEW_PRESENTATION_GROUP_ORDER } from "../surface-group.ts";
import { compareReviewTreePaths } from "./tree-path-order.ts";

type ReviewSlot = GitReviewIndexEntry["renderSlots"][number];

/**
 * One presentation row: repo path + the path key the sidebar tree actually
 * feeds to `@pierre/trees` (collision display rewrite included).
 *
 * Tree, CodeView, demand, and comment nav must share this list — do not
 * re-sort by bare `entry.path` / `localeCompare`.
 *
 * Collision geometry always considers **all** in-group slots first; optional
 * `includeSlot` only filters the ordered result (content subsequence keeps
 * tree-relative order).
 */
export interface ReviewPresentationSlot {
  /** Tree-relative path under the group root (may be a collision display path). */
  readonly displayPath: string;
  readonly entry: GitReviewIndexEntry;
  readonly entryKey: string;
  readonly group: GitReviewGroup;
  /** Repo-relative target path (`slot.targetPath`). */
  readonly path: string;
  readonly sectionKey: string;
  readonly slot: ReviewSlot;
  readonly status: GitReviewFileStatus;
}

/** English fallback — same string as `ui.reviewFilePathCollision` en locale. */
export function defaultReviewCollidingFileLabel(name: string): string {
  return `File change · ${name}`;
}

export interface OrderReviewPresentationSlotsOptions {
  /**
   * Must match the sidebar tree label factory (i18n). Defaults to the English
   * product fallback so unit tests stay deterministic.
   */
  readonly collidingFileLabel?: (name: string) => string;
  /** When set, only these groups (still emitted in presentation group order). */
  readonly groups?: readonly GitReviewGroup[];
  /**
   * Applied **after** collision + sort (e.g. content-bearing body only).
   * Never used as input to directory/collision geometry — that always sees
   * every slot in the selected groups.
   */
  readonly includeSlot?: (slot: ReviewSlot) => boolean;
}

/**
 * Canonical Git review file order: presentation groups, then
 * `@pierre/trees`-compatible path order on **display** paths (dirs-first DFS).
 */
export function orderReviewPresentationSlots(
  entries: readonly GitReviewIndexEntry[],
  options: OrderReviewPresentationSlotsOptions = {}
): readonly ReviewPresentationSlot[] {
  const collidingFileLabel =
    options.collidingFileLabel ?? defaultReviewCollidingFileLabel;
  const groupAllow =
    options.groups === undefined
      ? null
      : new Set<GitReviewGroup>(options.groups);
  const includeSlot = options.includeSlot;

  const rowsByGroup = new Map<GitReviewGroup, MutableRow[]>();
  for (const group of GIT_REVIEW_PRESENTATION_GROUP_ORDER) {
    if (groupAllow !== null && !groupAllow.has(group)) {
      continue;
    }
    rowsByGroup.set(group, []);
  }

  // Collect every slot in the group set first so meta/notice paths still
  // participate in collision / directory-prefix geometry.
  for (const entry of entries) {
    for (const slot of entry.renderSlots) {
      if (groupAllow !== null && !groupAllow.has(slot.group)) {
        continue;
      }
      const bucket = rowsByGroup.get(slot.group);
      if (bucket === undefined) {
        continue;
      }
      bucket.push({
        entry,
        entryKey: entry.entryKey,
        group: slot.group,
        path: slot.targetPath,
        sectionKey: slot.sectionKey,
        slot,
        status: slot.status,
      });
    }
  }

  const ordered: ReviewPresentationSlot[] = [];
  for (const group of GIT_REVIEW_PRESENTATION_GROUP_ORDER) {
    const rows = rowsByGroup.get(group);
    if (rows === undefined || rows.length === 0) {
      continue;
    }
    ordered.push(...orderGroupRows(rows, collidingFileLabel));
  }

  if (includeSlot === undefined) {
    return ordered;
  }
  return ordered.filter((row) => includeSlot(row.slot));
}

/**
 * First-seen entryKey sequence from presentation order (hydrate / demand).
 * Half-staged paths appear once, at their first group slot.
 */
export function reviewPresentationEntryKeysInOrder(
  slots: readonly ReviewPresentationSlot[]
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const slot of slots) {
    if (seen.has(slot.entryKey)) {
      continue;
    }
    seen.add(slot.entryKey);
    keys.push(slot.entryKey);
  }
  return keys;
}

interface MutableRow {
  entry: GitReviewIndexEntry;
  entryKey: string;
  group: GitReviewGroup;
  path: string;
  sectionKey: string;
  slot: ReviewSlot;
  status: GitReviewFileStatus;
}

function orderGroupRows(
  rows: readonly MutableRow[],
  collidingFileLabel: (name: string) => string
): ReviewPresentationSlot[] {
  const reservedPaths = new Set(rows.map((row) => row.path));
  const directoryPaths = new Set<string>();
  for (const row of rows) {
    for (const directory of ancestorDirectories(row.path)) {
      directoryPaths.add(directory);
      reservedPaths.add(directory);
    }
  }

  const withDisplay: ReviewPresentationSlot[] = rows.map((row) => ({
    displayPath: directoryPaths.has(row.path)
      ? collidingFileDisplayPath(row.path, collidingFileLabel, reservedPaths)
      : row.path,
    entry: row.entry,
    entryKey: row.entryKey,
    group: row.group,
    path: row.path,
    sectionKey: row.sectionKey,
    slot: row.slot,
    status: row.status,
  }));

  return withDisplay.toSorted((left, right) => {
    const byPath = compareReviewTreePaths(left.displayPath, right.displayPath);
    if (byPath !== 0) {
      return byPath;
    }
    return left.sectionKey.localeCompare(right.sectionKey);
  });
}

export function ancestorDirectories(path: string): string[] {
  const directories: string[] = [];
  let cursor = 0;
  while (true) {
    const slash = path.indexOf("/", cursor);
    if (slash < 0) {
      return directories;
    }
    directories.push(path.slice(0, slash));
    cursor = slash + 1;
  }
}

export function collidingFileDisplayPath(
  path: string,
  collidingFileLabel: (name: string) => string,
  reservedPaths: Set<string>
): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const label = collidingFileLabel(name).replaceAll("/", "∕");
  let candidate = `${path}/${label}`;
  let suffix = 2;
  while (reservedPaths.has(candidate)) {
    candidate = `${path}/${label} ${suffix}`;
    suffix += 1;
  }
  reservedPaths.add(candidate);
  return candidate;
}
