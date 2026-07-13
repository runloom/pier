import type { AgentHookEventPayload } from "@shared/contracts/agent-session.ts";
import type {
  ActivityStatus,
  ForegroundActivity,
  ForegroundActivityBroadcast,
} from "@shared/contracts/foreground-activity.ts";
import { activityStatusForHookEvent } from "@shared/contracts/foreground-activity.ts";
import {
  createHookScopeCoordinator,
  isInCooldown,
} from "./aggregator-hook-scopes.ts";
import { keysForPanel, panelKey } from "./aggregator-panel-key.ts";
import {
  logAgentEventDropped,
  logClearForeignHook,
  logCommandFinished,
  logEndHookSession,
  logPtyExitedTaskRetain,
  logRouting,
} from "./aggregator-tracing.ts";
import {
  armHookVisibility,
  armLaunchVisibility,
  revealHook,
} from "./aggregator-visibility.ts";
import {
  armHookTtlTimer,
  CLOSE_COOLDOWN_MS,
  clearCommandTimers,
  clearHookTimers,
  clearSlotTimers,
  EMIT_DEBOUNCE_MS,
  getOrCreateHookScope,
  type HookLayer,
  hookScopeIdentity,
  newAgentLaunchLayer,
  newHookLayer,
  newShellLayer,
  newTaskLayer,
  type PanelSlot,
  projectSlot,
  SESSION_CREATING_EVENTS,
  SESSION_END_COOLDOWN_MS,
  SUSPENDED_JOB_EXIT_CODES,
  type TimerCtx,
} from "./entry.ts";
import {
  applyTurnBookkeeping,
  hookScopeHasActiveTools,
} from "./turn-bookkeeping.ts";
import type {
  ForegroundActivityAggregator,
  ForegroundActivityAggregatorOpts,
} from "./types.ts";

export function createForegroundActivityAggregator(
  opts: ForegroundActivityAggregatorOpts = {}
): ForegroundActivityAggregator {
  const now = opts.now ?? Date.now;
  const slots = new Map<string, PanelSlot>();
  const panelCooldownUntil = new Map<string, number>();
  const hookCooldownUntil = new Map<string, number>();
  const listeners = new Set<(b: ForegroundActivityBroadcast) => void>();
  let emitTimer: NodeJS.Timeout | null = null;
  let disposed = false;
  let broadcastSeq = 0;

  function buildBroadcast(): ForegroundActivityBroadcast {
    broadcastSeq += 1;
    const activities: ForegroundActivity[] = [];
    for (const slot of slots.values()) {
      const activity = projectSlot(slot.panelId, slot);
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

  function slotFor(key: string, panelId: string): PanelSlot {
    let slot = slots.get(key);
    if (!slot) {
      slot = { command: null, hook: null, panelId };
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

  function commandOwnedAgent(slot: PanelSlot | undefined) {
    return slot?.command?.kind === "agent-launch" ? slot.command.agentId : null;
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
    hookScopes.clearCooldownsForPanel(key);
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
    hookScopes.pruneExpiredCooldowns();
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
    hookScopes.clearCooldownsForPanel(key);
    hookCooldownUntil.set(key, now() + SESSION_END_COOLDOWN_MS);
    if (hook) {
      scheduleEmit();
    }
  }

  const hookScopes = createHookScopeCoordinator({
    endHookSession,
    hookCooldownUntil,
    now,
    panelCooldownUntil,
    scheduleEmit,
    slots,
  });

  /**
   * 取得/新建 hook 层。幽灵门控：终结类迟到事件（Stop/ToolComplete/
   * SubagentStop/error）不得凭空建会话——返回 null 表示事件应被丢弃。
   */
  function acquireHookLayer(
    key: string,
    event: AgentHookEventPayload,
    at: number
  ): HookLayer | null {
    const slot = slotFor(key, event.panelId);
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
      armHookVisibility(key, hook, { scheduleEmit, slots });
    }
    return hook;
  }

  const api: ForegroundActivityAggregator = {
    agentLaunched(windowId, panelId, agentId) {
      if (disposed) {
        return;
      }
      const key = panelKey(windowId, panelId);
      panelCooldownUntil.delete(key);
      hookCooldownUntil.delete(key);
      const slot = slotFor(key, panelId);
      const existing = slot.command;
      if (existing?.kind === "agent-launch" && existing.agentId === agentId) {
        existing.updatedAt = now();
        existing.windowId = windowId;
      } else {
        if (existing) {
          clearCommandTimers(existing);
        }
        const layer = newAgentLaunchLayer(windowId, agentId, now());
        slot.command = layer;
        armLaunchVisibility(key, layer, { scheduleEmit, slots });
      }
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
      const key = panelKey(windowId, panelId);
      if (isInCooldown(panelCooldownUntil, key, now)) {
        return;
      }
      const slot = slotFor(key, panelId);
      if (slot.command) {
        clearCommandTimers(slot.command);
      }
      slot.command = newShellLayer(windowId, commandLine, now());
      scheduleEmit();
    },

    ingestCommandFinished(panelId, exitCode, windowId) {
      if (exitCode !== undefined && SUSPENDED_JOB_EXIT_CODES.has(exitCode)) {
        return;
      }
      if (disposed) {
        return;
      }
      let removed = false;
      for (const key of keysForPanel(slots, panelId, windowId)) {
        logCommandFinished(key, exitCode);
        removed =
          closeSlot(key, { map: hookCooldownUntil, ms: CLOSE_COOLDOWN_MS }) ||
          removed;
      }
      if (removed) {
        scheduleEmit();
      }
      pruneExpiredCooldowns();
    },

    ingestCommandStartHook(_event) {},
    ingestCommandFinishedHook(_event) {},

    ingestAgentEvent(event, options) {
      if (disposed) {
        return false;
      }
      const key = panelKey(event.windowId, event.panelId);
      const slotBefore = slots.get(key);
      logRouting(event.event, event.agent, key, slotBefore?.hook ?? null);
      const ownerAgent =
        commandOwnedAgent(slotBefore) ?? slotBefore?.hook?.agentId;
      if (
        ownerAgent !== null &&
        ownerAgent !== undefined &&
        ownerAgent !== event.agent
      ) {
        logAgentEventDropped("foreign-agent-hook", key, event.event, {
          eventAgent: event.agent,
          ownerAgent,
        });
        return false;
      }
      const identity = hookScopeIdentity(event);
      if (!hookScopes.allowsAgentEventAfterCooldowns(key, event, identity)) {
        return false;
      }
      const sessionEndHandled = hookScopes.handleSessionEnd(
        key,
        event,
        identity
      );
      if (sessionEndHandled !== null) {
        return sessionEndHandled;
      }
      const status = activityStatusForHookEvent(event.event);
      if (status === null) {
        logAgentEventDropped("status-null", key, event.event);
        return false;
      }
      const at = now();
      const hook = acquireHookLayer(key, event, at);
      if (!hook) {
        logAgentEventDropped("ghost-rejected", key, event.event);
        return false;
      }
      const existingScope = hook.scopes.get(identity.key);
      if (event.event === "SessionStart" && existingScope) {
        return true;
      }
      const scope = getOrCreateHookScope(hook, identity, at);
      const stopAuthority = options.stopAuthority;
      if (!applyTurnBookkeeping(scope, event, stopAuthority)) {
        logAgentEventDropped("absorbed", key, event.event, {
          ...(scope.status === undefined ? {} : { frozenStatus: scope.status }),
        });
        return false;
      }
      let nextStatus: ActivityStatus | undefined = status;
      if (scope.completionObserved) {
        nextStatus = undefined;
      } else if (
        event.event === "ToolComplete" &&
        (!event.toolUseId?.trim() || hookScopeHasActiveTools(scope))
      ) {
        nextStatus = "tool";
      }
      hookScopes.noteStatusEvent(
        key,
        hook,
        scope,
        event,
        nextStatus,
        at,
        stopAuthority
      );
      armHookTtlTimer(key, timerCtx);
      scheduleEmit();
      return true;
    },

    taskLaunched(panelId, windowId, task) {
      if (disposed) {
        return;
      }
      const key = panelKey(windowId, panelId);
      panelCooldownUntil.delete(key);
      hookCooldownUntil.delete(key);
      const slot = slotFor(key, panelId);
      // 用户显式操作优先：task 接管 pty，旧会话证据作废。
      clearSlotTimers(slot);
      slot.hook = null;
      slot.command = newTaskLayer(
        windowId,
        task.taskId,
        task.label,
        task.runId,
        now()
      );
      scheduleEmit();
    },

    taskFinished(panelId, args, windowId) {
      for (const key of keysForPanel(slots, panelId, windowId)) {
        const command = slots.get(key)?.command;
        if (command?.kind !== "task" || command.runId !== args.runId) {
          continue;
        }
        command.status = args.status;
        command.updatedAt = now();
        if (args.exitCode !== undefined) {
          command.exitCode = args.exitCode;
        }
        scheduleEmit();
        return;
      }
      // 终态常驻：task 层保留最终状态直到 panelClosed / rerun(taskLaunched) /
      // 新命令接管。activity 只保留任务活动投影和 TaskRuns 不可用时的兼容回退；
      // 实时任务状态由带 runId 的 TaskRunsSnapshot 负责。
    },

    panelClosed(panelId, windowId) {
      let removed = false;
      for (const key of keysForPanel(slots, panelId, windowId)) {
        removed =
          closeSlot(key, { map: panelCooldownUntil, ms: CLOSE_COOLDOWN_MS }) ||
          removed;
      }
      if (removed) {
        scheduleEmit();
      }
      pruneExpiredCooldowns();
    },
    ptyExited(panelId, windowId) {
      const keys = keysForPanel(slots, panelId, windowId);
      for (const key of keys) {
        const slot = slots.get(key);
        if (slot?.command?.kind !== "task") {
          continue;
        }
        // pty 死亡 ≠ 面板关闭：task 面板仍开着呈现结果；只清 hook 证据。
        logPtyExitedTaskRetain(key);
        if (slot.hook) {
          clearHookTimers(slot.hook);
          slot.hook = null;
          scheduleEmit();
        }
        hookCooldownUntil.set(key, now() + CLOSE_COOLDOWN_MS);
        pruneExpiredCooldowns();
        return;
      }
      api.panelClosed(panelId, windowId);
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
        if (slotWindowId !== windowId || active.has(slot.panelId)) {
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
