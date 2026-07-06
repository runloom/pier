import type { AgentAccountsSnapshot } from "@shared/contracts/agent-accounts.ts";
import { create } from "zustand";

interface AgentAccountsState {
  apply: (s: AgentAccountsSnapshot) => void;
  /** 当前账号域快照（初始化前为 null）。 */
  snapshot: AgentAccountsSnapshot | null;
  /** 广播单调序号守卫。 */
  ts: number;
}

/**
 * Agent accounts 镜像 store — main 服务快照的 renderer 副本。
 * 写入方: initAgentAccounts (初始 snapshot pull + 广播 push)。
 * 读取方: Phase 3 codex 插件 facade / widget。
 * ts 单调守卫拒收乱序广播（对齐 foreground-activity.store 模式）。
 */
export const useAgentAccountsStore = create<AgentAccountsState>((set, get) => ({
  snapshot: null,
  ts: 0,
  apply: (s) => {
    if (s.ts < get().ts) {
      return;
    }
    set({ snapshot: s, ts: s.ts });
  },
}));

/**
 * bootstrap 时每窗口调用一次: 先订阅广播(避免拉取窗口期丢事件),再全量拉取。
 * 对齐 initPluginRegistry 防漏窗口模式。
 * 订阅与窗口同生命周期，不返回解绑句柄（对齐 initAgentDetection 等
 * 同类 init 的 Promise<void> 约定，避免调用方误以为需要管理清理）。
 */
export async function initAgentAccounts(): Promise<void> {
  window.pier.accounts.onChanged((snapshot) => {
    useAgentAccountsStore.getState().apply(snapshot);
  });
  try {
    const snapshot = await window.pier.accounts.snapshot();
    useAgentAccountsStore.getState().apply(snapshot);
  } catch (err) {
    console.error("[agent-accounts] init snapshot pull failed:", err);
  }
}
