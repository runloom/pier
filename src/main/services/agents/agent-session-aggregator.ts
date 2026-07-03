import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  type AgentHookEventPayload,
  type AgentRuntimeStatus,
  type AgentSessionsBroadcast,
  type CommandFinishedHookEvent,
  type CommandStartHookEvent,
  runtimeStatusForHookEvent,
} from "@shared/contracts/agent-session.ts";
import {
  applyTurnBookkeeping,
  CLOSE_COOLDOWN_MS,
  clearAllTimers,
  clearVisibilityTimer,
  EMIT_DEBOUNCE_MS,
  type Entry,
  newHookEntry,
  newLaunchEntry,
  SESSION_CREATING_EVENTS,
  SESSION_END_COOLDOWN_MS,
  SUBAGENT_EVENTS,
  SUSPENDED_JOB_EXIT_CODES,
  sessionKey,
  VISIBILITY_DEBOUNCE_MS,
} from "./agent-session-entry.ts";
import { armHookTtlTimer, type TimerCtx } from "./agent-session-timers.ts";

export interface AgentSessionAggregator {
  /**
   * 先验身份:无需 agent 侧信号即刻建可见 ready 会话。两个调用方——
   * launcher 客户端 (orca launchToken 模式) 与 native OSC 133 C 命令行匹配
   * (matchAgentCommand 词元命中)。豁免关闭冷却; 后续 hook 事件无缝接管。
   */
  agentLaunched(windowId: string, panelId: string, agentId: AgentKind): void;
  /**
   * 前台命令退出(ghostty shell integration command_finished):该面板若有
   * agent 会话说明 agent CLI 已退出——覆盖崩溃/kill 等无 SessionEnd 的路径。
   * 按 panelClosed 同款清理 + 5s 冷却吸收迟到 hook。Ctrl+Z 悬挂 (145-148)
   * 不清理, fg 恢复后 hook 无缝续接。
   */
  commandFinished(panelId: string, exitCode?: number): void;
  dispose(): void;
  /**
   * agentEvent kind 事件（JSONL Path B 主入口）。
   */
  ingestAgentEvent(event: AgentHookEventPayload): void;
  /** commandFinished kind stub——同 ingestCommandStart 的 stub 语义。 */
  ingestCommandFinished(event: CommandFinishedHookEvent): void;
  /**
   * commandStart kind stub——本 aggregator 只消费 agentEvent。
   * discriminated union 完整由 stub 承接；Commit C 引入 ForegroundActivityAggregator
   * 时会给出真身，在此保留仅为让 JsonlObserver 三 kind 分派编译通过。
   */
  ingestCommandStart(event: CommandStartHookEvent): void;
  onChange(cb: (b: AgentSessionsBroadcast) => void): () => void;
  panelClosed(panelId: string): void;
  /** reconcile 对账：该窗口不在 activePanelIds 集合内的会话按 panelClosed 处理。 */
  retainPanels(windowId: string, activePanelIds: readonly string[]): void;
  snapshot(): AgentSessionsBroadcast;
  /** 窗口销毁：清掉该窗口全部会话（含定时器），冷却记录一并写入。 */
  windowClosed(windowId: string): void;
}

export function createAgentSessionAggregator(
  opts: { now?: () => number } = {}
): AgentSessionAggregator {
  const now = opts.now ?? Date.now;
  const entries = new Map<string, Entry>();
  /** key → 冷却截止时刻（不同来源的冷却时长不同, 存过期时间而非起点）。 */
  const cooldownUntil = new Map<string, number>();
  const listeners = new Set<(b: AgentSessionsBroadcast) => void>();
  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  // 广播序号：wall-clock 毫秒会并列（snapshot pull 与 push 同毫秒时 store 的
  // 单调守卫失效, 旧内容可短暂回退）——严格递增序列从构造上排除并列。
  let broadcastSeq = 0;

  function buildBroadcast(): AgentSessionsBroadcast {
    broadcastSeq += 1;
    return {
      sessions: [...entries.values()]
        .filter((e) => !e.hidden)
        .map((e) => ({ ...e.snapshot })),
      ts: broadcastSeq,
    };
  }

  function scheduleEmit(): void {
    if (disposed || emitTimer) {
      return;
    }
    emitTimer = setTimeout(() => {
      emitTimer = null;
      const b = buildBroadcast();
      for (const cb of listeners) {
        cb(b);
      }
    }, EMIT_DEBOUNCE_MS);
  }

  function setStatus(entry: Entry, status: AgentRuntimeStatus): void {
    const at = now();
    if (entry.snapshot.status !== status) {
      entry.snapshot.status = status;
      entry.snapshot.stateStartedAt = at;
    }
    entry.snapshot.updatedAt = at;
  }

  const timerCtx: TimerCtx = { entries, scheduleEmit, setStatus };

  function isInCloseCooldown(key: string): boolean {
    const until = cooldownUntil.get(key);
    if (until === undefined) {
      return false;
    }
    if (now() >= until) {
      cooldownUntil.delete(key);
      return false;
    }
    return true;
  }
  /** 仅移除 entry + 定时器, 不写冷却。 */
  function deleteEntry(key: string): boolean {
    const entry = entries.get(key);
    if (!entry) {
      return false;
    }
    clearAllTimers(entry);
    entries.delete(key);
    return true;
  }

  /** panelClosed 核心逻辑：清 entry + 定时器, 写冷却。不负责 scheduleEmit/清冷却表。 */
  function closeEntry(key: string, cooldownMs = CLOSE_COOLDOWN_MS): boolean {
    const removed = deleteEntry(key);
    cooldownUntil.set(key, now() + cooldownMs);
    return removed;
  }

  function pruneExpiredCooldowns(): void {
    for (const [id, until] of cooldownUntil) {
      if (now() >= until) {
        cooldownUntil.delete(id);
      }
    }
  }

  function createHookEntry(
    key: string,
    event: AgentHookEventPayload,
    at: number
  ): Entry {
    const entry = newHookEntry(event, at);
    entries.set(key, entry);
    if (entry.hidden) {
      entry.visibilityTimer = setTimeout(() => {
        const current = entries.get(key);
        if (!current) {
          return;
        }
        current.visibilityTimer = null;
        if (current.hidden) {
          current.hidden = false;
          scheduleEmit();
        }
      }, VISIBILITY_DEBOUNCE_MS);
    }
    return entry;
  }

  function revealEntry(entry: Entry): void {
    if (entry.hidden) {
      entry.hidden = false;
      clearVisibilityTimer(entry);
    }
  }

  /** SessionStart 豁免冷却; SessionEnd 移除 + 短冷却拦迟到 curl。已消化返 true。 */
  function handleLifecycleEvent(key: string, eventName: string): boolean {
    if (eventName === "SessionStart") {
      cooldownUntil.delete(key);
      return false;
    }
    if (isInCloseCooldown(key)) {
      return true;
    }
    if (eventName === "SessionEnd") {
      const removed = deleteEntry(key);
      cooldownUntil.set(key, now() + SESSION_END_COOLDOWN_MS);
      if (removed) {
        scheduleEmit();
      }
      return true;
    }
    return false;
  }

  /** 取得/创建 hook entry。幽灵门控：终结类迟到事件不得凭空造条目。 */
  function acquireHookEntry(
    key: string,
    event: AgentHookEventPayload,
    at: number
  ): Entry | null {
    const existing = entries.get(key);
    if (existing) {
      if (event.event !== "SessionStart") {
        revealEntry(existing);
      }
      return existing;
    }
    if (!SESSION_CREATING_EVENTS.has(event.event)) {
      return null;
    }
    return createHookEntry(key, event, at);
  }

  return {
    agentLaunched(windowId, panelId, agentId) {
      if (disposed) {
        return;
      }
      const key = sessionKey(panelId);
      // 显式启动 = 新生命周期, 清一切冷却（与 SessionStart 豁免同语义）。
      cooldownUntil.delete(key);
      const existing = entries.get(key);
      if (existing) {
        revealEntry(existing);
        existing.snapshot.agentId = agentId;
      } else {
        entries.set(key, newLaunchEntry(windowId, panelId, agentId, now()));
      }
      scheduleEmit();
    },

    ingestCommandStart(_event) {
      // 现役 aggregator 只消费 agentEvent；commandStart 由 Commit C 的
      // ForegroundActivityAggregator 接管，此处保留 stub 让 JsonlObserver
      // 三 kind 分派与 discriminated union 完整。
    },
    ingestCommandFinished(_event) {
      // 同 ingestCommandStart 的 stub 语义。
    },

    ingestAgentEvent(event) {
      if (disposed) {
        return;
      }
      const key = sessionKey(event.panelId);
      if (handleLifecycleEvent(key, event.event)) {
        return;
      }
      const status = runtimeStatusForHookEvent(event.event);
      if (status === null) {
        return;
      }
      const at = now();
      const entry = acquireHookEntry(key, event, at);
      if (!(entry && applyTurnBookkeeping(entry, event.event))) {
        return;
      }

      entry.snapshot.agentId = event.agent;
      entry.snapshot.source = "hook";
      if (SUBAGENT_EVENTS.has(event.event)) {
        // 纯计数：父状态由真实的工具/推理事件驱动。
        entry.snapshot.updatedAt = at;
      } else {
        setStatus(entry, status);
      }
      armHookTtlTimer(key, entry, timerCtx);
      scheduleEmit();
    },
    commandFinished(panelId, exitCode) {
      if (exitCode !== undefined && SUSPENDED_JOB_EXIT_CODES.has(exitCode)) {
        // Ctrl+Z 悬挂：shell 返回提示符但 agent 进程仍存活（SIGCONT 可恢复）。
        return;
      }
      const key = sessionKey(panelId);
      if (disposed || !entries.has(key)) {
        return;
      }
      if (closeEntry(key)) {
        scheduleEmit();
      }
      pruneExpiredCooldowns();
    },

    panelClosed(panelId) {
      const key = sessionKey(panelId);
      if (closeEntry(key)) {
        scheduleEmit();
      }
      // 顺手清理超期冷却记录, 防 map 无界增长。
      pruneExpiredCooldowns();
    },

    windowClosed(windowId) {
      let anyRemoved = false;
      for (const [key, entry] of [...entries.entries()]) {
        if (entry.snapshot.windowId === windowId && closeEntry(key)) {
          anyRemoved = true;
        }
      }
      if (anyRemoved) {
        scheduleEmit();
      }
      pruneExpiredCooldowns();
    },

    retainPanels(windowId, activePanelIds) {
      const active = new Set(activePanelIds);
      let anyRemoved = false;
      for (const [key, entry] of entries) {
        if (entry.snapshot.windowId !== windowId) {
          continue;
        }
        if (active.has(entry.snapshot.panelId)) {
          continue;
        }
        if (closeEntry(key)) {
          anyRemoved = true;
        }
      }
      if (anyRemoved) {
        scheduleEmit();
      }
      pruneExpiredCooldowns();
    },

    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },

    snapshot: buildBroadcast,

    dispose() {
      disposed = true;
      if (emitTimer) {
        clearTimeout(emitTimer);
        emitTimer = null;
      }
      for (const entry of entries.values()) {
        clearAllTimers(entry);
      }
      entries.clear();
      listeners.clear();
    },
  };
}
