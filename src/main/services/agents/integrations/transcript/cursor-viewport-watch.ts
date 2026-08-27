import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { cursorTranscriptScopeKey } from "./cursor-question.ts";

const VIEWPORT_POLL_MS = 250;
const VIEWPORT_POLL_MAX_MS = 1000;
const VIEWPORT_DUMP_SLOW_MS = 20;

export interface CursorViewportWatch {
  dispose(): void;
  /**
   * scope key → 最近观察上下文。禁用轮询时也维护——release/transfer 的
   * per-scope 清理以它为索引，不得因无视口读取器而漏清。
   */
  lastContextByScope: Map<string, AgentHookEventPayload>;
  start(context: AgentHookEventPayload): void;
  stop(key: string): void;
  transfer(sourceKey: string, targetKey: string, windowId: string): void;
}

/** 250ms 轮询可读视口，驱动问卷/方案 waiting 的出现与解除（jsonl 常滞后）。 */
export function createCursorViewportWatch(input: {
  enabled: boolean;
  sync: (context: AgentHookEventPayload) => void;
  /**
   * Resize / surface-suppress windows: skip the dump so we do not contend
   * with the renderer for `renderer_state.mutex`. Timer keeps running.
   */
  shouldSkipTick?: () => boolean;
}): CursorViewportWatch {
  const lastContextByScope = new Map<string, AgentHookEventPayload>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pollIntervals = new Map<string, number>();

  const clearTimer = (key: string): void => {
    const timer = timers.get(key);
    if (timer) {
      clearTimeout(timer);
    }
    timers.delete(key);
  };

  const stop = (key: string): void => {
    clearTimer(key);
    pollIntervals.delete(key);
    lastContextByScope.delete(key);
  };

  const schedule = (key: string): void => {
    clearTimer(key);
    const delay = pollIntervals.get(key) ?? VIEWPORT_POLL_MS;
    const timer = setTimeout(() => {
      timers.delete(key);
      const latest = lastContextByScope.get(key);
      if (!latest) {
        return;
      }
      if (input.shouldSkipTick?.()) {
        // Keep base cadence while suppressed; do not escalate backoff.
        pollIntervals.set(key, VIEWPORT_POLL_MS);
        schedule(key);
        return;
      }
      const startedAt = performance.now();
      try {
        input.sync(latest);
        const elapsed = performance.now() - startedAt;
        if (elapsed >= VIEWPORT_DUMP_SLOW_MS) {
          const next = Math.min(
            VIEWPORT_POLL_MAX_MS,
            (pollIntervals.get(key) ?? VIEWPORT_POLL_MS) * 2
          );
          pollIntervals.set(key, next);
        } else {
          pollIntervals.set(key, VIEWPORT_POLL_MS);
        }
      } catch {
        pollIntervals.set(key, VIEWPORT_POLL_MS);
      } finally {
        if (lastContextByScope.has(key)) {
          schedule(key);
        }
      }
    }, delay);
    timer.unref?.();
    timers.set(key, timer);
  };

  const start = (context: AgentHookEventPayload): void => {
    const key = cursorTranscriptScopeKey(context);
    lastContextByScope.set(key, context);
    if (!input.enabled || timers.has(key)) {
      return;
    }
    pollIntervals.set(key, VIEWPORT_POLL_MS);
    input.sync(context);
    schedule(key);
  };

  return {
    lastContextByScope,
    dispose() {
      for (const key of [...timers.keys()]) {
        stop(key);
      }
      for (const key of [...lastContextByScope.keys()]) {
        stop(key);
      }
    },
    start,
    stop,
    transfer(sourceKey, targetKey, windowId) {
      const hadTimer = timers.has(sourceKey);
      clearTimer(sourceKey);
      pollIntervals.delete(sourceKey);
      const context = lastContextByScope.get(sourceKey);
      lastContextByScope.delete(sourceKey);
      if (!context) {
        return;
      }
      const moved = { ...context, windowId };
      lastContextByScope.set(targetKey, moved);
      if (hadTimer) {
        start(moved);
      }
    },
  };
}
