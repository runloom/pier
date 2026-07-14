import { useEffect } from "react";
import { initUsageDataBridge } from "@/stores/usage-data.store.ts";

/**
 * UsageData 桥 — 不渲染任何 UI。app-shell 挂载它以：
 * 1. 先订阅 `PIER_BROADCAST.USAGE_DATA_CHANGED` 广播，再拉一次
 *    `usageData.read()` 拿初值（订阅在先，防止订阅期间发生的广播被丢）。
 * 2. store 用 `overall.observedAt` 做单调守卫，拒收网络乱序快照。
 * 3. 卸载时解绑 + reset store 状态回 idle。
 *
 * 消费方：工作台 `core.cost-overview` 物料 + `core.cost.*` 指标注册器
 * （`src/renderer/lib/workbench/core-metrics.ts`）。
 */
export function UsageDataBridge(): null {
  useEffect(() => {
    const { dispose } = initUsageDataBridge();
    return dispose;
  }, []);
  return null;
}
