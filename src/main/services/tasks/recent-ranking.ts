import { frecency } from "@shared/contracts/command-palette-mru.ts";
import type {
  TaskCandidate,
  TaskRecentEntry,
} from "@shared/contracts/tasks.ts";
import { isPackageScriptTaskId } from "./repo-identity.ts";
import { commandWithArgs } from "./utils.ts";

export function recentTaskKey(cwd: string, taskId: string): string {
  return `${cwd}\0${taskId}`;
}

export function recentCommandKey(cwd: string, command: string): string {
  return `${cwd}\0${command}`;
}

/** 同仓库 worktree 间 package-script 共享 frecency 的 key。 */
export function recentPackageScriptKey(
  gitCommonDir: string,
  taskId: string
): string {
  return `pkg\0${gitCommonDir}\0${taskId}`;
}

export interface SortTasksByRecentUseOptions {
  /**
   * 当前列表里各 cwd → gitCommonDir。
   * package-script 候选优先用此共享 key 取分。
   */
  gitCommonDirByCwd?: ReadonlyMap<string, string | null>;
}

function rawCommandForTask(task: TaskCandidate): string {
  if (task.commandSpec.kind === "process") {
    return commandWithArgs(task.commandSpec.command, task.commandSpec.args);
  }
  return task.commandSpec.command;
}

function recentScore(
  entry: TaskRecentEntry,
  index: number,
  total: number,
  now: number
): number | null {
  if (
    entry.useCount != null &&
    entry.useCount > 0 &&
    entry.lastUsedAt != null
  ) {
    return frecency(
      {
        actionId: entry.taskId ?? recentCommandKey(entry.cwd, entry.command),
        lastUsedAt: entry.lastUsedAt,
        useCount: entry.useCount,
      },
      now
    );
  }
  if (total <= 0) {
    return null;
  }
  return (total - index) / (total + 1);
}

function buildRecentScoreMaps(
  entries: readonly TaskRecentEntry[],
  now: number
): {
  byHistoryCommand: ReadonlyMap<string, number>;
  byLegacyCommand: ReadonlyMap<string, number>;
  byPackageScript: ReadonlyMap<string, number>;
  byTask: ReadonlyMap<string, number>;
} {
  const byHistoryCommand = new Map<string, number>();
  const byLegacyCommand = new Map<string, number>();
  const byPackageScript = new Map<string, number>();
  const byTask = new Map<string, number>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) {
      continue;
    }
    const score = recentScore(entry, index, entries.length, now);
    if (score == null) {
      continue;
    }
    const commandKey = recentCommandKey(entry.cwd, entry.command);
    byHistoryCommand.set(
      commandKey,
      Math.max(byHistoryCommand.get(commandKey) ?? 0, score)
    );
    if (entry.taskId) {
      const taskKey = recentTaskKey(entry.cwd, entry.taskId);
      byTask.set(taskKey, Math.max(byTask.get(taskKey) ?? 0, score));
      if (isPackageScriptTaskId(entry.taskId) && entry.gitCommonDir) {
        const packageKey = recentPackageScriptKey(
          entry.gitCommonDir,
          entry.taskId
        );
        byPackageScript.set(
          packageKey,
          Math.max(byPackageScript.get(packageKey) ?? 0, score)
        );
      }
    } else {
      byLegacyCommand.set(
        commandKey,
        Math.max(byLegacyCommand.get(commandKey) ?? 0, score)
      );
    }
  }
  return { byHistoryCommand, byLegacyCommand, byPackageScript, byTask };
}

function maxScore(
  ...scores: readonly (number | null | undefined)[]
): number | null {
  let best: number | null = null;
  for (const score of scores) {
    if (score == null) {
      continue;
    }
    if (best == null || score > best) {
      best = score;
    }
  }
  return best;
}

function taskRecentScore(
  task: TaskCandidate,
  maps: ReturnType<typeof buildRecentScoreMaps>,
  gitCommonDirByCwd: ReadonlyMap<string, string | null> | undefined
): number | null {
  const cwdTaskScore = maps.byTask.get(recentTaskKey(task.cwd, task.id));
  if (task.source === "package-script") {
    const gitCommonDir = gitCommonDirByCwd?.get(task.cwd);
    const packageScore =
      gitCommonDir != null && gitCommonDir.length > 0
        ? maps.byPackageScript.get(
            recentPackageScriptKey(gitCommonDir, task.id)
          )
        : null;
    return maxScore(packageScore, cwdTaskScore);
  }
  if (cwdTaskScore != null) {
    return cwdTaskScore;
  }
  const commandKey = recentCommandKey(task.cwd, rawCommandForTask(task));
  if (task.source === "history") {
    return maps.byHistoryCommand.get(commandKey) ?? null;
  }
  return maps.byLegacyCommand.get(commandKey) ?? null;
}

export function sortTasksByRecentUse(
  tasks: readonly TaskCandidate[],
  entries: readonly TaskRecentEntry[],
  now: number,
  options: SortTasksByRecentUseOptions = {}
): TaskCandidate[] {
  if (entries.length === 0) {
    return [...tasks];
  }
  const maps = buildRecentScoreMaps(entries, now);
  return tasks
    .map((task, index) => ({
      index,
      score: taskRecentScore(task, maps, options.gitCommonDirByCwd),
      task,
    }))
    .sort((a, b) => {
      if (a.score != null && b.score == null) {
        return -1;
      }
      if (a.score == null && b.score != null) {
        return 1;
      }
      if (a.score != null && b.score != null && a.score !== b.score) {
        return b.score - a.score;
      }
      return a.index - b.index;
    })
    .map((ranked) => ranked.task);
}

/** history 候选 id 前缀（`stableId(["history", command])`）。 */
function isHistoryTaskId(taskId: string): boolean {
  return taskId.startsWith("history:");
}

/** 判断两条 recent 是否应合并为同一记忆（package-script 按仓库共享）。 */
export function sameRecentIdentity(
  left: {
    command: string;
    cwd: string;
    gitCommonDir?: string | undefined;
    taskId?: string | undefined;
  },
  right: {
    command: string;
    cwd: string;
    gitCommonDir?: string | undefined;
    taskId?: string | undefined;
  }
): boolean {
  if (
    left.taskId &&
    right.taskId &&
    left.taskId === right.taskId &&
    isPackageScriptTaskId(left.taskId) &&
    left.gitCommonDir &&
    right.gitCommonDir &&
    left.gitCommonDir === right.gitCommonDir
  ) {
    return true;
  }
  if (
    left.taskId &&
    right.taskId &&
    recentTaskKey(left.cwd, left.taskId) ===
      recentTaskKey(right.cwd, right.taskId)
  ) {
    return true;
  }
  // 同 cwd + 同 command：仅在至少一侧无 taskId 或为 history 时合并，
  // 避免 vscode / package-script 等同命令串被误并；history 回跑与正式任务仍合并。
  if (
    recentCommandKey(left.cwd, left.command) !==
    recentCommandKey(right.cwd, right.command)
  ) {
    return false;
  }
  if (!(left.taskId && right.taskId)) {
    return true;
  }
  return isHistoryTaskId(left.taskId) || isHistoryTaskId(right.taskId);
}

/**
 * 合并同身份条目时优先保留 package-script 的 taskId / gitCommonDir，
 * 避免 history 回跑冲掉 frecency 的 package 键。
 */
export function preferredRecentIdentityFields(
  next: {
    gitCommonDir?: string | undefined;
    taskId: string;
  },
  matched: readonly {
    gitCommonDir?: string | undefined;
    taskId?: string | undefined;
  }[]
): { gitCommonDir?: string; taskId: string } {
  if (isPackageScriptTaskId(next.taskId)) {
    return {
      taskId: next.taskId,
      ...(next.gitCommonDir ? { gitCommonDir: next.gitCommonDir } : {}),
    };
  }
  const packageMatch = matched.find(
    (entry) => entry.taskId && isPackageScriptTaskId(entry.taskId)
  );
  if (packageMatch?.taskId) {
    const gitCommonDir =
      packageMatch.gitCommonDir ?? next.gitCommonDir ?? undefined;
    return {
      taskId: packageMatch.taskId,
      ...(gitCommonDir ? { gitCommonDir } : {}),
    };
  }
  return {
    taskId: next.taskId,
    ...(next.gitCommonDir ? { gitCommonDir: next.gitCommonDir } : {}),
  };
}

/**
 * 合并同仓库同 package-script 的多条历史（例如多 worktree 遗留条目）。
 * useCount 相加，保留最近一次的 cwd/command/label。
 */
export function collapseSharedPackageScriptEntries(
  entries: readonly TaskRecentEntry[]
): TaskRecentEntry[] {
  const result: TaskRecentEntry[] = [];
  const indexByPackageKey = new Map<string, number>();
  for (const entry of entries) {
    if (
      !(
        entry.taskId &&
        isPackageScriptTaskId(entry.taskId) &&
        entry.gitCommonDir
      )
    ) {
      result.push(entry);
      continue;
    }
    const packageKey = recentPackageScriptKey(entry.gitCommonDir, entry.taskId);
    const existingIndex = indexByPackageKey.get(packageKey);
    if (existingIndex == null) {
      indexByPackageKey.set(packageKey, result.length);
      result.push(entry);
      continue;
    }
    const previous = result[existingIndex];
    if (!previous) {
      result[existingIndex] = entry;
      continue;
    }
    const previousUsed = previous.lastUsedAt ?? 0;
    const nextUsed = entry.lastUsedAt ?? 0;
    const newer = nextUsed >= previousUsed ? entry : previous;
    const gitCommonDir = newer.gitCommonDir ?? previous.gitCommonDir;
    result[existingIndex] = {
      ...newer,
      lastUsedAt:
        previousUsed > 0 || nextUsed > 0
          ? Math.max(previousUsed, nextUsed)
          : newer.lastUsedAt,
      useCount: (previous.useCount ?? 0) + (entry.useCount ?? 0),
      ...(gitCommonDir ? { gitCommonDir } : {}),
    };
  }
  return result;
}
