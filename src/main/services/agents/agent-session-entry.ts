import type { AgentSessionSnapshot } from "@shared/contracts/agent-session.ts";

/**
 * agent 会话聚合器的模型层：常量、Entry 结构、key 规则与逐 entry 定时器
 * 清理助手。纯数据/纯函数——聚合逻辑见 agent-session-aggregator.ts。
 */

export const EMIT_DEBOUNCE_MS = 100;
export const CLOSE_COOLDOWN_MS = 5000;
/**
 * SessionEnd 后的短冷却：hook curl 为 fire-and-forget（-m 2）不保序,
 * 乱序迟到的 Stop/ToolComplete 若无冷却会凭空复活幽灵会话（30min 才衰减）。
 * 取远小于 CLOSE_COOLDOWN 的值——SessionEnd 是干净收尾, 不是异常清扫。
 */
export const SESSION_END_COOLDOWN_MS = 1500;
export const HOOK_FRESH_TTL_MS = 30 * 60 * 1000;
export const STALE_WORKING_TITLE_MS = 3000;
/** 标题源 waiting 的衰减上限（与 hook TTL 对称）——否则可永久卡死。 */
export const TITLE_WAITING_TTL_MS = HOOK_FRESH_TTL_MS;
/**
 * 可见性消抖（loomdesk starting-phase 250ms）：SessionStart 创建的会话先隐藏,
 * 防 `claude --version` 这类瞬时命令让状态条闪现闪没；任何后续事件立即揭示。
 */
export const VISIBILITY_DEBOUNCE_MS = 250;

/** 回合边界：之后的迟到工具事件被吸收（loomdesk turn-boundary）。 */
export const TURN_BOUNDARY_EVENTS = new Set(["Stop", "SessionStart", "error"]);
/** 回合重置：新回合开始，解除吸收。 */
export const TURN_RESET_EVENTS = new Set([
  "PromptSubmit",
  "processing",
  "running",
]);
/**
 * 允许"创建"会话的事件——agent 存活的正向信号。迟到的终结类事件
 * （Stop/ToolComplete/SubagentStop/error）不得为已死会话凭空造条目。
 */
export const SESSION_CREATING_EVENTS = new Set([
  "SessionStart",
  "PromptSubmit",
  "ToolStart",
  "PermissionRequest",
]);
/**
 * 前台作业"被停止"而非退出的 shell 状态码族：128 + {SIGSTOP, SIGTSTP}。
 * darwin: SIGSTOP=17→145, SIGTSTP=18→146; linux: 19→147, 20→148。
 */
export const SUSPENDED_JOB_EXIT_CODES: ReadonlySet<number> = new Set([
  145, 146, 147, 148,
]);
/** 子代理事件只做计数, 不改父状态（防 tool→processing 闪跳）。 */
export const SUBAGENT_EVENTS = new Set(["SubagentStart", "SubagentStop"]);

export interface Entry {
  /** SessionStart 创建后的消抖隐藏期内为 true——不进 snapshot/broadcast。 */
  hidden: boolean;
  hookTtlTimer: ReturnType<typeof setTimeout> | null;
  /** 最近一次真实 hook 事件时刻（衰减回调不刷新它；hookIsFresh 的依据）。 */
  lastHookAt: number;
  snapshot: AgentSessionSnapshot;
  titleDecayTimer: ReturnType<typeof setTimeout> | null;
  turnEnded: boolean;
  visibilityTimer: ReturnType<typeof setTimeout> | null;
}

/** panelId 跨窗口不唯一（terminal-panel-id.ts），会话 key 必须带 window scope。 */
export function sessionKey(windowId: string, panelId: string): string {
  return `${windowId}::${panelId}`;
}

export function clearHookTtlTimer(entry: Entry): void {
  if (entry.hookTtlTimer) {
    clearTimeout(entry.hookTtlTimer);
    entry.hookTtlTimer = null;
  }
}

export function clearTitleDecayTimer(entry: Entry): void {
  if (entry.titleDecayTimer) {
    clearTimeout(entry.titleDecayTimer);
    entry.titleDecayTimer = null;
  }
}

export function clearVisibilityTimer(entry: Entry): void {
  if (entry.visibilityTimer) {
    clearTimeout(entry.visibilityTimer);
    entry.visibilityTimer = null;
  }
}

export function clearAllTimers(entry: Entry): void {
  clearHookTtlTimer(entry);
  clearTitleDecayTimer(entry);
  clearVisibilityTimer(entry);
}
