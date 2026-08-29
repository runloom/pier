import type { AgentHookEventPayload } from "@shared/contracts/agent/session.ts";

const MAX_SUBAGENT_SESSION_PARENTS = 256;

/**
 * 只登记「同时带 sessionId 与 parentSessionId」的子会话（droid SessionStart
 * 的 calling_session_id 形）。后续只有子 sessionId 的裸事件仍按子会话丢弃，
 * 避免幽灵主 scope。sessionIdAsParent 的 SubagentStart 会清掉子 sessionId，
 * 本表看不到，靠 actorHint / Subagent* 旁路。
 */
export function createSubagentSessionRegistry() {
  const byPanel = new Map<string, Map<string, string>>();

  function panelMap(panelKey: string): Map<string, string> {
    let map = byPanel.get(panelKey);
    if (!map) {
      map = new Map();
      byPanel.set(panelKey, map);
    }
    return map;
  }

  return {
    remember(panelKey: string, event: AgentHookEventPayload): void {
      const child = event.sessionId?.trim();
      const parent =
        "parentSessionId" in event ? event.parentSessionId?.trim() : undefined;
      if (!(child && parent) || child === parent) {
        return;
      }
      const map = panelMap(panelKey);
      map.delete(child);
      map.set(child, parent);
      if (map.size > MAX_SUBAGENT_SESSION_PARENTS) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined) {
          map.delete(oldest);
        }
      }
    },

    isRegistered(panelKey: string, event: AgentHookEventPayload): boolean {
      const sessionId = event.sessionId?.trim();
      return Boolean(sessionId && byPanel.get(panelKey)?.has(sessionId));
    },

    clearPanel(panelKey: string): void {
      byPanel.delete(panelKey);
    },

    rekeyPanel(sourceKey: string, targetKey: string): void {
      if (sourceKey === targetKey) {
        return;
      }
      const map = byPanel.get(sourceKey);
      if (!map) {
        return;
      }
      byPanel.delete(sourceKey);
      byPanel.set(targetKey, map);
    },

    clearAll(): void {
      byPanel.clear();
    },
  };
}
