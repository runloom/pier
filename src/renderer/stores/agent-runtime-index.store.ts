import type { AgentRuntimeIndexSnapshot } from "@shared/contracts/agent-runtime-index.ts";
import i18next from "i18next";
import { create } from "zustand";
import { showAppAlert } from "@/stores/app-dialog.store.ts";

interface AgentRuntimeIndexState {
  applySnapshot: (snapshot: AgentRuntimeIndexSnapshot) => void;
  entries: AgentRuntimeIndexSnapshot["entries"];
  reset: () => void;
  /** 与 FA / Index 广播单调序号对齐；0 = 尚未收到快照。 */
  ts: number;
}

/**
 * Agent Runtime Index 本机镜像 — 只经 Index IPC（list 兜底 + changed 推送）。
 * 禁止从本窗 FA store 写入他窗活动；禁止局部改 status。
 */
export const useAgentRuntimeIndexStore = create<AgentRuntimeIndexState>(
  (set, get) => ({
    entries: [],
    ts: 0,
    applySnapshot: (snapshot) => {
      if (snapshot.ts <= get().ts) {
        return;
      }
      set({ entries: snapshot.entries, ts: snapshot.ts });
    },
    reset: () => {
      set({ entries: [], ts: 0 });
    },
  })
);

/**
 * 先订阅 Index changed，再 list 一次兜底（订阅在先，避免竞态丢推送）。
 * 禁止挂 FA onChanged → list。
 */
export function initAgentRuntimeIndexBridge(): { dispose: () => void } {
  const api = window.pier.agentRuntimeIndex;
  const apply = (snapshot: AgentRuntimeIndexSnapshot): void => {
    useAgentRuntimeIndexStore.getState().applySnapshot(snapshot);
  };
  const unsubscribe = api.onChanged(apply);
  api
    .list()
    .then(apply)
    .catch((err: unknown) => {
      showAppAlert({
        body: err instanceof Error ? err.message : String(err),
        title: i18next.t("agents.indexListFailed"),
      }).catch(() => undefined);
    });
  return {
    dispose: () => {
      unsubscribe();
      useAgentRuntimeIndexStore.getState().reset();
    },
  };
}
