import type { UsageAggregateSnapshot } from "@shared/contracts/usage-data.ts";
import { create } from "zustand";

interface UsageDataState {
  applyError: (error: unknown) => void;
  applySnapshot: (snapshot: UsageAggregateSnapshot) => void;
  error: string | null;
  /** 加载状态：`idle` = 尚未 read；`ready` = 已收到快照；`error` = 初始读取失败。 */
  loadStatus: "error" | "idle" | "ready";
  reset: () => void;
  snapshot: UsageAggregateSnapshot | null;
}

/**
 * 跨插件成本聚合的 renderer 镜像 store。
 *
 * 写入方：`initUsageDataBridge()`（挂载 preload subscribe 后初值经
 * `window.pier.usageData.read()` 灌入，增量走 broadcast）。
 * 读取方：指挥中心 `core.cost-overview` 物料、`core.cost.*` 指标注册器。
 *
 * `observedAt` 由 aggregator 保证只增不减；此 store 用 `observedAt` 做
 * 单调守卫，避免网络乱序造成快照回退。空聚合（`sourceCount === 0`
 * 且 `observedAt === 0`）视为有效初值，允许物料立刻渲染 empty 态。
 */
export const useUsageDataStore = create<UsageDataState>((set, get) => ({
  error: null,
  loadStatus: "idle",
  snapshot: null,
  applyError: (error) => {
    if (get().loadStatus === "ready") return;
    set({
      error: error instanceof Error ? error.message : String(error),
      loadStatus: "error",
    });
  },
  applySnapshot: (next) => {
    const current = get().snapshot;
    if (current && next.overall.observedAt < current.overall.observedAt) {
      return;
    }
    set({ error: null, loadStatus: "ready", snapshot: next });
  },
  reset: () => {
    set({ error: null, loadStatus: "idle", snapshot: null });
  },
}));

/**
 * 挂载 renderer store 与 preload IPC 的桥：先订阅增量，再拉一次初值，
 * 保证订阅期间发生的广播不会被丢。返回 dispose，卸载时解绑。
 */
export function initUsageDataBridge(): { dispose: () => void } {
  const api = window.pier.usageData;
  const apply = (snapshot: UsageAggregateSnapshot): void => {
    useUsageDataStore.getState().applySnapshot(snapshot);
  };
  const unsubscribe = api.onChanged(apply);
  api
    .read()
    .then(apply)
    .catch((err: unknown) => {
      console.error("[usage-data.store] initial read failed", err);
      useUsageDataStore.getState().applyError(err);
    });
  return {
    dispose: () => {
      unsubscribe();
      useUsageDataStore.getState().reset();
    },
  };
}
