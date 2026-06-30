import { frecency } from "@shared/contracts/command-palette-mru.ts";
import type {
  TaskCandidate,
  TaskRecentEntry,
} from "@shared/contracts/tasks.ts";
import { commandWithArgs } from "./utils.ts";

export function recentTaskKey(cwd: string, taskId: string): string {
  return `${cwd}\0${taskId}`;
}

export function recentCommandKey(cwd: string, command: string): string {
  return `${cwd}\0${command}`;
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
  byTask: ReadonlyMap<string, number>;
} {
  const byHistoryCommand = new Map<string, number>();
  const byLegacyCommand = new Map<string, number>();
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
    } else {
      byLegacyCommand.set(
        commandKey,
        Math.max(byLegacyCommand.get(commandKey) ?? 0, score)
      );
    }
  }
  return { byHistoryCommand, byLegacyCommand, byTask };
}

function taskRecentScore(
  task: TaskCandidate,
  maps: ReturnType<typeof buildRecentScoreMaps>
): number | null {
  const byTask = maps.byTask.get(recentTaskKey(task.cwd, task.id));
  if (byTask != null) {
    return byTask;
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
  now: number
): TaskCandidate[] {
  if (entries.length === 0) {
    return [...tasks];
  }
  const maps = buildRecentScoreMaps(entries, now);
  return tasks
    .map((task, index) => ({
      index,
      score: taskRecentScore(task, maps),
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
