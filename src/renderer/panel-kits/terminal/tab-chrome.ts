import { truncateTerminalTitleForTooltip } from "@shared/agent-session-title/index.ts";
import { agentTabIconId } from "@shared/contracts/agent/session.ts";
import {
  type AgentSessionTitleSource,
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
import {
  agentEndResultTabChrome,
  stripPanelTabChromeState,
  tabChromeForAgentEndBase,
} from "@shared/contracts/terminal/end-state.ts";
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

/** @deprecated Use stripPanelTabChromeState from terminal-end-state — re-export for call sites. */
export const stripTabChromeState = stripPanelTabChromeState;

/**
 * Base tab for agent result view — shared tabChromeForAgentEndBase.
 */
export function tabChromeForAgentResultBase(
  tab: PanelTabChrome | undefined,
  options?: {
    exitCode?: number | undefined;
    /** true when process has exited (session, latch, or child-exited) */
    exited?: boolean | undefined;
  }
): PanelTabChrome | undefined {
  return tabChromeForAgentEndBase(tab, {
    exitCode: options?.exitCode,
    exited: options?.exited === true,
  });
}

/** 去掉 title，让 descriptor 回退到 OSC / cwd（活体 agent 无用户改名时用）。 */
export function stripTabChromeTitle(
  tab: PanelTabChrome | undefined
): PanelTabChrome | undefined {
  if (!tab?.title) {
    return tab;
  }
  const { title: _title, ...rest } = tab;
  return normalizePanelTabChromeInput(rest) ?? rest;
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
    // trailing：patch 里**有**字段则整体替换；**省略**则保留 current（不能靠
    // trailing: undefined 清空——与 badge/state 同语义）。清空需 strip 或整段 resolveTab。
    ...(normalizedPatch.trailing ? { trailing: normalizedPatch.trailing } : {}),
  };
  return normalizePanelTabChromeInput(next) ?? current;
}

export function terminalPanelDescriptor(args: {
  effectiveContext: PanelContext | undefined;
  effectiveCwd: string | null;
  effectiveTab: PanelTabChrome | undefined;
  /**
   * OSC 0/2 终端标题（进程 / TUI / shell 自己设置）。
   * 对齐 Ghostty：有 OSC 则作 tab 主标题；无则回退目录规则（cwd basename）。
   */
  terminalTitle?: string | null | undefined;
  sessionLoaded: boolean;
}): PanelDescriptor | null {
  if (!args.sessionLoaded) {
    return null;
  }
  // 显式 chrome 覆盖：任务 label、用户改名、end-state 等；不含 prompt 派生。
  const chromeTitle = args.effectiveTab?.title?.trim() || null;
  const oscTitle = truncateTerminalTitleForTooltip(args.terminalTitle);
  const cwdShort = args.effectiveCwd ? basename(args.effectiveCwd) : null;
  // Ghostty / 业界：
  // short = 显式覆盖 → OSC → 目录名
  // long  = OSC 优先（hover 看进程自报标题）；无 OSC 时用全路径 cwd，再退覆盖文案
  const short = chromeTitle ?? oscTitle ?? cwdShort ?? "Terminal";
  const long =
    oscTitle ??
    (args.effectiveCwd ? args.effectiveCwd : undefined) ??
    chromeTitle ??
    undefined;
  return {
    ...(args.effectiveContext ? { context: args.effectiveContext } : {}),
    display: {
      short,
      ...(long ? { long } : {}),
      ...(oscTitle ? { terminalTitle: oscTitle } : {}),
    },
    ...(args.effectiveTab ? { tab: args.effectiveTab } : {}),
  };
}

export interface ActivityTabChromeOverlayOptions {
  cwd?: string | null | undefined;
  projectRootPath?: string | null | undefined;
  /** session JSON 回退（FA 尚未 hydrate 时）；仅 source=user 可进 tab 覆盖 */
  sessionTitle?: string | null | undefined;
  sessionTitleSource?: AgentSessionTitleSource | null | undefined;
  taskRuns?: TaskRunsSnapshot | undefined;
}

/**
 * 用户主动改名时的 tab 覆盖文案（FA 优先，session JSON 回退）。
 * prompt / provider 不得抢 OSC——终端标题由进程 OSC 0/2 自管。
 */
export function agentUserTabTitleOverride(
  activity: ForegroundActivity | undefined,
  options?: ActivityTabChromeOverlayOptions
): string | null {
  if (activity?.kind !== "agent") {
    return null;
  }
  const source =
    activity.sessionTitleSource ?? options?.sessionTitleSource ?? null;
  if (source !== "user") {
    return null;
  }
  const raw = activity.sessionTitle ?? options?.sessionTitle ?? null;
  const title = raw?.trim();
  return title || null;
}

/**
 * 前台活动 → tab 呈现 overlay：状态点 + icon 由 renderer store
 * 消费同一 `ForegroundActivityBroadcast` 单源驱动（纯呈现层, 不进
 * tab-chrome-patch 持久化管线）——reload 后经 snapshot pull 自动恢复,
 * 活动消失即自动回退。
 *
 * - `agent` kind: 状态点 + icon；**标题不写**（OSC → cwd，对齐 Ghostty）。
 *   仅 `sessionTitleSource === "user"` 时写入 title 覆盖。
 * - `task` kind: 无 tab state overlay（活体状态只读 TaskRunsSnapshot）；label 作为 title
 * - `shell` / `idle` / undefined: 无 overlay, 走 tab 默认呈现
 */
export function activityTabChromeOverlay(
  activity: ForegroundActivity | undefined,
  options?: ActivityTabChromeOverlayOptions
): Partial<PanelTabChrome> | null {
  if (!activity) {
    return null;
  }
  if (activity.kind === "agent") {
    const userTitle = agentUserTabTitleOverride(activity, options);
    return {
      state: { status: tabStatusForActivityStatus(activity.status) },
      icon: { id: agentTabIconId(activity.agentId) },
      ...(userTitle ? { title: userTitle } : {}),
    };
  }
  if (activity.kind === "task") {
    const run = options?.taskRuns?.runs[activity.runId];
    if (!(run && isActiveTaskRunNodeStatus(run.status))) {
      return null;
    }
    return { title: activity.label };
  }
  return null;
}

/**
 * Agent 进程退出后 FA activity 会被清掉，tab 若只依赖 activity overlay 会丢
 * agent icon 回退成默认方块。结果查看态用 session / latch 的 agentId 补 icon。
 *
 * 语义：shared `agentEndResultTabChrome`（干净退出不写 state；失败 failed）。
 * 调用方须先 `tabChromeForAgentResultBase` 剥 base success。
 */
export function agentResultTabChromeOverlay(
  agentId: AgentKind | undefined,
  options?: {
    exitCode?: number | undefined;
    /** true when process has exited and panel is retained for review */
    exited?: boolean | undefined;
    title?: string | null | undefined;
  }
): Partial<PanelTabChrome> | null {
  if (!agentId) {
    return null;
  }
  return agentEndResultTabChrome(agentId, options);
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
