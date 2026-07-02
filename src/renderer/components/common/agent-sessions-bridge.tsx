import { useEffect } from "react";
import { registerAgentStatusItem } from "@/panel-kits/terminal/agent-status-item.tsx";
import { useAgentSessionStore } from "@/stores/agent-session.store.ts";

/**
 * Agent 会话状态桥 — 不渲染任何 UI。
 * 1. 挂载时 pull 一次全量快照(新窗口/reload 补齐), 随后订阅广播 push。
 * 2. 注册终端状态栏 agent item(核心项, 不走 plugin host)。
 */
export function AgentSessionsBridge() {
  useEffect(() => {
    const apply = useAgentSessionStore.getState().apply;
    window.pier.agentSessions
      .snapshot()
      .then(apply)
      .catch(() => undefined);
    return window.pier.agentSessions.onChanged(apply);
  }, []);

  useEffect(() => {
    let dispose = registerAgentStatusItem();
    let lastKeys = Object.keys(useAgentSessionStore.getState().sessions)
      .sort()
      .join("\n");
    const unsubscribe = useAgentSessionStore.subscribe((state) => {
      const keys = Object.keys(state.sessions).sort().join("\n");
      if (keys === lastKeys) {
        return;
      }
      lastKeys = keys;
      // 重新注册触发 registry notify → TerminalStatusBar 重跑 isVisible,
      // 让空条不再为无会话面板保留高度。
      dispose();
      dispose = registerAgentStatusItem();
    });
    return () => {
      unsubscribe();
      dispose();
    };
  }, []);

  return null;
}
