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
  collapseSharedPackageScriptEntries,
  preferredRecentIdentityFields,
  sameRecentIdentity,
  sortTasksByRecentUse,
} from "./recent-ranking.ts";
import {
  isPackageScriptTaskId,
  type ResolveGitCommonDir,
  resolveGitCommonDir as resolveGitCommonDirDefault,
} from "./repo-identity.ts";

export interface CreateTaskRecentLauncherOptions {
  now: () => number;
  readRecentState?: () => Promise<TaskRecentState>;
  recentLimit?: number;
  resolveGitCommonDir?: ResolveGitCommonDir;
  writeRecentState?: (state: TaskRecentState) => Promise<void>;
}

export interface TaskRecentLauncher {
  /** 保证 recentTasks 已从磁盘加载；失败静默 fallback 到空表。 */
  ensureLoaded(): Promise<void>;
  /** 快照当前 recentTasks（原地 mutate 由 recordLaunch 完成）。 */
  entries(): readonly TaskRecentEntry[];
  /** 记录一次 launch，写盘 debounced state。若 disk io 失败重抛。 */
  recordLaunch(launch: TaskLaunchPlan): Promise<void>;
  /** 按 recentTasks 里的 lastUsedAt / useCount 排序 tasks（package-script 同仓库共享）。 */
  sort(tasks: readonly TaskCandidate[]): Promise<TaskCandidate[]>;
}

/**
 * Recent-task 记忆 + 排序的独立单元：脱离 task-service 主流程，方便 task-service
 * 保持在 file-size 硬帽以下。持有 module-local 状态 `recentTasks`，由外部通过
 * `ensureLoaded` / `recordLaunch` 驱动。
 *
 * package-script 的 frecency 按 gitCommonDir（同仓库 worktree 共享）合并；
 * 其它 source 仍按 cwd 隔离。
 *
 * 内存态 mutate + 写盘经 `enqueue` 串行化，避免 ensureLoaded 迁移写与
 * recordLaunch、以及并发 recordLaunch 互相覆盖 useCount。
 */
export function createTaskRecentLauncher({
  now,
  readRecentState = readTaskRecentStateDefault,
  recentLimit = 20,
  resolveGitCommonDir = resolveGitCommonDirDefault,
  writeRecentState = writeTaskRecentStateDefault,
}: CreateTaskRecentLauncherOptions): TaskRecentLauncher {
  let recentTasks: TaskRecentEntry[] = [];
  let loaded = false;
  /** 串行化 load / record 的 mutate+写盘；前一 op 失败也不阻断后续。 */
  let opChain: Promise<void> = Promise.resolve();
  const gitCommonDirCache = new Map<string, string>();

  function enqueue<T>(op: () => Promise<T>): Promise<T> {
    const run = opChain.then(op, op);
    opChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function cachedGitCommonDir(cwd: string): Promise<string | null> {
    const hit = gitCommonDirCache.get(cwd);
    if (hit !== undefined) {
      return hit;
    }
    const resolved = await resolveGitCommonDir(cwd);
    // 只缓存成功解析；null（非 git / 瞬时失败）下次再试。
    if (resolved) {
      gitCommonDirCache.set(cwd, resolved);
    }
    return resolved;
  }

  async function enrichPackageScriptGitCommonDirs(
    entries: readonly TaskRecentEntry[]
  ): Promise<{ changed: boolean; entries: TaskRecentEntry[] }> {
    let changed = false;
    const next: TaskRecentEntry[] = [];
    for (const entry of entries) {
      if (
        entry.taskId &&
        isPackageScriptTaskId(entry.taskId) &&
        !entry.gitCommonDir
      ) {
        const gitCommonDir = await cachedGitCommonDir(entry.cwd);
        if (gitCommonDir) {
          changed = true;
          next.push({ ...entry, gitCommonDir });
          continue;
        }
      }
      next.push(entry);
    }
    const collapsed = collapseSharedPackageScriptEntries(next);
    if (collapsed.length !== next.length) {
      changed = true;
    }
    return { changed, entries: collapsed };
  }

  /** 仅在 enqueue 临界区内调用。loaded 仅在迁移写完成后置 true。 */
  async function loadIfNeeded(): Promise<void> {
    if (loaded) {
      return;
    }
    try {
      const state = await readRecentState();
      const enriched = await enrichPackageScriptGitCommonDirs(state.entries);
      recentTasks = enriched.entries;
      if (enriched.changed) {
        try {
          // 写 enrichment 快照本身，避免与后续 mutate 抢同一引用语义。
          await writeRecentState({
            entries: enriched.entries,
            version: 1,
          });
        } catch {
          // 补齐 gitCommonDir 失败不阻断列表；下次加载再试。
        }
      }
      loaded = true;
    } catch {
      recentTasks = EMPTY_TASK_RECENT_STATE.entries;
      loaded = true;
    }
  }

  async function ensureLoaded(): Promise<void> {
    if (loaded) {
      return;
    }
    await enqueue(async () => {
      await loadIfNeeded();
    });
  }

  async function recordLaunch(launch: TaskLaunchPlan): Promise<void> {
    // 解析可在串行区外做；mutate / 写盘必须在 enqueue 内基于最新 recentTasks。
    const gitCommonDir = isPackageScriptTaskId(launch.taskId)
      ? await cachedGitCommonDir(launch.cwd)
      : null;

    await enqueue(async () => {
      await loadIfNeeded();
      const usedAt = now();
      const launchIdentity = {
        command: launch.rawCommand ?? launch.command,
        cwd: launch.cwd,
        taskId: launch.taskId,
        ...(gitCommonDir ? { gitCommonDir } : {}),
      };
      // 合并时累加所有同身份条目的 useCount（兼容旧数据多 worktree 分条）。
      const matched = recentTasks.filter((recent) =>
        sameRecentIdentity(recent, launchIdentity)
      );
      const priorCount = matched.reduce(
        (sum, recent) => sum + (recent.useCount ?? 0),
        0
      );
      // history 回跑与 package-script 同 command 合并时，保留 package-script 身份，
      // 避免 frecency 丢 byPackageScript / byTask 键。
      const preferred = preferredRecentIdentityFields(
        {
          taskId: launch.taskId,
          ...(gitCommonDir ? { gitCommonDir } : {}),
        },
        matched
      );
      const entry: TaskRecentEntry = {
        command: launch.rawCommand ?? launch.command,
        cwd: launch.cwd,
        lastUsedAt: usedAt,
        label: launch.label || basename(launch.cwd),
        source: "history",
        taskId: preferred.taskId,
        useCount: priorCount + 1,
        ...(preferred.gitCommonDir
          ? { gitCommonDir: preferred.gitCommonDir }
          : {}),
      };
      recentTasks = [
        entry,
        ...recentTasks.filter(
          (recent) => !sameRecentIdentity(recent, launchIdentity)
        ),
      ].slice(0, recentLimit);
      await writeRecentState({ entries: recentTasks, version: 1 });
    });
  }

  async function sort(
    tasks: readonly TaskCandidate[]
  ): Promise<TaskCandidate[]> {
    await ensureLoaded();
    const packageCwds = new Set(
      tasks
        .filter((task) => task.source === "package-script")
        .map((task) => task.cwd)
    );
    const gitCommonDirByCwd = new Map<string, string | null>();
    for (const cwd of packageCwds) {
      gitCommonDirByCwd.set(cwd, await cachedGitCommonDir(cwd));
    }
    return sortTasksByRecentUse(tasks, recentTasks, now(), {
      gitCommonDirByCwd,
    });
  }

  return {
    ensureLoaded,
    entries: () => recentTasks,
    recordLaunch,
    sort,
  };
}
