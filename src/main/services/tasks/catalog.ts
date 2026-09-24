import type { TaskListResult } from "@shared/contracts/tasks.ts";
import type { ProcessEnvironmentService } from "../process-environment/types.ts";
import { resolveTaskListPathEnv } from "./command-path.ts";
import type { TaskRecentLauncher } from "./recent-launcher.ts";
import {
  type CollectTaskCandidatesOptions,
  collectTaskCandidates,
} from "./sources.ts";
import { executableOnPath } from "./utils.ts";

const TASK_LIST_CACHE_TTL_MS = 2000;

export interface TaskCatalog {
  invalidate(projectRootPath: string): void;
  invalidateAll(): void;
  list(projectRootPath: string): Promise<TaskListResult>;
}

/**
 * 任务候选目录：collectTaskCandidates 的 TTL 缓存 + 并发去重层。
 * version 计数保证 invalidate 后在途的旧采集结果不会回写缓存。
 */
export function createTaskCatalog({
  now,
  processEnvironment,
  recent,
}: {
  now(): number;
  processEnvironment?: Pick<ProcessEnvironmentService, "resolve"> | undefined;
  recent: TaskRecentLauncher;
}): TaskCatalog {
  const cache = new Map<
    string,
    { expiresAt: number; pathEnv: string | undefined; result: TaskListResult }
  >();
  const versions = new Map<string, number>();
  const inFlight = new Map<
    string,
    {
      pathEnv: string | undefined;
      promise: Promise<TaskListResult>;
      version: number;
    }
  >();

  const collectFresh = async (
    projectRootPath: string,
    pathEnv: string | undefined
  ) => {
    await recent.ensureLoaded();
    const result = await collectTaskCandidates({
      projectRootPath,
      recentTasks: recent.entries(),
      ...(pathEnv === undefined
        ? {}
        : { commandExists: (name: string) => executableOnPath(name, pathEnv) }),
    } satisfies CollectTaskCandidatesOptions);
    return { ...result, tasks: await recent.sort(result.tasks) };
  };

  const bump = (projectRootPath: string) => {
    cache.delete(projectRootPath);
    versions.set(projectRootPath, (versions.get(projectRootPath) ?? 0) + 1);
  };

  return {
    invalidate(projectRootPath) {
      bump(projectRootPath);
    },
    invalidateAll() {
      const keys = new Set([
        ...cache.keys(),
        ...inFlight.keys(),
        ...versions.keys(),
      ]);
      for (const projectRootPath of keys) {
        bump(projectRootPath);
      }
    },
    async list(projectRootPath) {
      const pathEnv = await resolveTaskListPathEnv(
        processEnvironment,
        projectRootPath
      );
      const cached = cache.get(projectRootPath);
      if (cached && cached.expiresAt > now() && cached.pathEnv === pathEnv) {
        return cached.result;
      }
      const version = versions.get(projectRootPath) ?? 0;
      const pending = inFlight.get(projectRootPath);
      if (
        pending &&
        pending.version === version &&
        pending.pathEnv === pathEnv
      ) {
        return await pending.promise;
      }
      const next = collectFresh(projectRootPath, pathEnv)
        .then((result) => {
          if ((versions.get(projectRootPath) ?? 0) === version) {
            cache.set(projectRootPath, {
              expiresAt: now() + TASK_LIST_CACHE_TTL_MS,
              pathEnv,
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
      inFlight.set(projectRootPath, { pathEnv, promise: next, version });
      return await next;
    },
  };
}
