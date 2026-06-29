import type { AgentKind } from "@shared/contracts/agent.ts";
import { create } from "zustand";

interface AgentDetectState {
  detect: () => Promise<void>;
  detectedIds: AgentKind[];
  /**
   * Detect once if not yet probed. Safe to call from anywhere (e.g. the New
   * Agent action) without relying on the settings page having mounted. No-op
   * when detection already succeeded; coalesces concurrent callers onto a
   * single in-flight probe so the palette never re-runs `which` per invocation.
   */
  ensureDetected: () => Promise<void>;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
}

let ensureDetectedInFlight: Promise<void> | null = null;

export const useAgentDetectStore = create<AgentDetectState>((set, get) => ({
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

  ensureDetected() {
    if (get().detectedIds.length > 0) {
      return Promise.resolve();
    }
    if (ensureDetectedInFlight) {
      return ensureDetectedInFlight;
    }
    ensureDetectedInFlight = get()
      .detect()
      .finally(() => {
        ensureDetectedInFlight = null;
      });
    return ensureDetectedInFlight;
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
