import type { SystemStatsSnapshot } from "@shared/contracts/system-stats.ts";
import { create } from "zustand";

const POLL_INTERVAL_MS = 2000;
/** CPU 序列容量：2s 采样 × 150 ≈ 5 分钟窗口。 */
const HISTORY_CAP = 150;

export interface SystemStatsHistoryPoint {
  ts: number;
  value: number;
}

interface SystemStatsState {
  /** 全系统 CPU 占用序列（0-1），趋势图数据源。 */
  cpuHistory: readonly SystemStatsHistoryPoint[];
  snapshot: SystemStatsSnapshot | null;
}

/**
 * 系统资源镜像 —— 拉取式轮询（acquire 计数门控），无人订阅即零开销。
 * 消费方：system-resources 物料、指标目录的 system.* 指标。
 */
export const useSystemStatsStore = create<SystemStatsState>(() => ({
  cpuHistory: [],
  snapshot: null,
}));

let pollRefCount = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function pollOnce(): Promise<void> {
  try {
    const snapshot = await window.pier.systemStats.snapshot();
    useSystemStatsStore.setState((state) => ({
      cpuHistory:
        snapshot.cpuUsage === null
          ? state.cpuHistory
          : [
              ...state.cpuHistory.slice(-(HISTORY_CAP - 1)),
              { ts: snapshot.sampledAt, value: snapshot.cpuUsage },
            ],
      snapshot,
    }));
  } catch {
    // 非用户触发的后台轮询：失败表现为快照停更（UI 保持旧值/占位态），
    // 下一拍自动重试，不产生 toast 噪声。
  }
}

/**
 * 引用计数式启动轮询。面板可见的消费方 acquire，不可见/卸载时 release；
 * 计数归零即停表——满足"visible=false 时轮询必须停"的协议红线。
 */
export function acquireSystemStatsPolling(): () => void {
  pollRefCount += 1;
  if (pollRefCount === 1 && pollTimer === null) {
    // pollOnce 内部全量 try/catch，不会产生未处理 rejection
    pollOnce();
    pollTimer = setInterval(() => {
      pollOnce();
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
