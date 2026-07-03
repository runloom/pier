import { useEffect } from "react";
import { registerAgentStatusItem } from "@/panel-kits/terminal/agent-status-item.tsx";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";

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
    let dispose = registerAgentStatusItem();
    let lastKeys = Object.keys(useForegroundActivityStore.getState().activities)
      .sort()
      .join("\n");
    const unsubscribe = useForegroundActivityStore.subscribe((state) => {
      const keys = Object.keys(state.activities).sort().join("\n");
      if (keys === lastKeys) {
        return;
      }
      lastKeys = keys;
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
