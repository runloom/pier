import type { UsageAggregateSnapshot } from "@shared/contracts/usage-data.ts";
import { useUsageDataStore } from "@/stores/usage-data.store.ts";

/** `pier/canvas` 跨插件成本聚合 hook 的结构化返回。 */
export interface CanvasCostOverview {
  /** 手动刷新聚合缓存；等价旧成本卡头部刷新按钮（store 方法，非命令）。 */
  refresh: () => Promise<void>;
  snapshot: UsageAggregateSnapshot | null;
  status: "error" | "loading" | "ready";
}

/**
 * 成本聚合快照。初值由 `initUsageDataBridge()` 灌入；bridge 未挂载时
 * 停在 loading。刷新走 preload `refreshAll()`，增量经广播回到 store。
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
    refresh: () => window.pier.usageData.refreshAll(),
    snapshot,
    status: statusOf({ loadStatus, snapshot }),
  };
}
