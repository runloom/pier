import { truncateTerminalTitleForTooltip } from "@shared/agent-session-title/index.ts";
import { agentTabIconId } from "@shared/contracts/agent/session.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
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

/**
 * 从 shell 常见 `user@host:path` / `host:path` 标题里抽出 path 段。
 * 无匹配则返回原串（再交给路径判定）。
 */
function stripRemotePrefix(title: string): string {
  // user@host:/path 或 host:~/path；避免把 `C:` 当 host（mac 无盘符主路径）。
  const match = title.match(/^[^/\s:]*(?:@[^/\s:]+)?:(.+)$/);
  const pathPart = match?.[1]?.trim();
  if (pathPart && (pathPart.startsWith("/") || pathPart.startsWith("~"))) {
    return pathPart;
  }
  return title;
}

/**
 * OSC 是否是「目录标题」（shell / shell-integration 把 cwd 写进 OSC 0/2）。
 * 进程名 / TUI 名（claude、vim、npm run dev）保持原样。
 */
export function pathLikeTerminalTitle(title: string): string | null {
  const raw = title.trim();
  if (!raw) {
    return null;
  }
  const candidate = stripRemotePrefix(raw);
  if (
    candidate === "~" ||
    candidate.startsWith("~/") ||
    candidate.startsWith("/")
  ) {
    return candidate;
  }
  // 相对多段路径（无空白），避免把普通句子误判成 path。
  if (!/\s/.test(candidate) && candidate.includes("/")) {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
      return null;
    }
    return candidate;
  }
  return null;
}

/**
 * OSC → tab short：路径型 OSC 收成叶子目录名（与文件 tab 一致，避免 160px 截断难辨）；
 * 非路径 OSC 原样。完整 OSC 仍进 long / terminalTitle。
 */
export function tabShortFromTerminalTitle(title: string): string {
  const pathish = pathLikeTerminalTitle(title);
  if (!pathish) {
    return title;
  }
  return basename(pathish);
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
  const pathishOsc = oscTitle ? pathLikeTerminalTitle(oscTitle) : null;
  // 路径型 OSC：short 用叶子名；long/titlebar/tooltip 优先绝对 cwd（OSC 7），
  // 避免 shell 标题被 ~ 化 / 中间省略后顶栏与 hover 仍难辨。
  let oscShort: string | null | undefined = oscTitle;
  if (pathishOsc) {
    oscShort = args.effectiveCwd
      ? basename(args.effectiveCwd)
      : tabShortFromTerminalTitle(oscTitle ?? pathishOsc);
  }
  const cwdShort = args.effectiveCwd ? basename(args.effectiveCwd) : null;
  // Ghostty / 业界：
  // short = 显式覆盖 → OSC（路径则 basename）→ 目录名
  // long  = 路径型优先绝对 cwd → 非路径 OSC 全文 → cwd → chrome
  const short = chromeTitle ?? oscShort ?? cwdShort ?? "Terminal";
  let long: string | undefined;
  if (pathishOsc) {
    long = args.effectiveCwd ?? oscTitle ?? chromeTitle ?? undefined;
  } else {
    long =
      oscTitle ??
      (args.effectiveCwd ? args.effectiveCwd : undefined) ??
      chromeTitle ??
      undefined;
  }
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
