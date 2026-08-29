import {
  isSubagentHookEvent,
  SUBAGENT_HOOK_EVENTS,
} from "@shared/agent-session-actor.ts";
import type { ForegroundActivityBroadcast } from "@shared/contracts/foreground-activity.ts";
import { clearForegroundAgentCommandFinished } from "./agent-session-ended.ts";
import { classifyAgentTurnEvent } from "./agent-turn-event-semantics.ts";
import {
  applyAgentLaunched,
  applyUnmatchedCommandStarted,
  finishPanelCommands,
} from "./aggregator-command.ts";
import {
  createHookScopeCoordinator,
  isInCooldown,
} from "./aggregator-hook-scopes.ts";
import { keysForPanel, panelKey } from "./aggregator-panel-key.ts";
import { transferPanelOwnership as rekeyPanelOwnership } from "./aggregator-panel-transfer.ts";
import {
  closeWindowPanels,
  retainWindowPanels,
} from "./aggregator-retain-panels.ts";
import {
  clearPanelSlotSessionTitle,
  hydratePanelSlotSessionTitle,
  setPanelSlotSessionTitle,
} from "./aggregator-session-title.ts";
import {
  buildForegroundActivityBroadcast,
  createPanelSlotRegistry,
} from "./aggregator-slots.ts";
import {
  logAgentEventDropped,
  logEndHookSession,
  logPtyExitedTaskRetain,
  logRouting,
  nativeEventForLog,
} from "./aggregator-tracing.ts";
import { acquireHookLayer, revealHook } from "./aggregator-visibility.ts";
import { bindEventToClaimedTurn } from "./claimed-turns.ts";
import { applyDisplayQuestionOverlay } from "./display-question.ts";
import {
  CLOSE_COOLDOWN_MS,
  clearCommandTimers,
  clearHookTimers,
  clearSlotTimers,
  EMIT_DEBOUNCE_MS,
  getOrCreateHookScope,
  hookScopeIdentity,
  newTaskLayer,
  type PanelSlot,
  SESSION_END_COOLDOWN_MS,
  type TimerCtx,
} from "./entry.ts";
import { armHookTtlTimer } from "./hook-scope-projection.ts";
import { createSubagentSessionRegistry } from "./subagent-session-registry.ts";
import {
  applyTurnBookkeeping as bookkeepTurn,
  nextStatusAfterTurnBookkeeping,
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
    return buildForegroundActivityBroadcast(slots, broadcastSeq);
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
  const { dropSlotIfEmpty, slotFor } = createPanelSlotRegistry(slots);
  const subagentSessions = createSubagentSessionRegistry();
  function commandOwnedAgent(slot: PanelSlot | undefined) {
    return slot?.command?.kind === "agent-launch" ? slot.command.agentId : null;
  }

  function closeSlot(
    key: string,
    cooldown: { map: Map<string, number>; ms: number }
  ): boolean {
    const slot = slots.get(key);
    if (slot) {
      clearSlotTimers(slot);
      slots.delete(key);
    }
    subagentSessions.clearPanel(key);
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

  const retainCtx = () => ({
    closeSlot,
    panelCooldownUntil,
    pruneExpiredCooldowns,
    scheduleEmit,
    slots,
  });
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

  const api: ForegroundActivityAggregator = {
    agentLaunched(windowId, panelId, agentId) {
      if (disposed) {
        return;
      }
      applyAgentLaunched({
        agentId,
        hookCooldownUntil,
        now,
        panelCooldownUntil,
        panelId,
        scheduleEmit,
        slotFor,
        slots,
        windowId,
      });
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
      if (
        applyUnmatchedCommandStarted(
          slotFor(key, panelId),
          windowId,
          commandLine,
          now()
        )
      ) {
        scheduleEmit();
      }
    },

    ingestCommandFinished(panelId, exitCode, windowId) {
      if (disposed) {
        return;
      }
      if (
        finishPanelCommands({
          closeSlot,
          exitCode,
          hookCooldownUntil,
          panelId,
          slots,
          windowId,
        })
      ) {
        scheduleEmit();
      }
      pruneExpiredCooldowns();
    },

    ingestCommandStartHook(_event) {},
    ingestCommandFinishedHook(_event) {},
    ingestAgentEvent(incoming, options) {
      if (disposed) {
        return false;
      }
      let event = incoming;
      const semantics = classifyAgentTurnEvent(event, options);
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
      subagentSessions.remember(key, event);
      if (
        (isSubagentHookEvent(event) ||
          subagentSessions.isRegistered(key, event)) &&
        !SUBAGENT_HOOK_EVENTS.has(event.event) &&
        semantics.category !== "session-end"
      ) {
        logAgentEventDropped("subagent-detail-ignored", key, event.event);
        return false;
      }
      let identity = hookScopes.resolveEventIdentity(
        slotBefore?.hook ?? null,
        event,
        hookScopeIdentity(event)
      );
      if (!identity) return false;
      if (slotBefore?.hook) {
        ({ event, identity } = bindEventToClaimedTurn(
          slotBefore.hook,
          event,
          identity,
          semantics
        ));
      }
      if (
        !hookScopes.allowsAgentEventAfterCooldowns(
          key,
          event,
          identity,
          semantics
        )
      ) {
        return false;
      }
      const sessionEndHandled = hookScopes.handleSessionEnd(
        key,
        event,
        identity,
        semantics
      );
      if (sessionEndHandled !== null) {
        return sessionEndHandled;
      }
      const at = now();
      const hook = acquireHookLayer(
        key,
        event,
        semantics,
        at,
        slotFor,
        dropSlotIfEmpty,
        { scheduleEmit, slots }
      );
      if (!hook) {
        logAgentEventDropped("ghost-rejected", key, event.event);
        return false;
      }
      if (hookScopes.prepareSessionStartScope(hook, identity, semantics)) {
        return true;
      }
      const canUseScope =
        hook.scopes.has(identity.key) || semantics.createsSession;
      if (!canUseScope) {
        logAgentEventDropped("ghost-rejected", key, event.event);
        return false;
      }
      const scope = getOrCreateHookScope(hook, identity, event, at);
      const workId = identity.subagentWorkPlan?.id;
      const overlayBefore = scope.displayQuestionId;
      const result = bookkeepTurn(scope, event, semantics, at, workId);
      applyDisplayQuestionOverlay(scope, event, options.evidenceSource);
      const overlayChanged = scope.displayQuestionId !== overlayBefore;
      if (!(result.accepted || overlayChanged)) {
        logAgentEventDropped("absorbed", key, event.event, {
          evidenceSource: options.evidenceSource,
          ...(scope.status === undefined ? {} : { frozenStatus: scope.status }),
          nativeEvent: nativeEventForLog(event),
          rejectionReason: result.reason,
        });
        return false;
      }
      if (semantics.category !== "session-start") {
        revealHook(hook);
      }
      const nextStatus = nextStatusAfterTurnBookkeeping(scope, semantics);
      hookScopes.noteStatusEvent(
        key,
        hook,
        scope,
        identity,
        event,
        nextStatus,
        at,
        semantics,
        result.accepted ? result : { accepted: true, transition: "none" },
        options
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
        const slot = slots.get(key);
        const command = slot?.command;
        if (!slot || command?.kind !== "task" || command.runId !== args.runId) {
          continue;
        }
        clearSlotTimers(slot);
        slot.command = null;
        scheduleEmit();
        return;
      }
    },

    panelClosed(panelId, windowId) {
      clearForegroundAgentCommandFinished(panelId, windowId);
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
      closeWindowPanels(retainCtx(), windowId);
    },

    retainPanels(windowId, activePanelIds) {
      retainWindowPanels(retainCtx(), windowId, activePanelIds);
    },
    transferPanelOwnership(input) {
      rekeyPanelOwnership(
        {
          hookCooldownUntil,
          panelCooldownUntil,
          rekeySubagentSessions: subagentSessions.rekeyPanel,
          scheduleEmit,
          slots,
        },
        input
      );
    },

    setAgentSessionTitle(windowId, panelId, input) {
      return setPanelSlotSessionTitle(
        { disposed, scheduleEmit, slotFor },
        windowId,
        panelId,
        input
      );
    },
    hydrateAgentSessionTitle(windowId, panelId, input) {
      hydratePanelSlotSessionTitle(
        { disposed, scheduleEmit, slotFor },
        windowId,
        panelId,
        input
      );
    },
    clearAgentSessionTitle(windowId, panelId) {
      clearPanelSlotSessionTitle(
        { disposed, scheduleEmit, slotFor },
        windowId,
        panelId
      );
    },
    onChange(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },

    hasAgentPresence(panelId, windowId) {
      const slot = slots.get(panelKey(windowId, panelId));
      return Boolean(slot?.hook || slot?.command?.kind === "agent-launch");
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
      subagentSessions.clearAll();
      listeners.clear();
    },
  };
  return api;
}
