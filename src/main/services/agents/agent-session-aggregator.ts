import {
  detectAgentStatusFromTitle,
  runtimeStatusForTitleStatus,
} from "@shared/agent-title-status.ts";
import {
  type AgentHookEvent,
  type AgentRuntimeStatus,
  type AgentSessionsBroadcast,
  runtimeStatusForHookEvent,
} from "@shared/contracts/agent-session.ts";
import {
  CLOSE_COOLDOWN_MS,
  clearAllTimers,
  clearHookTtlTimer,
  clearTitleDecayTimer,
  clearVisibilityTimer,
  EMIT_DEBOUNCE_MS,
  type Entry,
  HOOK_FRESH_TTL_MS,
  SESSION_CREATING_EVENTS,
  SESSION_END_COOLDOWN_MS,
  STALE_WORKING_TITLE_MS,
  SUBAGENT_EVENTS,
  SUSPENDED_JOB_EXIT_CODES,
  sessionKey,
  TITLE_WAITING_TTL_MS,
  TURN_BOUNDARY_EVENTS,
  TURN_RESET_EVENTS,
  VISIBILITY_DEBOUNCE_MS,
} from "./agent-session-entry.ts";

export interface AgentSessionAggregator {
  /**
   * 前台命令退出（ghostty shell integration command_finished）：该面板若有
   * agent 会话说明 agent CLI 已退出——覆盖崩溃/kill 等无 SessionEnd 的路径,
   * 亦兜底标题启发式会话。按 panelClosed 同款清理 + 5s 冷却吸收迟到 hook。
   * 无会话面板 no-op（普通 shell 命令不受影响）。
   * 已知限制：Ctrl+Z 悬挂同样触发 command_finished, 会话短暂消失, fg 后
   * 由后续 hook 事件自愈（见计划文档已知风险）。
   */
  /** exitCode 为悬挂家族（128+SIGSTOP/SIGTSTP, darwin/linux: 145-148）时
   * 视为 Ctrl+Z 暂停而非退出, 不清理——fg 恢复后 hook 事件无缝续接。 */
  commandFinished(windowId: string, panelId: string, exitCode?: number): void;
  dispose(): void;
  ingestHookEvent(event: AgentHookEvent): void;
  ingestTitle(windowId: string, panelId: string, title: string): void;
  onChange(cb: (b: AgentSessionsBroadcast) => void): () => void;
  panelClosed(windowId: string, panelId: string): void;
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

  /** hook 静默 30min：processing/tool/waiting/error → ready（orca 衰减）。 */
  function armHookTtlTimer(key: string, entry: Entry): void {
    clearHookTtlTimer(entry);
    entry.hookTtlTimer = setTimeout(() => {
      const current = entries.get(key);
      if (current?.snapshot.source !== "hook") {
        return;
      }
      current.hookTtlTimer = null;
      if (current.snapshot.status !== "ready") {
        setStatus(current, "ready");
        scheduleEmit();
      }
    }, HOOK_FRESH_TTL_MS);
  }

  /**
   * 标题源衰减：working 3s 无新标题 → ready（orca 过期标题清理）；
   * waiting 30min 无更新 → ready（防永久卡死）。独立槽位——不与 hook TTL
   * 互相 clobber（单槽位曾导致一条杂散 hook 把 3s 快衰减顶成 30min）。
   */
  function armTitleDecayTimer(
    key: string,
    entry: Entry,
    ms: number,
    guardStatus: AgentRuntimeStatus
  ): void {
    clearTitleDecayTimer(entry);
    entry.titleDecayTimer = setTimeout(() => {
      const current = entries.get(key);
      if (current?.snapshot.source !== "title") {
        return;
      }
      current.titleDecayTimer = null;
      if (current.snapshot.status === guardStatus) {
        setStatus(current, "ready");
        scheduleEmit();
      }
    }, ms);
  }

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

  function hookIsFresh(entry: Entry): boolean {
    // 以最近一次真实 hook 事件计龄, 而非 updatedAt——衰减回调会为 UI 刷新
    // updatedAt, 若据其判断, hook 抑制窗口会被衰减本身无限续期。
    return (
      entry.snapshot.source === "hook" &&
      now() - entry.lastHookAt <= HOOK_FRESH_TTL_MS
    );
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
    event: AgentHookEvent,
    at: number
  ): Entry {
    const entry: Entry = {
      // SessionStart 独享消抖隐藏：其余创建事件意味着已有真实活动。
      hidden: event.event === "SessionStart",
      hookTtlTimer: null,
      lastHookAt: at,
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
      titleDecayTimer: null,
      turnEnded: false,
      visibilityTimer: null,
    };
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

  /**
   * 回合边界/重置/吸收 + 子代理计数记账。返回 false 表示事件应被吸收丢弃。
   * PermissionRequest 豁免吸收：权限弹窗本身就是回合复活的证据, 吞掉它会让
   * 用户在 agent 实际阻塞等确认时看到 ready——功能最核心的信号不可吞。
   */
  function applyTurnBookkeeping(entry: Entry, eventName: string): boolean {
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

  /**
   * 生命周期前置处理：SessionStart 豁免一切冷却（SessionEnd 短冷却、
   * relaunch/panelClosed 5s 冷却都不应吞掉紧随其后的重启）；SessionEnd
   * 整会话移除 + 短冷却拦乱序迟到 curl。返回 true 表示事件已被消化。
   */
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
    event: AgentHookEvent,
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
    ingestHookEvent(event) {
      if (disposed) {
        return;
      }
      const key = sessionKey(event.windowId, event.panelId);
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

      entry.lastHookAt = at;
      entry.snapshot.agentId = event.agent;
      entry.snapshot.source = "hook";
      // hook 接管后标题衰减不再适用（guard 也会 no-op, 清掉纯为整洁）。
      clearTitleDecayTimer(entry);
      if (SUBAGENT_EVENTS.has(event.event)) {
        // 纯计数：父状态由真实的工具/推理事件驱动。
        entry.snapshot.updatedAt = at;
      } else {
        setStatus(entry, status);
      }
      armHookTtlTimer(key, entry);
      scheduleEmit();
    },

    ingestTitle(windowId, panelId, title) {
      const key = sessionKey(windowId, panelId);
      if (disposed || isInCloseCooldown(key)) {
        return;
      }
      const existing = entries.get(key);
      if (existing && hookIsFresh(existing)) {
        // hook 优先：显式信号新鲜时抑制标题启发式（orca 抑制规则）。
        return;
      }
      const titleStatus = detectAgentStatusFromTitle(title);
      if (titleStatus === null) {
        return;
      }
      const status = runtimeStatusForTitleStatus(titleStatus);
      let entry = existing;
      if (!entry) {
        if (status === "ready") {
          // 不为普通 shell / 空闲标题建会话, 避免全体终端都出现 agent 状态。
          return;
        }
        const at = now();
        entry = {
          hidden: false,
          hookTtlTimer: null,
          lastHookAt: 0,
          snapshot: {
            panelId,
            source: "title",
            stateStartedAt: at,
            status: "ready",
            subagentCount: 0,
            updatedAt: at,
            windowId,
          },
          titleDecayTimer: null,
          turnEnded: false,
          visibilityTimer: null,
        };
        entries.set(key, entry);
      }
      revealEntry(entry);
      entry.snapshot.source = "title";
      clearHookTtlTimer(entry);
      setStatus(entry, status);
      if (status === "processing") {
        armTitleDecayTimer(key, entry, STALE_WORKING_TITLE_MS, "processing");
      } else if (status === "waiting") {
        armTitleDecayTimer(key, entry, TITLE_WAITING_TTL_MS, "waiting");
      } else {
        clearTitleDecayTimer(entry);
      }
      scheduleEmit();
    },

    commandFinished(windowId, panelId, exitCode) {
      if (exitCode !== undefined && SUSPENDED_JOB_EXIT_CODES.has(exitCode)) {
        // Ctrl+Z 悬挂：shell 返回提示符但 agent 进程仍存活（SIGCONT 可恢复）。
        return;
      }
      const key = sessionKey(windowId, panelId);
      if (disposed || !entries.has(key)) {
        return;
      }
      if (closeEntry(key)) {
        scheduleEmit();
      }
      pruneExpiredCooldowns();
    },

    panelClosed(windowId, panelId) {
      const key = sessionKey(windowId, panelId);
      if (closeEntry(key)) {
        scheduleEmit();
      }
      // 顺手清理超期冷却记录, 防 map 无界增长。
      pruneExpiredCooldowns();
    },

    windowClosed(windowId) {
      const prefix = `${windowId}::`;
      let anyRemoved = false;
      for (const key of [...entries.keys()]) {
        if (key.startsWith(prefix) && closeEntry(key)) {
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
      const prefix = `${windowId}::`;
      let anyRemoved = false;
      for (const [key, entry] of entries) {
        if (!key.startsWith(prefix)) {
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
