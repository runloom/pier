import { createHash } from "node:crypto";
import {
  GIT_REVIEW_GROUP_ORDER,
  GIT_REVIEW_STATUS_PRIORITY,
  type GitReviewGroup,
  type GitReviewIndexEntry,
  type GitReviewResolvedQuery,
  type GitReviewWarning,
  gitReviewIndexEntrySchema,
} from "../../../shared/contracts/git-review.ts";
import {
  GIT_REVIEW_INDEX_ENTRY_LIMIT,
  GIT_REVIEW_RENAME_LIMIT,
  type GitReviewIndexExecutionBudget,
  GitReviewIndexExecutionError,
  type GitReviewIndexGroupFact,
  type GitReviewIndexPrimaryParseResult,
  GitReviewIndexProtocolError,
  type GitReviewIndexStatEntry,
  type GitReviewIndexStatParseResult,
} from "./git-review-index-contract.ts";
import { GitReviewRecordDigest } from "./git-review-index-protocol.ts";

export interface AssembleGitReviewIndexOptions {
  readonly budget: GitReviewIndexExecutionBudget;
  readonly primary: GitReviewIndexPrimaryParseResult;
  readonly query: GitReviewResolvedQuery;
  readonly renameDetectionLimited: boolean;
  readonly statsByGroup: Readonly<
    Partial<Record<GitReviewGroup, GitReviewIndexStatParseResult>>
  >;
}

export interface AssembledGitReviewIndex {
  readonly entries: readonly GitReviewIndexEntry[];
  readonly resolvedEntries: readonly GitReviewIndexResolvedEntry[];
  readonly revision: string;
  readonly warnings: readonly GitReviewWarning[];
}

export interface GitReviewIndexResolvedEntry {
  readonly groupFacts: Readonly<
    Partial<Record<GitReviewGroup, GitReviewIndexGroupFact>>
  >;
  readonly path: string;
}

interface MutableMergedEntry {
  readonly groupFacts: Partial<Record<GitReviewGroup, GitReviewIndexGroupFact>>;
  readonly path: string;
}

interface SortableEntry {
  readonly entry: GitReviewIndexEntry;
  readonly groupFacts: Readonly<
    Partial<Record<GitReviewGroup, GitReviewIndexGroupFact>>
  >;
  readonly path: string;
  readonly sortKey: Buffer;
}

export function assembleGitReviewIndex({
  budget,
  primary,
  query,
  renameDetectionLimited,
  statsByGroup,
}: AssembleGitReviewIndexOptions): AssembledGitReviewIndex {
  const allowedGroups = allowedGroupsForQuery(query);
  const allGroups = new Set<GitReviewGroup>(GIT_REVIEW_GROUP_ORDER);
  const allMerged =
    query.kind === "uncommitted"
      ? mergePrimaryEntries(primary, allGroups, query)
      : null;
  const sourceFilesTruncated =
    primary.truncated ||
    (allMerged !== null && allMerged.size > GIT_REVIEW_INDEX_ENTRY_LIMIT);
  const merged =
    allMerged !== null &&
    query.kind === "uncommitted" &&
    query.groups.length === 2
      ? allMerged
      : mergePrimaryEntries(primary, allowedGroups, query);

  const statMaps = createStatMaps(statsByGroup, merged);
  let statsUnavailable = 0;
  const sortable: SortableEntry[] = [];
  for (const mergedEntry of merged.values()) {
    const groups = GIT_REVIEW_GROUP_ORDER.filter(
      (group) => mergedEntry.groupFacts[group] !== undefined
    );
    const groupStatuses: Partial<
      Record<GitReviewGroup, GitReviewIndexEntry["status"]>
    > = {};
    const oldPaths: string[] = [];
    let additions = 0;
    let deletions = 0;
    let hasCompleteNumericStats = true;
    let entryStatsMissing = false;
    for (const group of groups) {
      const fact = mergedEntry.groupFacts[group];
      if (fact === undefined) {
        continue;
      }
      groupStatuses[group] = fact.status;
      if (fact.oldPath !== null && !oldPaths.includes(fact.oldPath)) {
        oldPaths.push(fact.oldPath);
      }
      if (!fact.statsExpected) {
        hasCompleteNumericStats = false;
        continue;
      }
      const stat = statMaps[group]?.get(fact.targetPath);
      if (stat === undefined || !statMatchesFact(stat, fact)) {
        hasCompleteNumericStats = false;
        entryStatsMissing = true;
        continue;
      }
      if (stat.additions === null || stat.deletions === null) {
        hasCompleteNumericStats = false;
        continue;
      }
      additions = addSafeCount(additions, stat.additions);
      deletions = addSafeCount(deletions, stat.deletions);
    }
    if (entryStatsMissing) {
      statsUnavailable += 1;
    }
    const status = GIT_REVIEW_STATUS_PRIORITY.find((candidate) =>
      Object.values(groupStatuses).includes(candidate)
    );
    if (status === undefined) {
      throw new GitReviewIndexProtocolError("Git index 条目缺少状态");
    }
    const entry = gitReviewIndexEntrySchema.parse({
      additions: hasCompleteNumericStats ? additions : null,
      deletions: hasCompleteNumericStats ? deletions : null,
      entryKey: entryKeyForPath(mergedEntry.path),
      groups,
      groupStatuses,
      oldPaths,
      path: mergedEntry.path,
      status,
    });
    sortable.push({
      entry,
      groupFacts: mergedEntry.groupFacts,
      path: mergedEntry.path,
      sortKey: Buffer.from(entry.path, "utf8"),
    });
  }
  sortable.sort((left, right) => Buffer.compare(left.sortKey, right.sortKey));

  const entries: GitReviewIndexEntry[] = [];
  const resolvedEntries: GitReviewIndexResolvedEntry[] = [];
  let fileBudgetTruncated = false;
  for (const item of sortable) {
    if (!budget.tryConsumeFiles()) {
      const failure = budget.failureReason();
      if (failure !== null) {
        throw new GitReviewIndexExecutionError(failure, `Git index ${failure}`);
      }
      fileBudgetTruncated = true;
      break;
    }
    entries.push(item.entry);
    resolvedEntries.push(
      Object.freeze({
        groupFacts: Object.freeze({ ...item.groupFacts }),
        path: item.path,
      })
    );
  }
  const warnings: GitReviewWarning[] = [];
  if (sourceFilesTruncated || fileBudgetTruncated) {
    warnings.push({
      code: "filesTruncated",
      limit: fileBudgetTruncated
        ? Math.min(GIT_REVIEW_INDEX_ENTRY_LIMIT, entries.length)
        : GIT_REVIEW_INDEX_ENTRY_LIMIT,
      omitted: null,
    });
  }
  if (primary.invalidPathEntries > 0) {
    warnings.push({
      code: "invalidPathEncoding",
      skipped: primary.invalidPathEntries,
    });
  }
  if (renameDetectionLimited) {
    warnings.push({
      code: "renameDetectionLimited",
      limit: GIT_REVIEW_RENAME_LIMIT,
    });
  }
  if (statsUnavailable > 0) {
    warnings.push({ code: "entryStatsUnavailable", count: statsUnavailable });
  }

  return Object.freeze({
    entries: Object.freeze(entries),
    resolvedEntries: Object.freeze(resolvedEntries),
    revision: createIndexRevision(query, primary, statsByGroup),
    warnings: Object.freeze(warnings),
  });
}

function mergePrimaryEntries(
  primary: GitReviewIndexPrimaryParseResult,
  allowedGroups: ReadonlySet<GitReviewGroup>,
  query: GitReviewResolvedQuery
): Map<string, MutableMergedEntry> {
  const merged = new Map<string, MutableMergedEntry>();
  for (const observation of primary.entries) {
    const selectedFacts: Partial<
      Record<GitReviewGroup, GitReviewIndexGroupFact>
    > = {};
    for (const group of GIT_REVIEW_GROUP_ORDER) {
      const fact = observation.groupFacts[group];
      if (fact !== undefined && allowedGroups.has(group)) {
        selectedFacts[group] = fact;
      }
    }
    if (Object.keys(selectedFacts).length === 0) {
      continue;
    }
    const existing = merged.get(observation.path);
    if (existing === undefined) {
      merged.set(observation.path, {
        groupFacts: selectedFacts,
        path: observation.path,
      });
      continue;
    }
    for (const [group, fact] of Object.entries(selectedFacts) as [
      GitReviewGroup,
      GitReviewIndexGroupFact,
    ][]) {
      if (existing.groupFacts[group] !== undefined) {
        throw new GitReviewIndexProtocolError(
          `Git index 返回了重复的 ${group} 路径`
        );
      }
      existing.groupFacts[group] = fact;
    }
  }
  mergeUncommittedRenameChains(merged, query);
  return merged;
}

function mergeUncommittedRenameChains(
  entries: Map<string, MutableMergedEntry>,
  query: GitReviewResolvedQuery
): void {
  if (query.kind !== "uncommitted") {
    return;
  }
  const destinationsByOldPath = new Map<string, MutableMergedEntry[]>();
  for (const entry of entries.values()) {
    const groups = Object.keys(entry.groupFacts) as GitReviewGroup[];
    const unstaged = entry.groupFacts.unstaged;
    if (
      groups.length !== 1 ||
      unstaged?.movement !== "rename" ||
      unstaged.oldPath === null
    ) {
      continue;
    }
    const destinations = destinationsByOldPath.get(unstaged.oldPath) ?? [];
    destinations.push(entry);
    destinationsByOldPath.set(unstaged.oldPath, destinations);
  }
  for (const [oldPath, destinations] of destinationsByOldPath) {
    if (destinations.length !== 1) {
      continue;
    }
    const destination = destinations[0];
    const source = entries.get(oldPath);
    if (destination === undefined || source === undefined) {
      continue;
    }
    const sourceGroups = Object.keys(source.groupFacts) as GitReviewGroup[];
    const staged = source.groupFacts.staged;
    if (
      sourceGroups.length !== 1 ||
      staged === undefined ||
      staged.targetPath !== source.path
    ) {
      continue;
    }
    destination.groupFacts.staged = staged;
    entries.delete(source.path);
  }
}

function allowedGroupsForQuery(
  query: GitReviewResolvedQuery
): Set<GitReviewGroup> {
  if (query.kind === "uncommitted") {
    return new Set<GitReviewGroup>([...query.groups, "conflict"]);
  }
  return new Set<GitReviewGroup>([query.kind]);
}

function createStatMaps(
  statsByGroup: Readonly<
    Partial<Record<GitReviewGroup, GitReviewIndexStatParseResult>>
  >,
  merged: ReadonlyMap<string, MutableMergedEntry>
): Partial<Record<GitReviewGroup, Map<string, GitReviewIndexStatEntry>>> {
  const result: Partial<
    Record<GitReviewGroup, Map<string, GitReviewIndexStatEntry>>
  > = {};
  for (const group of GIT_REVIEW_GROUP_ORDER) {
    const parsed = statsByGroup[group];
    if (parsed === undefined) {
      continue;
    }
    const expectedPaths = new Set<string>();
    for (const mergedEntry of merged.values()) {
      const fact = mergedEntry.groupFacts[group];
      if (fact?.statsExpected) {
        expectedPaths.add(fact.targetPath);
      }
    }
    const map = new Map<string, GitReviewIndexStatEntry>();
    for (const entry of parsed.entries) {
      if (!expectedPaths.has(entry.path)) {
        continue;
      }
      if (map.has(entry.path)) {
        throw new GitReviewIndexProtocolError(
          `numstat 返回了重复的 ${group} 路径`
        );
      }
      map.set(entry.path, entry);
    }
    result[group] = map;
  }
  return result;
}

function statMatchesFact(
  stat: GitReviewIndexStatEntry,
  fact: GitReviewIndexGroupFact
): boolean {
  return fact.status === "renamed"
    ? stat.oldPath === fact.oldPath
    : stat.oldPath === null;
}

function addSafeCount(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new GitReviewIndexProtocolError("Git index 统计超过安全整数上限");
  }
  return result;
}

function entryKeyForPath(path: string): string {
  return `sha256:${createHash("sha256")
    .update("pier.git-review.entry.v1\0", "utf8")
    .update(path, "utf8")
    .digest("hex")}`;
}

function createIndexRevision(
  query: GitReviewResolvedQuery,
  primary: GitReviewIndexPrimaryParseResult,
  statsByGroup: Readonly<
    Partial<Record<GitReviewGroup, GitReviewIndexStatParseResult>>
  >
): string {
  const digest = new GitReviewRecordDigest("pier.git-review.revision.v1");
  digest.update(Buffer.from(JSON.stringify(query), "utf8"));
  const includedGroups = allowedGroupsForQuery(query);
  for (const group of GIT_REVIEW_GROUP_ORDER) {
    if (!includedGroups.has(group)) {
      continue;
    }
    const primaryDigest = primary.digestByGroup[group];
    if (primaryDigest !== undefined) {
      digest.update(Buffer.from(`${group}:primary:${primaryDigest}`, "utf8"));
    }
    const stats = statsByGroup[group];
    if (stats !== undefined) {
      digest.update(
        Buffer.from(
          `${group}:stats:${stats.digest}:truncated=${stats.truncated}`,
          "utf8"
        )
      );
    }
  }
  digest.update(Buffer.from(`primary-truncated=${primary.truncated}`, "utf8"));
  return digest.digest();
}
