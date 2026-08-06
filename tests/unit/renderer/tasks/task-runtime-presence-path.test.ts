/**
 * 全路径锁定：从 terminal 发起 background 任务时，
 * origin 面板的 tab 活跃点与 RC mount 必须同真。
 *
 * 覆盖产品复现：用户在 Grok/普通终端上 Run Task → mode=background
 * → originPanelId=当前终端 → 应有任务蓝点 + 任务运行条。
 */

import type {
  TaskRunControlEntry,
  TaskRunsSnapshot,
} from "@shared/contracts/tasks.ts";
import { describe, expect, it } from "vitest";
import {
  activeTaskRunImpliesRuntimeControl,
  panelShouldMountRuntimeControl,
  shouldPresentRun,
} from "@/panel-kits/terminal/hooks/use-runtime-control-presentation.ts";
import {
  panelHasActiveTaskRun,
  taskRunsForPanel,
} from "@/stores/task-runs.store.ts";

function backgroundRunOnOrigin(
  originPanelId: string,
  status: TaskRunControlEntry["status"] = "running",
  options: {
    ownerWindowId?: string;
    runId?: string;
  } = {}
): TaskRunControlEntry {
  const runId = options.runId ?? "run-bg-1";
  return {
    mode: "background",
    nodes: {
      "package-script:typecheck": {
        label: "typecheck",
        panelId: `background-task:${runId}:package-script:typecheck`,
        status,
        taskId: "package-script:typecheck",
      },
    },
    originPanelId,
    ...(options.ownerWindowId ? { ownerWindowId: options.ownerWindowId } : {}),
    projectRootPath: "/repo",
    rootTaskId: "package-script:typecheck",
    runId,
    startedAt: 1000,
    status,
    updatedAt: 2000,
  };
}

/** 与 broadcastTaskRunsSnapshot 同构过滤（owner 精确匹配）。 */
function filterRunsForWindow(
  runs: TaskRunsSnapshot["runs"],
  windowId: string | null
): TaskRunsSnapshot["runs"] {
  if (windowId === null) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(runs).filter(([, run]) => run.ownerWindowId === windowId)
  );
}

describe("task runtime presence path (terminal → background → origin RC)", () => {
  const originPanelId = "terminal-grok";
  const ownerWindowId = "main";

  it("RC-scope includes origin panel for background runs", () => {
    const run = backgroundRunOnOrigin(originPanelId, "running", {
      ownerWindowId,
    });
    const snapshot: TaskRunsSnapshot = {
      runs: { [run.runId]: run },
      version: 1,
    };
    const forOrigin = taskRunsForPanel(snapshot, originPanelId);
    expect(forOrigin).toHaveLength(1);
    expect(forOrigin[0]?.originPanelId).toBe(originPanelId);
  });

  it("active tab dot and RC mount are both true on origin while run is active", () => {
    const run = backgroundRunOnOrigin(originPanelId, "running", {
      ownerWindowId,
    });
    const snapshot: TaskRunsSnapshot = {
      runs: { [run.runId]: run },
      version: 1,
    };
    const dismissed = new Set<string>();
    const forOrigin = taskRunsForPanel(snapshot, originPanelId);

    expect(panelHasActiveTaskRun(snapshot, originPanelId)).toBe(true);
    expect(panelShouldMountRuntimeControl(forOrigin, dismissed)).toBe(true);
    expect(shouldPresentRun(run, dismissed)).toBe(true);
    expect(activeTaskRunImpliesRuntimeControl(true, forOrigin, dismissed)).toBe(
      true
    );
  });

  it.each([
    "pending",
    "running",
    "stopping",
  ] as const)("active status %s cannot be dismissed away from RC", (status) => {
    const run = backgroundRunOnOrigin(originPanelId, status, {
      ownerWindowId,
    });
    const dismissed = new Set([run.runId]);
    expect(shouldPresentRun(run, dismissed)).toBe(true);
    expect(panelShouldMountRuntimeControl([run], dismissed)).toBe(true);
  });

  it("broadcast-style filter drops runs when ownerWindowId is missing (footgun)", () => {
    const run = backgroundRunOnOrigin(originPanelId, "running");
    // no ownerWindowId
    const filtered = filterRunsForWindow({ [run.runId]: run }, ownerWindowId);
    expect(filtered).toEqual({});
  });

  it("broadcast-style filter keeps runs for matching ownerWindowId", () => {
    const run = backgroundRunOnOrigin(originPanelId, "running", {
      ownerWindowId,
    });
    const filtered = filterRunsForWindow({ [run.runId]: run }, ownerWindowId);
    expect(Object.keys(filtered)).toEqual([run.runId]);
  });

  it("agent panel without TaskRun: no active-task dot and no task RC", () => {
    const snapshot: TaskRunsSnapshot = { runs: {}, version: 0 };
    expect(panelHasActiveTaskRun(snapshot, originPanelId)).toBe(false);
    expect(panelShouldMountRuntimeControl([], new Set())).toBe(false);
  });
});
