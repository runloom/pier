import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import { agentTabIconId } from "@shared/contracts/agent-session.ts";
import {
  type ForegroundActivity,
  tabStatusForActivityStatus,
} from "@shared/contracts/foreground-activity.ts";
import {
  normalizePanelTabChromeInput,
  type PanelContext,
  type PanelDescriptor,
  type PanelTabChrome,
} from "@shared/contracts/panel.ts";
import {
  committedTaskOutputRunId,
  isActiveTaskRunNodeStatus,
  type TaskOutputPanelParams,
  type TaskPanelMetadata,
  type TaskRunNodeStatus,
  type TaskRunsSnapshot,
  taskRunTabState,
} from "@shared/contracts/tasks.ts";
import { taskRunsOwnedByPanel } from "@/stores/task-runs.store.ts";

/**
 * 路径 basename — POSIX 形式 (终端始终在 macOS).
 * 末尾 '/' 容错: "/" → "/"; "/a/b/" → "b"; "/a/b" → "b"; "" → "Terminal".
 */
export function basename(path: string): string {
  if (path === "" || path === "/") {
    return path === "" ? "Terminal" : "/";
  }
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function tabChromeFromParams(
  params: unknown
): PanelTabChrome | undefined {
  if (!params || typeof params !== "object" || !("tab" in params)) {
    return;
  }
  return normalizePanelTabChromeInput(params.tab);
}

export function mergeTabChrome(
  current: PanelTabChrome | undefined,
  patch: Partial<PanelTabChrome> | null
): PanelTabChrome | undefined {
  if (!patch) {
    return current;
  }
  const normalizedPatch = normalizePanelTabChromeInput(patch);
  if (!normalizedPatch) {
    return current;
  }
  const next = {
    ...(current ?? {}),
    ...normalizedPatch,
    ...(normalizedPatch.badge
      ? { badge: { ...(current?.badge ?? {}), ...normalizedPatch.badge } }
      : {}),
    ...(normalizedPatch.icon
      ? { icon: { ...(current?.icon ?? {}), ...normalizedPatch.icon } }
      : {}),
    ...(normalizedPatch.state
      ? { state: { ...(current?.state ?? {}), ...normalizedPatch.state } }
      : {}),
    ...(normalizedPatch.tooltip
      ? {
          tooltip: {
            ...(current?.tooltip ?? {}),
            ...normalizedPatch.tooltip,
          },
        }
      : {}),
  };
  return normalizePanelTabChromeInput(next) ?? current;
}

export function terminalPanelDescriptor(args: {
  effectiveContext: PanelContext | undefined;
  effectiveCwd: string | null;
  effectiveTab: PanelTabChrome | undefined;
  effectiveTitle: string | null;
  sessionLoaded: boolean;
}): PanelDescriptor | null {
  if (!args.sessionLoaded) {
    return null;
  }
  const short =
    args.effectiveTab?.title ??
    (args.effectiveCwd ? basename(args.effectiveCwd) : "Terminal");
  return {
    ...(args.effectiveContext ? { context: args.effectiveContext } : {}),
    display: {
      short,
      ...(args.effectiveTitle || args.effectiveCwd
        ? { long: args.effectiveTitle ?? args.effectiveCwd ?? undefined }
        : {}),
      ...(args.effectiveTitle ? { terminalTitle: args.effectiveTitle } : {}),
    },
    ...(args.effectiveTab ? { tab: args.effectiveTab } : {}),
  };
}

/**
 * 前台活动 → tab 呈现 overlay：状态点 + icon + title 全部由 renderer store
 * 消费同一 `ForegroundActivityBroadcast` 单源驱动（纯呈现层, 不进
 * tab-chrome-patch 持久化管线）——reload 后经 snapshot pull 自动恢复,
 * 活动消失即自动回退。
 *
 * - `agent` kind: 状态点从 agent status 派生, icon 换 agent, title 优先保留终端标题
 * - `task` kind: 无 tab state overlay（活体状态只读 TaskRunsSnapshot）
 * - `shell` / `idle` / undefined: 无 overlay, 走 tab 默认呈现
 */
export function activityTabChromeOverlay(
  activity: ForegroundActivity | undefined,
  terminalTitle?: string | null,
  taskRuns?: TaskRunsSnapshot
): Partial<PanelTabChrome> | null {
  if (!activity) {
    return null;
  }
  if (activity.kind === "agent") {
    const state = {
      state: { status: tabStatusForActivityStatus(activity.status) },
    };
    const entry = getAgentCatalogEntry(activity.agentId);
    return {
      ...state,
      icon: { id: agentTabIconId(activity.agentId) },
      title: terminalTitle?.trim() || entry?.label || activity.agentId,
    };
  }
  if (activity.kind === "task") {
    const run = taskRuns?.runs[activity.runId];
    if (!(run && isActiveTaskRunNodeStatus(run.status))) {
      return null;
    }
    return { title: activity.label };
  }
  return null;
}

function taskOutputTabState(status: TaskRunNodeStatus, exitCode?: number) {
  return taskRunTabState(status, exitCode);
}

/**
 * 普通任务终端 tab 状态：只反映 node.panelId 占用该 panel 的 run。
 * background 的 originPanelId 关联只出现在 RC，不覆盖 shell tab 的 loading。
 */
export function taskRunTabChromeOverlay(
  panelId: string,
  snapshot: TaskRunsSnapshot,
  fallback?: TaskPanelMetadata,
  selectedRunId?: string | null
): Partial<PanelTabChrome> | null {
  const runs = taskRunsOwnedByPanel(snapshot, panelId);
  const run =
    (selectedRunId
      ? runs.find((candidate) => candidate.runId === selectedRunId)
      : undefined) ?? runs[0];
  if (run) {
    const node =
      run.nodes[run.rootTaskId] ??
      Object.values(run.nodes).find(
        (candidate) => candidate.panelId === panelId
      );
    if (node) {
      const status = node.status ?? run.status;
      return {
        state: taskOutputTabState(status, node.exitCode),
        title: node.label ?? fallback?.label,
      };
    }
  }
  if (!fallback) {
    return null;
  }
  const fallbackRun = snapshot.runs[fallback.runId];
  const node = fallbackRun?.nodes[fallback.taskId];
  const status = node?.status ?? fallbackRun?.status;
  if (!status) {
    return null;
  }
  return {
    state: taskOutputTabState(status, node?.exitCode),
    title: node?.label ?? fallback.label,
  };
}

/** 后台任务输出面板的 tab 状态来自 TaskRunsSnapshot，不依赖终端前台活动。 */
export function taskOutputTabChromeOverlay(
  output: TaskOutputPanelParams | undefined,
  snapshot: TaskRunsSnapshot
): Partial<PanelTabChrome> | null {
  if (!output) {
    return null;
  }
  const runId = committedTaskOutputRunId(output);
  const run = snapshot.runs[runId];
  const node = run?.nodes[output.taskId];
  const status = node?.status ?? run?.status;
  return {
    ...(status ? { state: taskOutputTabState(status, node?.exitCode) } : {}),
    title: output.label,
  };
}
