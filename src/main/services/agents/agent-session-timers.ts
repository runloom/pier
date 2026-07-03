import type { AgentRuntimeStatus } from "@shared/contracts/agent-session.ts";
import {
  clearHookTtlTimer,
  type Entry,
  HOOK_FRESH_TTL_MS,
} from "./agent-session-entry.ts";

export interface TimerCtx {
  entries: Map<string, Entry>;
  scheduleEmit: () => void;
  setStatus: (entry: Entry, status: AgentRuntimeStatus) => void;
}

/** hook 静默 30min：processing/tool/waiting/error → ready（orca 衰减）。 */
export function armHookTtlTimer(
  key: string,
  entry: Entry,
  ctx: TimerCtx
): void {
  clearHookTtlTimer(entry);
  entry.hookTtlTimer = setTimeout(() => {
    const current = ctx.entries.get(key);
    if (current?.snapshot.source !== "hook") {
      return;
    }
    current.hookTtlTimer = null;
    if (current.snapshot.status !== "ready") {
      ctx.setStatus(current, "ready");
      ctx.scheduleEmit();
    }
  }, HOOK_FRESH_TTL_MS);
}
