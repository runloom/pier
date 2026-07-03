import { useEffect } from "react";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";

/**
 * ForegroundActivity 桥 — 不渲染任何 UI。
 * 1. 挂载时 pull 一次全量快照(新窗口/reload 补齐), 随后订阅广播 push。
 * 2. store 内单调 ts 守卫拒收乱序广播。
 *
 * status-item 注册由 agent-sessions-bridge.tsx 继续负责（本 commit 未拆）。
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

  return null;
}
