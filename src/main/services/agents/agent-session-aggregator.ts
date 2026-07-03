import {
  detectAgentIdFromTitle,
  detectAgentStatusFromTitle,
  runtimeStatusForTitleStatus,
  titleLooksLikeAgentContext,
} from "@shared/agent-title-status.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  type AgentHookEvent,
  type AgentRuntimeStatus,
  type AgentSessionsBroadcast,
  runtimeStatusForHookEvent,
} from "@shared/contracts/agent-session.ts";
import {
  applyTurnBookkeeping,
  CLOSE_COOLDOWN_MS,
  clearAllTimers,
  clearHookTtlTimer,
  clearTitleDecayTimer,
  clearVisibilityTimer,
  EMIT_DEBOUNCE_MS,
  type Entry,
  HOOK_FRESH_TTL_MS,
  newHookEntry,
  newLaunchEntry,
  newTitleEntry,
  SESSION_CREATING_EVENTS,
  SESSION_END_COOLDOWN_MS,
  SUBAGENT_EVENTS,
  SUSPENDED_JOB_EXIT_CODES,
  sessionKey,
  VISIBILITY_DEBOUNCE_MS,
} from "./agent-session-entry.ts";
import {
  armHookTtlTimer,
  armTitleDecayForStatus,
  type TimerCtx,
} from "./agent-session-timers.ts";

export interface AgentSessionAggregator {
  /**
   * 先验身份:无需 agent 侧信号即刻建可见 ready 会话。两个调用方——
   * launcher 客户端 (orca launchToken 模式) 与 shell preexec 命令上报
   * (命令行可执行体命中 agent 词元)。豁免关闭冷却; 后续 hook/标题信号
   * 无缝接管。
   */
  agentLaunched(windowId: string, panelId: string, agentId: AgentKind): void;
  /**
   * 前台命令退出(ghostty shell integration command_finished):该面板若有
   * agent 会话说明 agent CLI 已退出——覆盖崩溃/kill 等无 SessionEnd 的路径。
   * 按 panelClosed 同款清理 + 5s 冷却吸收迟到 hook。Ctrl+Z 悬挂 (145-148)
   * 不清理, fg 恢复后 hook 无缝续接。
   */
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

  /**
   * ingestTitle 分支:标题既无状态 glyph 又无身份 token 时的处理——
   * 若 existing 是 title-source 且新标题也不像 agent 上下文(纯 shell 提示符),
   * 视为用户已从 agent 退回 shell, 清 entry 让图标还原。hook-source 或有 agent
   * 上下文的过渡标题(如 droid `⛬ 新会话` 保留 ⛬ 前缀)不受影响。
   */
  function handleTitleWithoutSignals(
    key: string,
    existing: Entry | undefined,
    title: string
  ): void {
    if (
      !(existing && existing.snapshot.source === "title") ||
      titleLooksLikeAgentContext(title)
    ) {
      return;
    }
    if (closeEntry(key)) {
      scheduleEmit();
    }
  }

  /** 取得/创建 title entry。无身份 idle 标题不建（普通 shell 防误报）。 */
  function acquireTitleEntry(
    key: string,
    windowId: string,
    panelId: string,
    status: AgentRuntimeStatus,
    titleAgentId: string | null
  ): Entry | null {
    const existing = entries.get(key);
    if (existing) {
      return existing;
    }
    if (status === "ready" && titleAgentId === null) {
      return null;
    }
    const entry = newTitleEntry(windowId, panelId, now());
    entries.set(key, entry);
    return entry;
  }

  return {
    agentLaunched(windowId, panelId, agentId) {
      if (disposed) {
        return;
      }
      const key = sessionKey(windowId, panelId);
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
      armHookTtlTimer(key, entry, timerCtx);
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
      const titleAgentId = detectAgentIdFromTitle(title);
      // 决定进入通道：
      // (a) 标题有可识别状态 glyph → 走原路径, 状态即 titleStatus。
      // (b) 标题无状态 glyph 但有 agent 身份 token(如 droid 的 "⛬ Droid")
      //     → 视为 ready, 用「有身份」补齐入口, 让图标至少能点亮。
      //     detectAgentIdFromTitle 自带两道误报防御: prompt OSC 形态
      //     (cwd/user@host 回显)直接 null + 品牌词必须锚定标题开头——
      //     worktree 路径/分支名里的 codex/claude 字样不会点亮图标。
      // (c) 都无 → 转 handleTitleWithoutSignals 判断是否为「退回 shell」。
      if (titleStatus === null && titleAgentId === null) {
        handleTitleWithoutSignals(key, existing, title);
        return;
      }
      const status =
        titleStatus === null
          ? "ready"
          : runtimeStatusForTitleStatus(titleStatus);
      const entry = acquireTitleEntry(
        key,
        windowId,
        panelId,
        status,
        titleAgentId
      );
      if (!entry) {
        return;
      }
      revealEntry(entry);
      entry.snapshot.source = "title";
      if (titleAgentId !== null && entry.snapshot.agentId === undefined) {
        // 只补全缺失身份, 不覆盖 hook 已确认的 agentId。
        entry.snapshot.agentId = titleAgentId;
      }
      clearHookTtlTimer(entry);
      setStatus(entry, status);
      armTitleDecayForStatus(key, entry, status, timerCtx);
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
