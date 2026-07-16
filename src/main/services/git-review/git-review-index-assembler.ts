import { createHash } from "node:crypto";
import {
  GIT_REVIEW_GROUP_ORDER,
  GIT_REVIEW_STATUS_PRIORITY,
  type GitReviewGroup,
  type GitReviewIndexEntry,
  type GitReviewWarning,
  gitReviewIndexEntrySchema,
} from "../../../shared/contracts/git-review.ts";
import {
  GIT_REVIEW_INDEX_TREE_MAX_SEGMENTS,
  type GitReviewIndexGroupFact,
  type GitReviewIndexPrimaryParseResult,
  GitReviewIndexProtocolError,
  type GitReviewIndexStatParseResult,
} from "./git-review-index-contract.ts";
import { GitReviewRecordDigest } from "./git-review-index-protocol.ts";
import { createGitReviewSectionKey } from "./git-review-section-key.ts";

interface AssembleGitReviewIndexOptions {
  readonly primary: GitReviewIndexPrimaryParseResult;
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
  primary,
  statsByGroup,
}: AssembleGitReviewIndexOptions): AssembledGitReviewIndex {
  const allGroups = new Set<GitReviewGroup>(GIT_REVIEW_GROUP_ORDER);
  const merged = mergePrimaryEntries(primary, allGroups);

  const sortable: SortableEntry[] = [];
  for (const mergedEntry of merged.values()) {
    const groups = GIT_REVIEW_GROUP_ORDER.filter(
      (group) => mergedEntry.groupFacts[group] !== undefined
    );
    const groupStatuses: Partial<
      Record<GitReviewGroup, GitReviewIndexEntry["status"]>
    > = {};
    const oldPaths: string[] = [];
    for (const group of groups) {
      const fact = mergedEntry.groupFacts[group];
      if (fact === undefined) {
        continue;
      }
      groupStatuses[group] = fact.status;
      if (fact.oldPath !== null && !oldPaths.includes(fact.oldPath)) {
        oldPaths.push(fact.oldPath);
      }
    }
    const status = GIT_REVIEW_STATUS_PRIORITY.find((candidate) =>
      Object.values(groupStatuses).includes(candidate)
    );
    if (status === undefined) {
      throw new GitReviewIndexProtocolError("Git index 条目缺少状态");
    }
    const entry = gitReviewIndexEntrySchema.parse({
      entryKey: entryKeyForPath(mergedEntry.path),
      oldPaths,
      path: mergedEntry.path,
      renderSlots: groups.map((group) => {
        const fact = mergedEntry.groupFacts[group];
        if (fact === undefined) {
          throw new GitReviewIndexProtocolError(
            `Git index 条目缺少 ${group} 事实`
          );
        }
        const oldPath = group === "conflict" ? null : fact.oldPath;
        return {
          group,
          oldPath,
          sectionKey: createGitReviewSectionKey(
            group,
            oldPath,
            fact.targetPath
          ),
          status: fact.status,
          targetPath: fact.targetPath,
        };
      }),
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
  const acceptedDirectories = new Set<string>();
  let pathsOverDepthLimit = 0;
  for (const item of sortable) {
    const pendingDirectories = pendingTreeDirectories(
      item.path,
      acceptedDirectories
    );
    if (pendingDirectories === null) {
      pathsOverDepthLimit += 1;
      continue;
    }
    for (const directory of pendingDirectories) {
      acceptedDirectories.add(directory);
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
  if (pathsOverDepthLimit > 0) {
    warnings.push({
      code: "pathDepthExceeded",
      skipped: pathsOverDepthLimit,
    });
  }
  if (primary.invalidPathEntries > 0) {
    warnings.push({
      code: "invalidPathEncoding",
      skipped: primary.invalidPathEntries,
    });
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    resolvedEntries: Object.freeze(resolvedEntries),
    revision: createIndexRevision(primary, statsByGroup),
    warnings: Object.freeze(warnings),
  });
}

function mergePrimaryEntries(
  primary: GitReviewIndexPrimaryParseResult,
  allowedGroups: ReadonlySet<GitReviewGroup>
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
  mergeUncommittedRenameChains(merged);
  return merged;
}

function mergeUncommittedRenameChains(
  entries: Map<string, MutableMergedEntry>
): void {
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

function entryKeyForPath(path: string): string {
  return `sha256:${createHash("sha256")
    .update("pier.git-review.entry.v1\0", "utf8")
    .update(path, "utf8")
    .digest("hex")}`;
}

function createIndexRevision(
  primary: GitReviewIndexPrimaryParseResult,
  statsByGroup: Readonly<
    Partial<Record<GitReviewGroup, GitReviewIndexStatParseResult>>
  >
): string {
  const digest = new GitReviewRecordDigest("pier.git-review.revision.v1");
  for (const group of GIT_REVIEW_GROUP_ORDER) {
    const primaryDigest = primary.digestByGroup[group];
    if (primaryDigest !== undefined) {
      digest.update(Buffer.from(`${group}:primary:${primaryDigest}`, "utf8"));
    }
    const stats = statsByGroup[group];
    if (stats !== undefined) {
      digest.update(Buffer.from(`${group}:stats:${stats.digest}`, "utf8"));
    }
  }
  return digest.digest();
}

function pendingTreeDirectories(
  path: string,
  acceptedDirectories: ReadonlySet<string>
): string[] | null {
  const pending: string[] = [];
  let segmentCount = 1;
  let cursor = 0;
  while (true) {
    const slash = path.indexOf("/", cursor);
    if (slash < 0) {
      break;
    }
    segmentCount += 1;
    if (segmentCount > GIT_REVIEW_INDEX_TREE_MAX_SEGMENTS) {
      return null;
    }
    const directory = path.slice(0, slash);
    if (!acceptedDirectories.has(directory)) {
      pending.push(directory);
    }
    cursor = slash + 1;
  }
  return pending;
}
