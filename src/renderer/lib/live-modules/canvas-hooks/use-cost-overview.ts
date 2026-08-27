import type { UsageAggregateSnapshot } from "@shared/contracts/usage-data.ts";
import { useUsageDataStore } from "@/stores/usage-data.store.ts";

/** `useCostOverview` 跨插件成本聚合 hook 的结构化返回。只读；刷新走 `usageData.refresh`。 */
export interface CanvasCostOverview {
  snapshot: UsageAggregateSnapshot | null;
  status: "error" | "loading" | "ready";
}

/**
 * 成本聚合快照。初值由 `initUsageDataBridge()` 灌入；bridge 未挂载时
 * 停在 loading。刷新经 `host.invoke({ type: "usageData.refresh" })`，
 * 增量经广播回到 store。
 */
function statusOf(state: {
  loadStatus: "error" | "idle" | "ready";
  snapshot: UsageAggregateSnapshot | null;
}): CanvasCostOverview["status"] {
  if (state.loadStatus === "error") return "error";
  return state.snapshot ? "ready" : "loading";
}

export function useCostOverview(): CanvasCostOverview {
  const snapshot = useUsageDataStore((s) => s.snapshot);
  const loadStatus = useUsageDataStore((s) => s.loadStatus);
  return {
    snapshot,
    status: statusOf({ loadStatus, snapshot }),
  };
}
