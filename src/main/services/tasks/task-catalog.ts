import type { TaskListResult } from "@shared/contracts/tasks.ts";
import type { TaskRecentLauncher } from "./task-recent-launcher.ts";
import {
  type CollectTaskCandidatesOptions,
  collectTaskCandidates,
} from "./task-sources.ts";

const TASK_LIST_CACHE_TTL_MS = 2000;

export interface TaskCatalog {
  invalidate(projectRootPath: string): void;
  list(projectRootPath: string): Promise<TaskListResult>;
}

/**
 * 任务候选目录：collectTaskCandidates 的 TTL 缓存 + 并发去重层。
 * version 计数保证 invalidate 后在途的旧采集结果不会回写缓存。
 */
export function createTaskCatalog({
  homeDir,
  now,
  recent,
}: {
  homeDir?: string | undefined;
  now(): number;
  recent: TaskRecentLauncher;
}): TaskCatalog {
  const cache = new Map<
    string,
    { expiresAt: number; result: TaskListResult }
  >();
  const versions = new Map<string, number>();
  const inFlight = new Map<
    string,
    { promise: Promise<TaskListResult>; version: number }
  >();

  const collectFresh = async (projectRootPath: string) => {
    await recent.ensureLoaded();
    const result = await collectTaskCandidates({
      projectRootPath,
      recentTasks: recent.entries(),
      ...(homeDir ? { homeDir } : {}),
    } satisfies CollectTaskCandidatesOptions);
    return { ...result, tasks: recent.sort(result.tasks) };
  };

  return {
    invalidate(projectRootPath) {
      cache.delete(projectRootPath);
      versions.set(projectRootPath, (versions.get(projectRootPath) ?? 0) + 1);
    },
    async list(projectRootPath) {
      const cached = cache.get(projectRootPath);
      if (cached && cached.expiresAt > now()) {
        return cached.result;
      }
      const version = versions.get(projectRootPath) ?? 0;
      const pending = inFlight.get(projectRootPath);
      if (pending && pending.version === version) {
        return await pending.promise;
      }
      const next = collectFresh(projectRootPath)
        .then((result) => {
          if ((versions.get(projectRootPath) ?? 0) === version) {
            cache.set(projectRootPath, {
              expiresAt: now() + TASK_LIST_CACHE_TTL_MS,
              result,
            });
          }
          return result;
        })
        .finally(() => {
          if (inFlight.get(projectRootPath)?.promise === next) {
            inFlight.delete(projectRootPath);
          }
        });
      inFlight.set(projectRootPath, { promise: next, version });
      return await next;
    },
  };
}
