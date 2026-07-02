import type {
  AgentSessionSnapshot,
  AgentSessionsBroadcast,
} from "@shared/contracts/agent-session.ts";
import { create } from "zustand";

interface AgentSessionState {
  apply: (b: AgentSessionsBroadcast) => void;
  sessions: Record<string, AgentSessionSnapshot>;
  ts: number;
}

/**
 * Agent 会话状态镜像 — main 聚合器快照的 renderer 副本。
 * 写入方: AgentSessionsBridge (初始 snapshot pull + 广播 push)。
 * 读取方: 终端状态栏 agent item、TitleBar 聚合计数。
 * ts 单调守卫拒收乱序广播。
 */
export const useAgentSessionStore = create<AgentSessionState>((set, get) => ({
  sessions: {},
  ts: 0,
  apply: (b) => {
    if (b.ts < get().ts) {
      return;
    }
    set({
      sessions: Object.fromEntries(b.sessions.map((s) => [s.panelId, s])),
      ts: b.ts,
    });
  },
}));

export function agentSessionCounts(
  sessions: Record<string, AgentSessionSnapshot>
): { running: number; waiting: number } {
  let running = 0;
  let waiting = 0;
  for (const s of Object.values(sessions)) {
    if (s.status === "processing" || s.status === "tool") {
      running += 1;
    } else if (s.status === "waiting") {
      waiting += 1;
    }
  }
  return { running, waiting };
}
