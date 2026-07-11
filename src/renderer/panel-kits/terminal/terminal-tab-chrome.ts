import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import { agentTabIconId } from "@shared/contracts/agent-session.ts";
import {
  type ForegroundActivity,
  tabStatusForActivityStatus,
  taskTabStateForActivityStatus,
} from "@shared/contracts/foreground-activity.ts";
import {
  normalizePanelTabChromeInput,
  type PanelContext,
  type PanelDescriptor,
  type PanelTabChrome,
  type PanelTabState,
} from "@shared/contracts/panel.ts";
import type {
  TaskOutputPanelParams,
  TaskPanelMetadata,
  TaskRunNodeStatus,
  TaskRunsSnapshot,
} from "@shared/contracts/tasks.ts";
import { selectedTaskOutputRunId } from "@shared/contracts/tasks.ts";

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
 * - `task` kind: 完整 tab state（指示器+label+色 token）由
 *   taskTabStateForActivityStatus 派生兼容投影；实时任务状态最终由精确 runId 的
 *   TaskRunsSnapshot overlay 覆盖；label 作为 title
 * - `shell` / `idle` / undefined: 无 overlay, 走 tab 默认呈现
 */
export function activityTabChromeOverlay(
  activity: ForegroundActivity | undefined,
  terminalTitle?: string | null
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
    return {
      state: taskTabStateForActivityStatus(activity.status, activity.exitCode),
      title: activity.label,
    };
  }
  return null;
}

function taskOutputTabState(
  status: TaskRunNodeStatus,
  exitCode?: number
): PanelTabState {
  switch (status) {
    case "pending":
      return { label: "Pending", status: "waiting" };
    case "running":
      return { label: "Running", status: "running" };
    case "stopping":
      return { label: "Stopping", status: "waiting" };
    case "succeeded":
      return { colorToken: "success", label: "Succeeded", status };
    case "failed":
      return {
        colorToken: "destructive",
        label: exitCode === undefined ? "Failed" : `Failed ${exitCode}`,
        status,
      };
    case "blocked":
      return { colorToken: "warning", label: "Blocked", status };
    default:
      return { colorToken: "warning", label: "Cancelled", status };
  }
}

/**
 * 普通任务终端的状态按精确 runId 读取 TaskRunsSnapshot。
 * ForegroundActivity 仍负责活动呈现和兼容回退，但旧 PTY 的迟到退出事件不得覆盖
 * 已重绑到同一 panelId 的新运行状态。
 */
export function taskRunTabChromeOverlay(
  task: TaskPanelMetadata | undefined,
  snapshot: TaskRunsSnapshot
): Partial<PanelTabChrome> | null {
  if (!task) {
    return null;
  }
  const run = snapshot.runs[task.runId];
  const node = run?.nodes[task.taskId];
  const status = node?.status ?? run?.status;
  if (!status) {
    return null;
  }
  return {
    state: taskOutputTabState(status, node?.exitCode),
    title: node?.label ?? task.label,
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
  const run = snapshot.runs[selectedTaskOutputRunId(output)];
  const node = run?.nodes[output.taskId];
  const status = node?.status ?? run?.status;
  return {
    ...(status ? { state: taskOutputTabState(status, node?.exitCode) } : {}),
    title: output.label,
  };
}
