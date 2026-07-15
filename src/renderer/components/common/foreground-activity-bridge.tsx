import type { ForegroundActivityBroadcast } from "@shared/contracts/foreground-activity.ts";
import { useEffect } from "react";
import {
  currentElectronWindowId,
  rememberElectronWindowId,
} from "@/lib/agent-runtime/current-window-id.ts";
import { registerAgentStatusItem } from "@/panel-kits/terminal/agent-status-item.tsx";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";

function rememberWindowIdFromActivities(
  activities: ForegroundActivityBroadcast["activities"]
): void {
  const windowId = activities[0]?.windowId;
  if (windowId) {
    rememberElectronWindowId(windowId);
  }
}

/**
 * ForegroundActivity 桥 — 不渲染任何 UI。
 * 1. 挂载时 pull 一次全量快照(新窗口/reload 补齐), 随后订阅广播 push。
 * 2. store 内单调 ts 守卫拒收乱序广播。
 * 3. 注册终端状态栏 agent item(核心项, 不走 plugin host); activity key 集合
 *    变化时重新 register 触发 registry notify → TerminalStatusBar 重跑 isVisible,
 *    让空条不再为无 agent activity 面板保留高度。
 * 4. 缓存本窗 electron windowId（WindowContext + FA），供 Index 同窗加权。
 * 任务运行状态只由终端 panel 内浮层呈现，不再进入底部状态栏。
 */
export function ForegroundActivityBridge(): null {
  useEffect(() => {
    // 触发 getContext 种子；有缓存则 no-op。
    currentElectronWindowId();
    const apply = (snapshot: ForegroundActivityBroadcast): void => {
      rememberWindowIdFromActivities(snapshot.activities);
      useForegroundActivityStore.getState().apply(snapshot);
    };
    let active = true;
    const unsubscribe = window.pier.foregroundActivity.onChanged(apply);
    window.pier.foregroundActivity
      .snapshot()
      .then((snapshot) => {
        if (active) {
          apply(snapshot);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
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

  return null;
}
