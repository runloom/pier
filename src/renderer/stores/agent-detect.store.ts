import type { AgentKind } from "@shared/contracts/agent.ts";
import { detectedIdsFromAgentSnapshot } from "@shared/contracts/host-catalog/agent-items.ts";
import type { CatalogDomainSnapshot } from "@shared/contracts/host-catalog/runtime.ts";
import { create } from "zustand";
import { useHostCatalogStore } from "./host-catalog/store.ts";

interface AgentDetectState {
  detect: () => Promise<void>;
  detectedIds: AgentKind[];
  /**
   * Use last catalog snapshot if present. Otherwise ask main for a local
   * (class A) refresh. Never writes detectedIds itself.
   */
  ensureDetected: () => Promise<void>;
  hasDetected: boolean;
  isDetecting: boolean;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
}

let detectInFlight: Promise<void> | null = null;

function applyDetectSnapshot(snapshot: CatalogDomainSnapshot): void {
  if (snapshot.domain !== "agent-cli") {
    return;
  }
  const shouldApply =
    snapshot.revision > 0 ||
    snapshot.localProbedAt !== null ||
    snapshot.remoteCheckedAt !== null ||
    snapshot.items.length > 0;
  if (!shouldApply) {
    return;
  }
  useAgentDetectStore.setState({
    detectedIds: detectedIdsFromAgentSnapshot(snapshot),
    hasDetected: true,
  });
}

async function refreshFromCatalog(force: boolean): Promise<void> {
  await useHostCatalogStore.getState().ensureFresh({
    class: force ? "all" : "local",
    domain: "agent-cli",
    ...(force ? { force: true } : {}),
  });
}

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
        await refreshFromCatalog(false);
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
      await refreshFromCatalog(true);
    } catch (err) {
      console.error("[agent-detect.store] refresh failed:", err);
      throw err;
    } finally {
      set({ isDetecting: false, isRefreshing: false });
    }
  },
}));

const initialAgentCli = useHostCatalogStore.getState().domains["agent-cli"];
if (initialAgentCli) {
  applyDetectSnapshot(initialAgentCli);
}
useHostCatalogStore.subscribe((state, previous) => {
  const next = state.domains["agent-cli"];
  if (next && next !== previous.domains["agent-cli"]) {
    applyDetectSnapshot(next);
  }
});
