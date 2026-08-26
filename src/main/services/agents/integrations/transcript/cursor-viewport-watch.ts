import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";
import { cursorTranscriptScopeKey } from "./cursor-question.ts";

const VIEWPORT_POLL_MS = 250;

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
}): CursorViewportWatch {
  const lastContextByScope = new Map<string, AgentHookEventPayload>();
  const timers = new Map<string, ReturnType<typeof setInterval>>();

  const stop = (key: string): void => {
    const timer = timers.get(key);
    if (timer) {
      clearInterval(timer);
      timers.delete(key);
    }
    lastContextByScope.delete(key);
  };

  const start = (context: AgentHookEventPayload): void => {
    const key = cursorTranscriptScopeKey(context);
    lastContextByScope.set(key, context);
    if (!input.enabled || timers.has(key)) {
      return;
    }
    const timer = setInterval(() => {
      const latest = lastContextByScope.get(key);
      if (latest) {
        input.sync(latest);
      }
    }, VIEWPORT_POLL_MS);
    timer.unref();
    timers.set(key, timer);
    input.sync(context);
  };

  return {
    lastContextByScope,
    dispose() {
      for (const key of [...timers.keys()]) {
        stop(key);
      }
    },
    start,
    stop,
    transfer(sourceKey, targetKey, windowId) {
      const timer = timers.get(sourceKey);
      if (timer) {
        clearInterval(timer);
        timers.delete(sourceKey);
      }
      const context = lastContextByScope.get(sourceKey);
      lastContextByScope.delete(sourceKey);
      if (!context) {
        return;
      }
      const moved = { ...context, windowId };
      lastContextByScope.set(targetKey, moved);
      if (timer) {
        start(moved);
      }
    },
  };
}
