import { useEffect } from "react";
import { registerAgentStatusItem } from "@/panel-kits/terminal/agent-status-item.tsx";
import { registerTaskStatusItem } from "@/panel-kits/terminal/task-status-item.tsx";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";
import { useTerminalTaskHistoryStore } from "@/stores/terminal-task-history.store.ts";

function terminalTaskHistoryPanelsKey(): string {
  return Object.entries(useTerminalTaskHistoryStore.getState().panels)
    .filter(([, tasks]) => Object.keys(tasks).length > 0)
    .map(([panelId]) => panelId)
    .sort()
    .join("\n");
}

/**
 * ForegroundActivity 桥 — 不渲染任何 UI。
 * 1. 挂载时 pull 一次全量快照(新窗口/reload 补齐), 随后订阅广播 push。
 * 2. store 内单调 ts 守卫拒收乱序广播。
 * 3. 注册终端状态栏 agent item(核心项, 不走 plugin host); activity key 集合
 *    变化时重新 register 触发 registry notify → TerminalStatusBar 重跑 isVisible,
 *    让空条不再为无 agent activity 面板保留高度。
 */
export function ForegroundActivityBridge(): null {
  useEffect(() => {
    const apply = useForegroundActivityStore.getState().apply;
    window.pier.foregroundActivity
      .snapshot()
      .then(apply)
      .catch(() => undefined);
    return window.pier.foregroundActivity.onChanged(apply);
  }, []);

  useEffect(() => {
    let disposeAgent = registerAgentStatusItem();
    let lastKeys = Object.keys(useForegroundActivityStore.getState().activities)
      .sort()
      .join("\n");
    const unsubscribe = useForegroundActivityStore.subscribe((state) => {
      const keys = Object.keys(state.activities).sort().join("\n");
      if (keys === lastKeys) {
        return;
      }
      lastKeys = keys;
      disposeAgent();
      disposeAgent = registerAgentStatusItem();
    });
    return () => {
      unsubscribe();
      disposeAgent();
    };
  }, []);

  useEffect(() => {
    let disposeTask = registerTaskStatusItem();
    let lastKeys = terminalTaskHistoryPanelsKey();
    const unsubscribe = useTerminalTaskHistoryStore.subscribe(() => {
      const keys = terminalTaskHistoryPanelsKey();
      if (keys === lastKeys) {
        return;
      }
      lastKeys = keys;
      disposeTask();
      disposeTask = registerTaskStatusItem();
    });
    return () => {
      unsubscribe();
      disposeTask();
    };
  }, []);

  return null;
}
