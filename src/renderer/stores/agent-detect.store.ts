import type { AgentKind } from "@shared/contracts/agent.ts";
import { create } from "zustand";

interface AgentDetectState {
  detect: () => Promise<void>;
  detectedIds: AgentKind[];
  /**
   * Detect once if not yet probed. Safe to call from anywhere without relying
   * on a specific settings panel lifecycle. No-op when detection already
   * succeeded, including the valid "no agents installed" empty result.
   */
  ensureDetected: () => Promise<void>;
  hasDetected: boolean;
  isDetecting: boolean;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
}

let detectInFlight: Promise<void> | null = null;

export const useAgentDetectStore = create<AgentDetectState>((set, get) => ({
  detectedIds: [],
  hasDetected: false,
  isDetecting: false,
  isRefreshing: false,

  detect() {
    if (detectInFlight) {
      return detectInFlight;
    }

    detectInFlight = (async () => {
      set({ isDetecting: true });
      try {
        const result = await window.pier?.agents?.detect?.();
        if (result) {
          set({ detectedIds: result.detectedIds, hasDetected: true });
        }
      } catch (err) {
        console.error("[agent-detect.store] detect failed:", err);
        throw err;
      } finally {
        set({ isDetecting: false });
      }
    })().finally(() => {
      detectInFlight = null;
    });

    return detectInFlight;
  },

  ensureDetected() {
    if (get().hasDetected || get().detectedIds.length > 0) {
      return Promise.resolve();
    }
    return get().detect();
  },

  async refresh() {
    set({ isDetecting: true, isRefreshing: true });
    try {
      const result = await window.pier?.agents?.refresh?.();
      if (result) {
        set({ detectedIds: result.detectedIds, hasDetected: true });
      }
    } catch (err) {
      console.error("[agent-detect.store] refresh failed:", err);
    } finally {
      set({ isDetecting: false, isRefreshing: false });
    }
  },
}));

export function initAgentDetection(): Promise<void> {
  return useAgentDetectStore.getState().ensureDetected();
}
