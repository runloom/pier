import type { AgentKind } from "@shared/contracts/agent.ts";
import { create } from "zustand";

interface AgentDetectState {
  detect: () => Promise<void>;
  detectedIds: AgentKind[];
  isRefreshing: boolean;
  refresh: () => Promise<void>;
}

export const useAgentDetectStore = create<AgentDetectState>((set) => ({
  detectedIds: [],
  isRefreshing: false,

  async detect() {
    try {
      const result = await window.pier?.agents?.detect?.();
      if (result) {
        set({ detectedIds: result.detectedIds });
      }
    } catch (err) {
      console.error("[agent-detect.store] detect failed:", err);
    }
  },

  async refresh() {
    set({ isRefreshing: true });
    try {
      const result = await window.pier?.agents?.refresh?.();
      if (result) {
        set({ detectedIds: result.detectedIds });
      }
    } catch (err) {
      console.error("[agent-detect.store] refresh failed:", err);
    } finally {
      set({ isRefreshing: false });
    }
  },
}));
