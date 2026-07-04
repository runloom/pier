import type { AgentKind } from "@shared/contracts/agent.ts";
import type { AgentHookEventPayload } from "@shared/contracts/agent-session.ts";
import type {
  ActivityStatus,
  AgentActivity,
  ForegroundActivity,
  ShellActivity,
  TaskActivity,
} from "@shared/contracts/foreground-activity.ts";

/**
 * ForegroundActivity 聚合器的模型层：常量、Entry 结构、newX 工厂、
 * timer 释放、turn 记账、TTL 武装。
 *
 * 纯数据/纯函数——聚合逻辑见 aggregator.ts。语义源自 loomdesk / 老
 * AgentSessionAggregator，逐字迁移以保 tests 回归覆盖。
 */

/** debounce 广播批量（EMIT_DEBOUNCE_MS）。 */
export const EMIT_DEBOUNCE_MS = 100;
/** panelClosed 后的通用冷却，吸收迟到 hook/命令事件。 */
export const CLOSE_COOLDOWN_MS = 5000;
/** SessionEnd 后的短冷却——干净收尾不需要 5s，1.5s 足以拦迟到。 */
export const SESSION_END_COOLDOWN_MS = 1500;
/** hook 静默 30min → status 回落 ready（活动仍存在, 计数 0）。 */
export const HOOK_FRESH_TTL_MS = 30 * 60 * 1000;
/** SessionStart 创建的 agent activity 消抖隐藏时长（防瞬时闪条）。 */
export const VISIBILITY_DEBOUNCE_MS = 250;
/** task 结束后的呈现保留时长（用户看到 exit color 一段时间后自然消失）。 */
export const TASK_EXIT_LINGER_MS = 5000;

/** 回合边界事件（回合结束/切换/错误）——之后的迟到工具事件被吸收。 */
export const TURN_BOUNDARY_EVENTS = new Set(["Stop", "SessionStart", "error"]);
/** 回合重置事件（新回合开始）——解除吸收 + 清 subagent 计数。 */
export const TURN_RESET_EVENTS = new Set([
  "PromptSubmit",
  "processing",
  "running",
]);
/** 会话创建事件——只有正向信号才能建 hook-source 会话（幽灵门控）。 */
export const SESSION_CREATING_EVENTS = new Set([
  "SessionStart",
  "PromptSubmit",
  "ToolStart",
  "PermissionRequest",
]);
/** 子代理事件只做计数, 不改父状态（防 tool→processing 闪跳）。 */
export const SUBAGENT_EVENTS = new Set(["SubagentStart", "SubagentStop"]);
/** Ctrl+Z 悬挂族：128 + {SIGSTOP,SIGTSTP} = 145,146,147,148。 */
export const SUSPENDED_JOB_EXIT_CODES: ReadonlySet<number> = new Set([
  145, 146, 147, 148,
]);

export interface ActivityEntry {
  activity: ForegroundActivity;
  /** 消抖隐藏期为 true——不进 broadcast 条目。 */
  hidden: boolean;
  hookTtlTimer: ReturnType<typeof setTimeout> | null;
  taskLingerTimer: ReturnType<typeof setTimeout> | null;
  turnEnded: boolean;
  visibilityTimer: ReturnType<typeof setTimeout> | null;
}

export interface TimerCtx {
  entries: Map<string, ActivityEntry>;
  now: () => number;
  scheduleEmit: () => void;
}

export function clearHookTtlTimer(entry: ActivityEntry): void {
  if (entry.hookTtlTimer) {
    clearTimeout(entry.hookTtlTimer);
    entry.hookTtlTimer = null;
  }
}

export function clearVisibilityTimer(entry: ActivityEntry): void {
  if (entry.visibilityTimer) {
    clearTimeout(entry.visibilityTimer);
    entry.visibilityTimer = null;
  }
}

export function clearTaskLingerTimer(entry: ActivityEntry): void {
  if (entry.taskLingerTimer) {
    clearTimeout(entry.taskLingerTimer);
    entry.taskLingerTimer = null;
  }
}

export function clearAllTimers(entry: ActivityEntry): void {
  clearHookTtlTimer(entry);
  clearVisibilityTimer(entry);
  clearTaskLingerTimer(entry);
}

/** hook 静默 30min 后 processing/tool/waiting/error → ready 衰减。 */
export function armHookTtlTimer(
  key: string,
  entry: ActivityEntry,
  ctx: TimerCtx
): void {
  clearHookTtlTimer(entry);
  entry.hookTtlTimer = setTimeout(() => {
    const current = ctx.entries.get(key);
    if (
      current?.activity.kind !== "agent" ||
      current.activity.source !== "hook"
    ) {
      return;
    }
    current.hookTtlTimer = null;
    if (current.activity.status !== "ready") {
      const at = ctx.now();
      current.activity = {
        ...current.activity,
        status: "ready",
        stateStartedAt: at,
        updatedAt: at,
      };
      ctx.scheduleEmit();
    }
  }, HOOK_FRESH_TTL_MS);
}

export function newHookAgentEntry(
  event: AgentHookEventPayload,
  at: number
): ActivityEntry {
  const activity: AgentActivity = {
    kind: "agent",
    agentId: event.agent,
    panelId: event.panelId,
    windowId: event.windowId,
    source: "hook",
    status: "ready",
    subagentCount: 0,
    spawnedAt: at,
    stateStartedAt: at,
    updatedAt: at,
  };
  return {
    hidden: event.event === "SessionStart",
    hookTtlTimer: null,
    visibilityTimer: null,
    taskLingerTimer: null,
    turnEnded: false,
    activity,
  };
}

export function newLaunchAgentEntry(
  windowId: string,
  panelId: string,
  agentId: AgentKind,
  at: number
): ActivityEntry {
  const activity: AgentActivity = {
    kind: "agent",
    agentId,
    panelId,
    windowId,
    source: "launch",
    status: "ready",
    subagentCount: 0,
    spawnedAt: at,
    stateStartedAt: at,
    updatedAt: at,
  };
  return {
    hidden: false,
    hookTtlTimer: null,
    visibilityTimer: null,
    taskLingerTimer: null,
    turnEnded: false,
    activity,
  };
}

export function newTaskEntry(
  windowId: string,
  panelId: string,
  taskId: string,
  label: string,
  at: number
): ActivityEntry {
  const activity: TaskActivity = {
    kind: "task",
    taskId,
    label,
    panelId,
    windowId,
    status: "running",
    spawnedAt: at,
    updatedAt: at,
  };
  return {
    hidden: false,
    hookTtlTimer: null,
    visibilityTimer: null,
    taskLingerTimer: null,
    turnEnded: false,
    activity,
  };
}

export function newShellEntry(
  windowId: string,
  panelId: string,
  commandLine: string,
  at: number
): ActivityEntry {
  const activity: ShellActivity = {
    kind: "shell",
    panelId,
    windowId,
    commandLine: commandLine.slice(0, 4096),
    spawnedAt: at,
    updatedAt: at,
  };
  return {
    hidden: false,
    hookTtlTimer: null,
    visibilityTimer: null,
    taskLingerTimer: null,
    turnEnded: false,
    activity,
  };
}

/**
 * 回合边界/重置/吸收 + 子代理计数记账。返回 false 表示事件应被吸收丢弃。
 * PermissionRequest 豁免吸收——权限弹窗是回合复活的证据。
 */
export function applyTurnBookkeeping(
  entry: ActivityEntry,
  eventName: string
): boolean {
  if (entry.activity.kind !== "agent") {
    return true;
  }
  if (TURN_BOUNDARY_EVENTS.has(eventName)) {
    entry.turnEnded = true;
    entry.activity = { ...entry.activity, subagentCount: 0 };
  } else if (TURN_RESET_EVENTS.has(eventName)) {
    entry.turnEnded = false;
    entry.activity = { ...entry.activity, subagentCount: 0 };
  } else if (eventName === "PermissionRequest") {
    entry.turnEnded = false;
  } else if (entry.turnEnded) {
    return false;
  }
  if (eventName === "SubagentStart") {
    entry.activity = {
      ...entry.activity,
      subagentCount: entry.activity.subagentCount + 1,
    };
  } else if (eventName === "SubagentStop") {
    entry.activity = {
      ...entry.activity,
      subagentCount: Math.max(0, entry.activity.subagentCount - 1),
    };
  }
  return true;
}

/** activity 上设置 agent status（同 status 内保 stateStartedAt 稳定）。 */
export function setAgentStatus(
  entry: ActivityEntry,
  status: ActivityStatus,
  at: number
): void {
  if (entry.activity.kind !== "agent") {
    return;
  }
  const prev = entry.activity;
  if (prev.status === status) {
    entry.activity = { ...prev, updatedAt: at };
  } else {
    entry.activity = {
      ...prev,
      status,
      stateStartedAt: at,
      updatedAt: at,
    };
  }
}
