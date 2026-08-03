import {
  GIT_REVIEW_GROUP_ORDER,
  type GitReviewGroup,
  type GitReviewIndexEntry,
} from "../../../../shared/contracts/git/review.ts";
import type { GitChangeSummary } from "../../../../shared/contracts/git.ts";
import {
  type GitUntrackedPathStats,
  type ReadGitUntrackedPathStatsOptions,
  readGitUntrackedPathStats,
} from "../../git/change-summary.ts";
import type { GitReviewIndexResolvedEntry } from "./assembler.ts";
import type {
  GitReviewIndexExecutionBudget,
  GitReviewIndexGroupFact,
} from "./contract.ts";

interface GroupSlot {
  readonly fact: GitReviewIndexGroupFact | undefined;
  readonly slot: GitReviewIndexEntry["renderSlots"][number];
}

export type GitReviewUntrackedPathStatsReader = (
  options: ReadGitUntrackedPathStatsOptions
) => Promise<GitUntrackedPathStats>;

export interface GitReviewGroupSummaryBuildResult {
  readonly groupSummaries: Partial<Record<GitReviewGroup, GitChangeSummary>>;
  /** 已安全读取并完成二次 stat 校验的未跟踪文件身份，可复用作同轮 revision 事实。 */
  readonly stableUntrackedStatTokens: ReadonlyMap<string, string>;
}

export async function buildGitReviewGroupSummaries({
  budget,
  canonicalRoot,
  entries,
  readUntrackedPathStats = readGitUntrackedPathStats,
  resolvedEntries,
  signal,
}: {
  readonly budget: GitReviewIndexExecutionBudget;
  readonly canonicalRoot: string;
  readonly entries: readonly GitReviewIndexEntry[];
  readonly readUntrackedPathStats?: GitReviewUntrackedPathStatsReader;
  readonly resolvedEntries: readonly GitReviewIndexResolvedEntry[];
  readonly signal: AbortSignal | undefined;
}): Promise<GitReviewGroupSummaryBuildResult> {
  const factsByPath = new Map(
    resolvedEntries.map((entry) => [entry.path, entry.groupFacts])
  );
  const slotsByGroup = new Map<GitReviewGroup, GroupSlot[]>();
  for (const entry of entries) {
    const groupFacts = factsByPath.get(entry.path);
    for (const slot of entry.renderSlots) {
      const slots = slotsByGroup.get(slot.group) ?? [];
      slots.push({ fact: groupFacts?.[slot.group], slot });
      slotsByGroup.set(slot.group, slots);
    }
  }

  const groupSummaries: Partial<Record<GitReviewGroup, GitChangeSummary>> = {};
  const stableUntrackedStatTokens = new Map<string, string>();
  for (const group of GIT_REVIEW_GROUP_ORDER) {
    const slots = slotsByGroup.get(group);
    if (slots === undefined) {
      continue;
    }
    if (group === "conflict") {
      groupSummaries[group] = conflictSummary(slots.length);
      continue;
    }
    const result = await summarizeSlots({
      budget,
      canonicalRoot,
      readUntrackedPathStats,
      signal,
      slots,
    });
    groupSummaries[group] = result.summary;
    for (const [path, token] of result.stableUntrackedStatTokens) {
      stableUntrackedStatTokens.set(path, token);
    }
  }
  return { groupSummaries, stableUntrackedStatTokens };
}

function conflictSummary(changedFiles: number): GitChangeSummary {
  return {
    changedFiles,
    deletions: 0,
    excludedFiles: changedFiles,
    insertions: 0,
    kind: "lineDelta",
  };
}

async function summarizeSlots({
  budget,
  canonicalRoot,
  readUntrackedPathStats,
  signal,
  slots,
}: {
  readonly budget: GitReviewIndexExecutionBudget;
  readonly canonicalRoot: string;
  readonly readUntrackedPathStats: GitReviewUntrackedPathStatsReader;
  readonly signal: AbortSignal | undefined;
  readonly slots: readonly GroupSlot[];
}): Promise<{
  readonly stableUntrackedStatTokens: ReadonlyMap<string, string>;
  readonly summary: GitChangeSummary;
}> {
  let deletions = 0;
  let excludedFiles = 0;
  let insertions = 0;
  const stableUntrackedStatTokens = new Map<string, string>();
  const untrackedPaths: string[] = [];

  for (const { fact, slot } of slots) {
    if (fact?.origin === "untracked") {
      untrackedPaths.push(fact.targetPath);
      continue;
    }
    if (slot.binary) {
      excludedFiles += 1;
      continue;
    }
    if (
      slot.additions !== undefined &&
      slot.additions !== null &&
      slot.deletions !== undefined &&
      slot.deletions !== null
    ) {
      insertions += slot.additions;
      deletions += slot.deletions;
      continue;
    }
    // 无数可计或 stats 缺失：进 excluded，保留其余路径的准确 +/-。
    excludedFiles += 1;
  }

  if (untrackedPaths.length > 0) {
    const untracked = await readUntrackedPathStats({
      budget,
      cwd: canonicalRoot,
      paths: untrackedPaths,
      ...(signal === undefined ? {} : { signal }),
    });
    insertions += untracked.insertions;
    excludedFiles += untracked.excludedFiles + untracked.omittedFiles;
    for (const [path, token] of untracked.stableStatTokens ?? []) {
      stableUntrackedStatTokens.set(path, token);
    }
  }

  // 可计行准确汇总；不可计路径（binary / 未跟踪读失败等）进 excluded，
  // 不因局部失败整段降级为 filesOnly（与状态栏 change-summary 同构）。
  return {
    stableUntrackedStatTokens,
    summary: {
      changedFiles: slots.length,
      deletions,
      excludedFiles,
      insertions,
      kind: "lineDelta",
    },
  };
}
