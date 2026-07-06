import type { AgentHookEventPayload } from "@shared/contracts/agent-session.ts";
import type {
  ForegroundActivity,
  ForegroundActivityBroadcast,
} from "@shared/contracts/foreground-activity.ts";
import { activityStatusForHookEvent } from "@shared/contracts/foreground-activity.ts";
import {
  logAgentEventDropped,
  logClearForeignHook,
  logCommandFinished,
  logEndHookSession,
  logPtyExitedTaskRetain,
  logRouting,
  setHookStatusWithLog,
} from "./aggregator-tracing.ts";
import {
  type AgentLaunchLayer,
  applyTurnBookkeeping,
  armHookTtlTimer,
  CLOSE_COOLDOWN_MS,
  clearCommandTimers,
  clearHookTimers,
  clearSlotTimers,
  EMIT_DEBOUNCE_MS,
  type HookLayer,
  newAgentLaunchLayer,
  newHookLayer,
  newShellLayer,
  newTaskLayer,
  type PanelSlot,
  projectSlot,
  SESSION_CREATING_EVENTS,
  SESSION_END_COOLDOWN_MS,
  SUBAGENT_EVENTS,
  SUSPENDED_JOB_EXIT_CODES,
  type TimerCtx,
  VISIBILITY_DEBOUNCE_MS,
} from "./entry.ts";
import type {
  ForegroundActivityAggregator,
  ForegroundActivityAggregatorOpts,
} from "./types.ts";

/** ForegroundActivityAggregator：双层 slot 模型，API 见 ./types.ts。 */
export function createForegroundActivityAggregator(
  opts: ForegroundActivityAggregatorOpts = {}
): ForegroundActivityAggregator {
  const now = opts.now ?? Date.now;
  const slots = new Map<string, PanelSlot>();
  /** panel 已死后拦迟到 hook / 命令事件。 */
  const panelCooldownUntil = new Map<string, number>();
  /** hook 收尾后只拦迟到 hook；新命令永不被此冷却拦截。 */
  const hookCooldownUntil = new Map<string, number>();
  const listeners = new Set<(b: ForegroundActivityBroadcast) => void>();
  let emitTimer: NodeJS.Timeout | null = null;
  let disposed = false;
  let broadcastSeq = 0;

  function buildBroadcast(): ForegroundActivityBroadcast {
    broadcastSeq += 1;
    const activities: ForegroundActivity[] = [];
    for (const [panelId, slot] of slots) {
      const activity = projectSlot(panelId, slot);
      if (activity) {
        activities.push(activity);
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

  const timerCtx: TimerCtx = { now, scheduleEmit, slots };

  function isInCooldown(map: Map<string, number>, key: string): boolean {
    const until = map.get(key);
    if (until === undefined) {
      return false;
    }
    if (now() >= until) {
      map.delete(key);
      return false;
    }
    return true;
  }

  function slotFor(key: string): PanelSlot {
    let slot = slots.get(key);
    if (!slot) {
      slot = { command: null, hook: null };
      slots.set(key, slot);
    }
    return slot;
  }

  function dropSlotIfEmpty(key: string): void {
    const slot = slots.get(key);
    if (slot && !slot.command && !slot.hook) {
      slots.delete(key);
    }
  }

  /** 整 slot 清除 + 冷却进指定表。返回是否确有移除（决定要不要 emit）。 */
  function closeSlot(
    key: string,
    cooldown: { map: Map<string, number>; ms: number }
  ): boolean {
    const slot = slots.get(key);
    if (slot) {
      clearSlotTimers(slot);
      slots.delete(key);
    }
    cooldown.map.set(key, now() + cooldown.ms);
    return slot !== undefined;
  }

  function pruneExpiredCooldowns(): void {
    for (const map of [panelCooldownUntil, hookCooldownUntil]) {
      for (const [id, until] of map) {
        if (now() >= until) {
          map.delete(id);
        }
      }
    }
  }

  /** launch 层 250ms 消抖显形（`omp --version` 瞬时命令不闪条）。 */
  function armLaunchVisibility(key: string, layer: AgentLaunchLayer): void {
    layer.visibilityTimer = setTimeout(() => {
      const current = slots.get(key)?.command;
      if (current?.kind !== "agent-launch" || current !== layer) {
        return;
      }
      current.visibilityTimer = null;
      if (current.hidden) {
        current.hidden = false;
        scheduleEmit();
      }
    }, VISIBILITY_DEBOUNCE_MS);
  }

  /** hook 层 SessionStart 消抖显形（防瞬时闪条）。 */
  function armHookVisibility(key: string, layer: HookLayer): void {
    layer.visibilityTimer = setTimeout(() => {
      const current = slots.get(key)?.hook;
      if (current !== layer) {
        return;
      }
      current.visibilityTimer = null;
      if (current.hidden) {
        current.hidden = false;
        scheduleEmit();
      }
    }, VISIBILITY_DEBOUNCE_MS);
  }

  /** 非 SessionStart 的 hook 事件是真实进展证据——立即显形。 */
  function revealHook(hook: HookLayer): void {
    if (hook.hidden) {
      hook.hidden = false;
      if (hook.visibilityTimer) {
        clearTimeout(hook.visibilityTimer);
        hook.visibilityTimer = null;
      }
    }
  }

  /**
   * SessionEnd 干净收尾：只清 hook 层（command 层等 OSC D 自己收），
   * 1.5s 短冷却拦迟到事件。
   */
  function endHookSession(key: string): void {
    const slot = slots.get(key);
    const hook = slot?.hook ?? null;
    if (slot && hook) {
      logEndHookSession(key, hook.agentId);
      clearHookTimers(hook);
      slot.hook = null;
      if (
        slot.command?.kind === "agent-launch" &&
        slot.command.agentId === hook.agentId
      ) {
        clearCommandTimers(slot.command);
        slot.command = null;
      }
      dropSlotIfEmpty(key);
    }
    hookCooldownUntil.set(key, now() + SESSION_END_COOLDOWN_MS);
    if (hook) {
      scheduleEmit();
    }
  }

  /**
   * 取得/新建 hook 层。幽灵门控：终结类迟到事件（Stop/ToolComplete/
   * SubagentStop/error）不得凭空建会话——返回 null 表示事件应被丢弃。
   */
  function acquireHookLayer(
    key: string,
    event: AgentHookEventPayload,
    at: number
  ): HookLayer | null {
    const slot = slotFor(key);
    const existing = slot.hook;
    if (existing) {
      if (event.event !== "SessionStart") {
        revealHook(existing);
      }
      return existing;
    }
    if (!SESSION_CREATING_EVENTS.has(event.event)) {
      dropSlotIfEmpty(key);
      return null;
    }
    const hook = newHookLayer(event, at);
    slot.hook = hook;
    if (hook.hidden) {
      armHookVisibility(key, hook);
    }
    return hook;
  }

  const api: ForegroundActivityAggregator = {
    agentLaunched(windowId, panelId, agentId) {
      if (disposed) {
        return;
      }
      const key = panelId;
      panelCooldownUntil.delete(key);
      hookCooldownUntil.delete(key);
      const slot = slotFor(key);
      const existing = slot.command;
      if (existing?.kind === "agent-launch" && existing.agentId === agentId) {
        // launcher 先验 + OSC 133 C 双击（同 agent）→ 去抖：保层保消抖 timer。
        existing.updatedAt = now();
        existing.windowId = windowId;
      } else {
        if (existing) {
          clearCommandTimers(existing);
        }
        const layer = newAgentLaunchLayer(windowId, agentId, now());
        slot.command = layer;
        armLaunchVisibility(key, layer);
      }
      // 异 agent 的 hook 证据在新 agent 命令启动时作废（loomdesk
      // clearAgentHookActivitiesBySession 同语义）；同 agent 保留——
      // 覆盖 OSC/hook 到达竞态与相邻重启的证据延续。status 仍唯 hook 可写。
      const hook = slot.hook;
      if (hook && hook.agentId !== agentId) {
        logClearForeignHook(key, hook.agentId, agentId);
        clearHookTimers(hook);
        slot.hook = null;
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
      // 只查 panel 死亡冷却：命令收尾的 hook 冷却不拦新命令——
      // 相邻命令 <5s 也必须正常呈现（loomdesk ingestCommandStart 同语义）。
      if (isInCooldown(panelCooldownUntil, key)) {
        return;
      }
      const slot = slotFor(key);
      if (slot.command) {
        clearCommandTimers(slot.command);
      }
      // 只覆盖 command 层——`fg` 等 shell 命令不摧毁挂起 agent 的 hook 证据。
      slot.command = newShellLayer(windowId, commandLine, now());
      scheduleEmit();
    },

    ingestCommandFinished(panelId, exitCode) {
      if (exitCode !== undefined && SUSPENDED_JOB_EXIT_CODES.has(exitCode)) {
        return;
      }
      const key = panelId;
      if (disposed || !slots.has(key)) {
        return;
      }
      logCommandFinished(key, exitCode);
      if (closeSlot(key, { map: hookCooldownUntil, ms: CLOSE_COOLDOWN_MS })) {
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
      const slotBefore = slots.get(key);
      logRouting(event.event, event.agent, key, slotBefore?.hook ?? null);
      if (isInCooldown(panelCooldownUntil, key)) {
        // panel 已死：SessionStart 也不得复活幽灵。
        logAgentEventDropped("suppressed-panel-cooldown", key, event.event);
        return;
      }
      if (event.event === "SessionStart") {
        // 会话开端豁免 hook 收尾冷却。
        hookCooldownUntil.delete(key);
      } else if (isInCooldown(hookCooldownUntil, key)) {
        logAgentEventDropped("suppressed-hook-cooldown", key, event.event);
        return;
      }
      if (event.event === "SessionEnd") {
        endHookSession(key);
        return;
      }
      const status = activityStatusForHookEvent(event.event);
      if (status === null) {
        logAgentEventDropped("status-null", key, event.event);
        return;
      }
      const at = now();
      const hook = acquireHookLayer(key, event, at);
      if (!hook) {
        logAgentEventDropped("ghost-rejected", key, event.event);
        return;
      }
      if (!applyTurnBookkeeping(hook, event.event)) {
        logAgentEventDropped("absorbed", key, event.event, {
          frozenStatus: hook.status,
        });
        return;
      }
      hook.agentId = event.agent;
      if (SUBAGENT_EVENTS.has(event.event)) {
        hook.updatedAt = at;
      } else {
        setHookStatusWithLog(key, hook, status, at, event.agent);
      }
      armHookTtlTimer(key, timerCtx);
      scheduleEmit();
    },

    taskLaunched(panelId, windowId, task) {
      if (disposed) {
        return;
      }
      const key = panelId;
      panelCooldownUntil.delete(key);
      hookCooldownUntil.delete(key);
      const slot = slotFor(key);
      // 用户显式操作优先：task 接管 pty，旧会话证据作废。
      clearSlotTimers(slot);
      slot.hook = null;
      slot.command = newTaskLayer(windowId, task.taskId, task.label, now());
      scheduleEmit();
    },

    taskFinished(panelId, args) {
      const slot = slots.get(panelId);
      const command = slot?.command;
      if (command?.kind !== "task") {
        return;
      }
      command.status = args.status;
      command.updatedAt = now();
      if (args.exitCode !== undefined) {
        command.exitCode = args.exitCode;
      }
      // 终态常驻：task 层保留最终状态直到 panelClosed / rerun(taskLaunched) /
      // 新命令接管——tab 的退出 chrome 由 activity 单源持续供给, 与持久化
      // taskExitTabPatch 的 restore 语义一致（否则 renderer 在活动消失后只能
      // 回退到 mount 时的陈旧 "Running" 基线）。
      scheduleEmit();
    },

    panelClosed(panelId) {
      if (
        closeSlot(panelId, { map: panelCooldownUntil, ms: CLOSE_COOLDOWN_MS })
      ) {
        scheduleEmit();
      }
      pruneExpiredCooldowns();
    },
    ptyExited(panelId) {
      const slot = slots.get(panelId);
      if (slot?.command?.kind === "task") {
        // pty 死亡 ≠ 面板关闭：task 面板仍开着呈现结果；只清 hook 证据。
        logPtyExitedTaskRetain(panelId);
        if (slot.hook) {
          clearHookTimers(slot.hook);
          slot.hook = null;
          scheduleEmit();
        }
        hookCooldownUntil.set(panelId, now() + CLOSE_COOLDOWN_MS);
        pruneExpiredCooldowns();
        return;
      }
      api.panelClosed(panelId);
    },

    windowClosed(windowId) {
      let anyRemoved = false;
      for (const [key, slot] of [...slots.entries()]) {
        const slotWindowId = slot.command?.windowId ?? slot.hook?.windowId;
        if (
          slotWindowId === windowId &&
          closeSlot(key, { map: panelCooldownUntil, ms: CLOSE_COOLDOWN_MS })
        ) {
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
      for (const [key, slot] of [...slots.entries()]) {
        const slotWindowId = slot.command?.windowId ?? slot.hook?.windowId;
        if (slotWindowId !== windowId || active.has(key)) {
          continue;
        }
        if (
          closeSlot(key, { map: panelCooldownUntil, ms: CLOSE_COOLDOWN_MS })
        ) {
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
      for (const slot of slots.values()) {
        clearSlotTimers(slot);
      }
      slots.clear();
      listeners.clear();
    },
  };
  return api;
}
