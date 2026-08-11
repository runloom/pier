/**
 * worktree.remove 准入（W4-S1）：活跃 agent runtime / 非终态 TaskRun / dirty 工作树。
 * 不在 service 层做，避免 Git 纯操作与宿主运行时耦合。
 */
import { resolve } from "node:path";
import { isActiveTaskRunNodeStatus } from "@shared/contracts/task-run-status.ts";
import type { PierCoreServices } from "../command-router-services.ts";

export type WorktreeRemoveAdmissionBlock =
  | { blocked: false }
  | { blocked: true; message: string };

function sameResolvedPath(a: string, b: string): boolean {
  return resolve(a) === resolve(b);
}

export async function admitWorktreeRemove(
  services: PierCoreServices,
  targetPath: string
): Promise<WorktreeRemoveAdmissionBlock> {
  const targetKey = resolve(targetPath);

  try {
    // Runtime Index 命中 worktreeKey / projectRootPath / cwd 任一即占用。
    const live = services.agentRuntimeIndex
      .listMachine()
      .entries.filter((e) => {
        const keys = [e.worktreeKey, e.projectRootPath, e.cwd].filter(
          (p): p is string => typeof p === "string" && p.length > 0
        );
        return keys.some((p) => sameResolvedPath(p, targetKey));
      });
    if (live.length > 0) {
      return {
        blocked: true,
        message: `cannot remove worktree while ${live.length} agent runtime(s) are active; terminate agents first`,
      };
    }
  } catch {
    return {
      blocked: true,
      message:
        "cannot verify agent occupancy for worktree remove; terminate agents or retry",
    };
  }

  try {
    const snap = services.tasks.runsSnapshot();
    const activeRuns = Object.values(snap.runs).filter(
      (run) =>
        isActiveTaskRunNodeStatus(run.status) &&
        sameResolvedPath(run.projectRootPath, targetKey)
    );
    if (activeRuns.length > 0) {
      return {
        blocked: true,
        message: `cannot remove worktree while ${activeRuns.length} task run(s) are active; cancel tasks first`,
      };
    }
  } catch {
    return {
      blocked: true,
      message:
        "cannot verify task occupancy for worktree remove; cancel tasks or retry",
    };
  }

  try {
    const status = await services.git.getStatus(targetPath);
    if (status.files.length > 0) {
      return {
        blocked: true,
        message:
          "cannot remove worktree with uncommitted changes; commit, stash, or discard first",
      };
    }
  } catch {
    /* git status 失败时交给 worktree remove 本身报错 */
  }

  return { blocked: false };
}
