import type { PierResourceSnapshot } from "@shared/contracts/pier-resource.ts";
import { create } from "zustand";

const POLL_INTERVAL_MS = 2000;
/** CPU 序列容量：2s 采样 × 150 ≈ 5 分钟窗口。 */
const HISTORY_CAP = 150;

export interface PierResourceHistoryPoint {
  ts: number;
  value: number;
}

interface PierResourceState {
  /** 相关合计 CPU（单核比例 0–n），趋势图数据源。 */
  cpuHistory: readonly PierResourceHistoryPoint[];
  error: string | null;
  snapshot: PierResourceSnapshot | null;
}

/**
 * Pier 资源镜像 —— 拉取式轮询（acquire 计数门控），无人订阅即零开销。
 * 消费方：Canvas 聚合 hook `useSystemResources` 与 `useHostSnapshot("resources")`。
 */
export const usePierResourceStore = create<PierResourceState>(() => ({
  cpuHistory: [],
  error: null,
  snapshot: null,
}));

let pollRefCount = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

export async function pollPierResourceOnce(): Promise<void> {
  try {
    const snapshot = await window.pier.resources.snapshot();
    usePierResourceStore.setState((state) => ({
      cpuHistory:
        snapshot.summary.totalRelatedCpuPercent === null
          ? state.cpuHistory
          : [
              ...state.cpuHistory.slice(-(HISTORY_CAP - 1)),
              {
                ts: snapshot.sampledAt,
                value: snapshot.summary.totalRelatedCpuPercent,
              },
            ],
      error: null,
      snapshot,
    }));
  } catch (err) {
    // 非用户触发的后台轮询：失败表现为快照停更，下一拍自动重试，不 toast。
    const message = err instanceof Error ? err.message : String(err);
    usePierResourceStore.setState({ error: message });
  }
}

/**
 * 引用计数式启动轮询。面板可见的消费方 acquire，不可见/卸载时 release；
 * 计数归零即停表。
 */
export function acquirePierResourcePolling(): () => void {
  pollRefCount += 1;
  if (pollRefCount === 1 && pollTimer === null) {
    pollPierResourceOnce();
    pollTimer = setInterval(() => {
      pollPierResourceOnce();
    }, POLL_INTERVAL_MS);
  }
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    pollRefCount -= 1;
    if (pollRefCount === 0 && pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}
