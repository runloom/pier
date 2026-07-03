import type { AgentHookEventPayload } from "@shared/contracts/agent-session.ts";
import {
  activityStatusForHookEvent,
  type ForegroundActivity,
  type ForegroundActivityBroadcast,
  type TaskActivity,
} from "@shared/contracts/foreground-activity.ts";
import {
  type ActivityEntry,
  applyTurnBookkeeping,
  armHookTtlTimer,
  CLOSE_COOLDOWN_MS,
  clearAllTimers,
  clearHookTtlTimer,
  clearVisibilityTimer,
  EMIT_DEBOUNCE_MS,
  newHookAgentEntry,
  newLaunchAgentEntry,
  newShellEntry,
  newTaskEntry,
  SESSION_CREATING_EVENTS,
  SESSION_END_COOLDOWN_MS,
  SUBAGENT_EVENTS,
  SUSPENDED_JOB_EXIT_CODES,
  setAgentStatus,
  TASK_EXIT_LINGER_MS,
  type TimerCtx,
  VISIBILITY_DEBOUNCE_MS,
} from "./entry.ts";
import type {
  ForegroundActivityAggregator,
  ForegroundActivityAggregatorOpts,
} from "./types.ts";

/**
 * ForegroundActivityAggregator 实现。API 与文档在 ./types.ts。
 *
 * 语义：cooldown 拦迟到 / SessionStart 消抖 250ms / hook TTL 30min 衰减 /
 * subagent 计数 / turn bookkeeping / Ctrl+Z 悬挂例外。逐字迁移自
 * loomdesk 与老 AgentSessionAggregator, 保 tests 回归覆盖。
 */
export function createForegroundActivityAggregator(
  opts: ForegroundActivityAggregatorOpts = {}
): ForegroundActivityAggregator {
  const now = opts.now ?? Date.now;
  const entries = new Map<string, ActivityEntry>();
  /** key → 冷却截止时刻。 */
  const cooldownUntil = new Map<string, number>();
  const ignoredNativeUserClosePanels = new Set<string>();
  const listeners = new Set<(b: ForegroundActivityBroadcast) => void>();
  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let broadcastSeq = 0;

  function buildBroadcast(): ForegroundActivityBroadcast {
    broadcastSeq += 1;
    const activities: ForegroundActivity[] = [];
    for (const entry of entries.values()) {
      if (!entry.hidden) {
        // 浅拷贝防外部 mutate 污染内部 activity 引用
        // (IPC serialize 会 structuredClone, 但同进程内 listener 直接消费引用)。
        activities.push({ ...entry.activity });
      }
    }
    return { activities, ts: broadcastSeq };
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

  const timerCtx: TimerCtx = { entries, scheduleEmit, now };

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

  function deleteEntry(key: string): boolean {
    const entry = entries.get(key);
    if (!entry) {
      return false;
    }
    clearAllTimers(entry);
    entries.delete(key);
    return true;
  }

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

  function revealEntry(entry: ActivityEntry): void {
    if (entry.hidden) {
      entry.hidden = false;
      clearVisibilityTimer(entry);
    }
  }

  function armVisibilityTimer(key: string, entry: ActivityEntry): void {
    if (!entry.hidden) {
      return;
    }
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

  function createHookAgentEntry(
    key: string,
    event: AgentHookEventPayload,
    at: number
  ): ActivityEntry {
    const entry = newHookAgentEntry(event, at);
    entries.set(key, entry);
    armVisibilityTimer(key, entry);
    return entry;
  }

  /** SessionStart 豁免冷却; SessionEnd 移除 + 短冷却拦迟到 hook。已消化返 true。 */
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

  /** 取得/创建 hook agent entry。幽灵门控：终结类迟到事件不得凭空造条目。 */
  function acquireHookAgentEntry(
    key: string,
    event: AgentHookEventPayload,
    at: number
  ): ActivityEntry | null {
    const existing = entries.get(key);
    if (existing?.activity.kind === "agent") {
      if (event.event !== "SessionStart") {
        revealEntry(existing);
      }
      return existing;
    }
    // existing 是 task/shell/idle — 只有 SESSION_CREATING 事件才允许覆盖为
    // agent activity。迟到的终结事件 (Stop/ToolComplete/SubagentStop/error)
    // 不能凭空销毁用户显式建立的 task/shell 活动 (review Commit C P1#1)。
    if (!SESSION_CREATING_EVENTS.has(event.event)) {
      return null;
    }
    if (existing) {
      clearAllTimers(existing);
      entries.delete(key);
    }
    return createHookAgentEntry(key, event, at);
  }

  const api: ForegroundActivityAggregator = {
    agentLaunched(windowId, panelId, agentId) {
      if (disposed) {
        return;
      }
      const key = panelId;
      cooldownUntil.delete(key);
      const existing = entries.get(key);
      if (existing && existing.activity.kind === "agent") {
        revealEntry(existing);
        // hook 侧的 TTL timer 无效了（launch 是新生命周期）——清掉
        // 防止 30min 后回落 ready 的 callback 意外触发。
        clearHookTtlTimer(existing);
        existing.activity = {
          ...existing.activity,
          agentId,
        };
      } else {
        if (existing) {
          clearAllTimers(existing);
        }
        entries.set(
          key,
          newLaunchAgentEntry(windowId, panelId, agentId, now())
        );
      }
      scheduleEmit();
    },

    ingestCommandStarted(panelId, windowId, commandLine, matchedAgent) {
      if (disposed) {
        return;
      }
      if (matchedAgent !== null) {
        api.agentLaunched(windowId, panelId, matchedAgent);
        return;
      }
      const key = panelId;
      if (isInCloseCooldown(key)) {
        return;
      }
      const existing = entries.get(key);
      if (existing) {
        clearAllTimers(existing);
      }
      entries.set(key, newShellEntry(windowId, panelId, commandLine, now()));
      scheduleEmit();
    },

    ingestCommandFinished(panelId, exitCode) {
      if (exitCode !== undefined && SUSPENDED_JOB_EXIT_CODES.has(exitCode)) {
        return;
      }
      const key = panelId;
      if (disposed || !entries.has(key)) {
        return;
      }
      if (closeEntry(key)) {
        scheduleEmit();
      }
      pruneExpiredCooldowns();
    },

    ingestCommandStartHook(_event) {
      // 保 discriminated union 完整——目前无 consumer。
    },
    ingestCommandFinishedHook(_event) {
      // 同上。
    },

    ingestAgentEvent(event) {
      if (disposed) {
        return;
      }
      const key = event.panelId;
      if (handleLifecycleEvent(key, event.event)) {
        return;
      }
      const status = activityStatusForHookEvent(event.event);
      if (status === null) {
        return;
      }
      const at = now();
      const entry = acquireHookAgentEntry(key, event, at);
      if (!(entry && applyTurnBookkeeping(entry, event.event))) {
        return;
      }
      if (entry.activity.kind === "agent") {
        entry.activity = {
          ...entry.activity,
          agentId: event.agent,
          source: "hook",
        };
      }
      if (SUBAGENT_EVENTS.has(event.event)) {
        if (entry.activity.kind === "agent") {
          entry.activity = { ...entry.activity, updatedAt: at };
        }
      } else {
        setAgentStatus(entry, status, at);
      }
      armHookTtlTimer(key, entry, timerCtx);
      scheduleEmit();
    },

    taskLaunched(panelId, windowId, task) {
      if (disposed) {
        return;
      }
      const key = panelId;
      cooldownUntil.delete(key);
      const existing = entries.get(key);
      if (existing) {
        clearAllTimers(existing);
      }
      entries.set(
        key,
        newTaskEntry(windowId, panelId, task.taskId, task.label, now())
      );
      scheduleEmit();
    },

    taskFinished(panelId, args) {
      const key = panelId;
      const entry = entries.get(key);
      if (entry?.activity.kind !== "task") {
        return;
      }
      const at = now();
      const nextActivity: TaskActivity = {
        ...entry.activity,
        status: args.status,
        updatedAt: at,
        ...(args.exitCode === undefined ? {} : { exitCode: args.exitCode }),
      };
      entry.activity = nextActivity;
      // 幂等：linger timer 一旦启动就不重置——防止 native 层多次上报
      // taskExit 导致 linger 无限延长, 用户看不到 activity 消失。
      if (!entry.taskLingerTimer) {
        entry.taskLingerTimer = setTimeout(() => {
          const current = entries.get(key);
          if (current?.activity.kind !== "task") {
            return;
          }
          current.taskLingerTimer = null;
          if (closeEntry(key, TASK_EXIT_LINGER_MS)) {
            scheduleEmit();
          }
        }, TASK_EXIT_LINGER_MS);
      }
      scheduleEmit();
    },

    panelClosed(panelId) {
      const key = panelId;
      if (closeEntry(key)) {
        scheduleEmit();
      }
      pruneExpiredCooldowns();
    },

    windowClosed(windowId) {
      let anyRemoved = false;
      for (const [key, entry] of [...entries.entries()]) {
        if (entry.activity.windowId === windowId && closeEntry(key)) {
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
        if (entry.activity.windowId !== windowId) {
          continue;
        }
        if (active.has(entry.activity.panelId)) {
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

    ignoreNextNativeUserClose(panelId) {
      ignoredNativeUserClosePanels.add(panelId);
    },
    consumeIgnoreNativeUserClose(panelId) {
      return ignoredNativeUserClosePanels.delete(panelId);
    },
    resetPanel(panelId) {
      ignoredNativeUserClosePanels.delete(panelId);
      cooldownUntil.delete(panelId);
    },

    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },

    snapshot(windowId) {
      const b = buildBroadcast();
      if (windowId === undefined) {
        return b;
      }
      return {
        activities: b.activities.filter((a) => a.windowId === windowId),
        ts: b.ts,
      };
    },

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
      ignoredNativeUserClosePanels.clear();
    },
  };
  return api;
}
