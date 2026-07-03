import type { AgentKind } from "@shared/contracts/agent.ts";
import type {
  AgentHookEvent,
  AgentSessionSnapshot,
} from "@shared/contracts/agent-session.ts";

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
  snapshot: AgentSessionSnapshot;
  turnEnded: boolean;
  visibilityTimer: ReturnType<typeof setTimeout> | null;
}

/** 会话 key = panelId 单键（Identity 终态 §1.3）。保留函数签名兼容，方便未来删除。 */
export function sessionKey(panelId: string): string {
  return panelId;
}

export function clearHookTtlTimer(entry: Entry): void {
  if (entry.hookTtlTimer) {
    clearTimeout(entry.hookTtlTimer);
    entry.hookTtlTimer = null;
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
  clearVisibilityTimer(entry);
}

/** hook 事件创建的 entry 字面量（不含定时器武装——那需要聚合器闭包）。 */
export function newHookEntry(event: AgentHookEvent, at: number): Entry {
  return {
    // SessionStart 独享消抖隐藏：其余创建事件意味着已有真实活动。
    hidden: event.event === "SessionStart",
    hookTtlTimer: null,
    snapshot: {
      agentId: event.agent,
      panelId: event.panelId,
      source: "hook",
      stateStartedAt: at,
      status: "ready",
      subagentCount: 0,
      updatedAt: at,
      windowId: event.windowId,
    },
    turnEnded: false,
    visibilityTimer: null,
  };
}

/**
 * 回合边界/重置/吸收 + 子代理计数记账。返回 false 表示事件应被吸收丢弃。
 * PermissionRequest 豁免吸收：权限弹窗本身就是回合复活的证据, 吞掉它会让
 * 用户在 agent 实际阻塞等确认时看到 ready——功能最核心的信号不可吞。
 */
export function applyTurnBookkeeping(entry: Entry, eventName: string): boolean {
  if (TURN_BOUNDARY_EVENTS.has(eventName)) {
    entry.turnEnded = true;
    entry.snapshot.subagentCount = 0;
  } else if (TURN_RESET_EVENTS.has(eventName)) {
    entry.turnEnded = false;
    entry.snapshot.subagentCount = 0;
  } else if (eventName === "PermissionRequest") {
    entry.turnEnded = false;
  } else if (entry.turnEnded) {
    // 回合已结束, 吸收迟到事件（防止旧回合尾巴打错状态）。
    return false;
  }
  if (eventName === "SubagentStart") {
    entry.snapshot.subagentCount += 1;
  } else if (eventName === "SubagentStop") {
    entry.snapshot.subagentCount = Math.max(
      0,
      entry.snapshot.subagentCount - 1
    );
  }
  return true;
}

/** launcher 客户端先验身份创建的 entry（orca launchToken 模式）：创建即可见。 */
export function newLaunchEntry(
  windowId: string,
  panelId: string,
  agentId: AgentKind,
  at: number
): Entry {
  return {
    hidden: false,
    hookTtlTimer: null,
    snapshot: {
      agentId,
      panelId,
      source: "launch",
      stateStartedAt: at,
      status: "ready",
      subagentCount: 0,
      updatedAt: at,
      windowId,
    },
    turnEnded: false,
    visibilityTimer: null,
  };
}
