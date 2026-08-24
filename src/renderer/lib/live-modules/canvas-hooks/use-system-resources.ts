import type { PierResourceSnapshot } from "@shared/contracts/pier-resource.ts";
import { useEffect } from "react";
import type { PierResourceHistoryPoint } from "@/stores/pier-resource.store.ts";
import {
  acquirePierResourcePolling,
  usePierResourceStore,
} from "@/stores/pier-resource.store.ts";

/** `pier/canvas` Pier 资源 hook 的结构化返回。 */
export interface CanvasSystemResources {
  cpuHistory: readonly PierResourceHistoryPoint[];
  error: string | null;
  snapshot: PierResourceSnapshot | null;
  status: "error" | "loading" | "ready";
}

function statusOf(state: {
  error: string | null;
  snapshot: PierResourceSnapshot | null;
}): CanvasSystemResources["status"] {
  if (state.error) return "error";
  return state.snapshot ? "ready" : "loading";
}

/**
 * 相关合计 CPU 快照 + 趋势。挂载即 acquire 引用计数轮询，
 * 卸载 release；无人订阅时轮询自动停表（零开销门控在 store 内）。
 */
export function useSystemResources(): CanvasSystemResources {
  const snapshot = usePierResourceStore((s) => s.snapshot);
  const cpuHistory = usePierResourceStore((s) => s.cpuHistory);
  const error = usePierResourceStore((s) => s.error);
  useEffect(() => acquirePierResourcePolling(), []);
  const status = statusOf({ error, snapshot });
  return { cpuHistory, error, snapshot, status };
}
