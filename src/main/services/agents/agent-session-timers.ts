import type { AgentRuntimeStatus } from "@shared/contracts/agent-session.ts";
import {
  clearHookTtlTimer,
  clearTitleDecayTimer,
  type Entry,
  HOOK_FRESH_TTL_MS,
  STALE_WORKING_TITLE_MS,
  TITLE_WAITING_TTL_MS,
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

/** 标题源衰减:working 3s / waiting 30min → ready。独立槽位不与 hook TTL 互相 clobber。 */
function armTitleDecayTimer(
  key: string,
  entry: Entry,
  ms: number,
  guardStatus: AgentRuntimeStatus,
  ctx: TimerCtx
): void {
  clearTitleDecayTimer(entry);
  entry.titleDecayTimer = setTimeout(() => {
    const current = ctx.entries.get(key);
    if (current?.snapshot.source !== "title") {
      return;
    }
    current.titleDecayTimer = null;
    if (current.snapshot.status === guardStatus) {
      ctx.setStatus(current, "ready");
      ctx.scheduleEmit();
    }
  }, ms);
}

/** 按标题状态武装/清除衰减定时器（working 3s / waiting 30min）。 */
export function armTitleDecayForStatus(
  key: string,
  entry: Entry,
  status: AgentRuntimeStatus,
  ctx: TimerCtx
): void {
  if (status === "processing") {
    armTitleDecayTimer(key, entry, STALE_WORKING_TITLE_MS, "processing", ctx);
  } else if (status === "waiting") {
    armTitleDecayTimer(key, entry, TITLE_WAITING_TTL_MS, "waiting", ctx);
  } else {
    clearTitleDecayTimer(entry);
  }
}
