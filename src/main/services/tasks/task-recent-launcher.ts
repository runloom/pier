import { basename } from "node:path";
import type {
  TaskCandidate,
  TaskLaunchPlan,
  TaskRecentEntry,
  TaskRecentState,
} from "@shared/contracts/tasks.ts";
import {
  EMPTY_TASK_RECENT_STATE,
  readTaskRecentState as readTaskRecentStateDefault,
  writeTaskRecentState as writeTaskRecentStateDefault,
} from "../../state/task-recent.ts";
import {
  recentCommandKey,
  recentTaskKey,
  sortTasksByRecentUse,
} from "./task-recent-ranking.ts";

export interface CreateTaskRecentLauncherOptions {
  now: () => number;
  readRecentState?: () => Promise<TaskRecentState>;
  recentLimit?: number;
  writeRecentState?: (state: TaskRecentState) => Promise<void>;
}

export interface TaskRecentLauncher {
  /** 保证 recentTasks 已从磁盘加载；失败静默 fallback 到空表。 */
  ensureLoaded(): Promise<void>;
  /** 快照当前 recentTasks（原地 mutate 由 recordLaunch 完成）。 */
  entries(): readonly TaskRecentEntry[];
  /** 记录一次 launch，写盘 debounced state。若 disk io 失败重抛。 */
  recordLaunch(launch: TaskLaunchPlan): Promise<void>;
  /** 按 recentTasks 里的 lastUsedAt / useCount 排序 tasks。 */
  sort(tasks: readonly TaskCandidate[]): TaskCandidate[];
}

/**
 * Recent-task 记忆 + 排序的独立单元：脱离 task-service 主流程，方便 task-service
 * 保持在 file-size 硬帽以下。持有 module-local 状态 `recentTasks`，由外部通过
 * `ensureLoaded` / `recordLaunch` 驱动。
 */
export function createTaskRecentLauncher({
  now,
  readRecentState = readTaskRecentStateDefault,
  recentLimit = 20,
  writeRecentState = writeTaskRecentStateDefault,
}: CreateTaskRecentLauncherOptions): TaskRecentLauncher {
  let recentTasks: TaskRecentEntry[] = [];
  let loaded = false;
  let loadPromise: Promise<void> | null = null;

  async function ensureLoaded(): Promise<void> {
    if (loaded) {
      return;
    }
    if (loadPromise) {
      return await loadPromise;
    }
    loadPromise = readRecentState()
      .then((state) => {
        recentTasks = state.entries;
        loaded = true;
      })
      .catch(() => {
        recentTasks = EMPTY_TASK_RECENT_STATE.entries;
        loaded = true;
      })
      .finally(() => {
        loadPromise = null;
      });
    await loadPromise;
  }

  async function recordLaunch(launch: TaskLaunchPlan): Promise<void> {
    await ensureLoaded();
    const usedAt = now();
    const existing = recentTasks.find((recent) =>
      recent.taskId
        ? recentTaskKey(recent.cwd, recent.taskId) ===
          recentTaskKey(launch.cwd, launch.taskId)
        : recentCommandKey(recent.cwd, recent.command) ===
          recentCommandKey(launch.cwd, launch.rawCommand ?? launch.command)
    );
    const entry: TaskRecentEntry = {
      command: launch.rawCommand ?? launch.command,
      cwd: launch.cwd,
      lastUsedAt: usedAt,
      label: launch.label || basename(launch.cwd),
      source: "history",
      taskId: launch.taskId,
      useCount: (existing?.useCount ?? 0) + 1,
    };
    recentTasks = [
      entry,
      ...recentTasks.filter(
        (recent) =>
          !(
            (recent.taskId
              ? recentTaskKey(recent.cwd, recent.taskId) ===
                recentTaskKey(entry.cwd, launch.taskId)
              : false) ||
            recentCommandKey(recent.cwd, recent.command) ===
              recentCommandKey(entry.cwd, entry.command)
          )
      ),
    ].slice(0, recentLimit);
    await writeRecentState({ entries: recentTasks, version: 1 });
  }

  return {
    ensureLoaded,
    entries: () => recentTasks,
    recordLaunch,
    sort: (tasks) => sortTasksByRecentUse(tasks, recentTasks, now()),
  };
}
