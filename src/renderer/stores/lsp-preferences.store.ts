import {
  DEFAULT_LSP_POLICY_PREFS,
  type LspCustomServer,
  type LspPolicyPrefs,
} from "@shared/contracts/lsp.ts";
import { create } from "zustand";

interface LspPreferencesState {
  _hydrate: (prefs: LspPolicyPrefs) => void;
  customServers: LspCustomServer[];
  enabled: boolean;
  idleReleaseMs: number;
  maxLocalWorkspaces: number;
  maxRemoteWorkspaces: number;
  memoryBudgetMb: number;
  setCustomServers: (customServers: LspCustomServer[]) => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setIdleReleaseMs: (idleReleaseMs: number) => Promise<void>;
  setMaxLocalWorkspaces: (maxLocalWorkspaces: number) => Promise<void>;
  setMaxRemoteWorkspaces: (maxRemoteWorkspaces: number) => Promise<void>;
  setMemoryBudgetMb: (memoryBudgetMb: number) => Promise<void>;
  setWorktreesEnabled: (enabled: boolean) => Promise<void>;
  worktreesEnabled: boolean;
}

export const useLspPreferencesStore = create<LspPreferencesState>(
  (set, get) => ({
    ...DEFAULT_LSP_POLICY_PREFS,

    _hydrate(prefs) {
      set(prefs);
    },

    async setCustomServers(customServers) {
      const previous = get().customServers;
      set({ customServers });
      try {
        const merged = await window.pier.preferences.update({
          lsp: { ...lspPrefsFromState(get()), customServers },
        });
        get()._hydrate(merged.lsp);
      } catch (error) {
        if (get().customServers === customServers) {
          set({ customServers: previous });
        }
        throw error;
      }
    },

    async setEnabled(enabled) {
      const previous = get().enabled;
      set({ enabled });
      try {
        const merged = await window.pier.preferences.update({
          lsp: { ...lspPrefsFromState(get()), enabled },
        });
        get()._hydrate(merged.lsp);
      } catch (error) {
        if (get().enabled === enabled) {
          set({ enabled: previous });
        }
        throw error;
      }
    },

    async setIdleReleaseMs(idleReleaseMs) {
      const previous = get().idleReleaseMs;
      set({ idleReleaseMs });
      try {
        const merged = await window.pier.preferences.update({
          lsp: { ...lspPrefsFromState(get()), idleReleaseMs },
        });
        get()._hydrate(merged.lsp);
      } catch (error) {
        if (get().idleReleaseMs === idleReleaseMs) {
          set({ idleReleaseMs: previous });
        }
        throw error;
      }
    },

    async setMaxLocalWorkspaces(maxLocalWorkspaces) {
      const previous = get().maxLocalWorkspaces;
      set({ maxLocalWorkspaces });
      try {
        const merged = await window.pier.preferences.update({
          lsp: { ...lspPrefsFromState(get()), maxLocalWorkspaces },
        });
        get()._hydrate(merged.lsp);
      } catch (error) {
        if (get().maxLocalWorkspaces === maxLocalWorkspaces) {
          set({ maxLocalWorkspaces: previous });
        }
        throw error;
      }
    },

    async setMaxRemoteWorkspaces(maxRemoteWorkspaces) {
      const previous = get().maxRemoteWorkspaces;
      set({ maxRemoteWorkspaces });
      try {
        const merged = await window.pier.preferences.update({
          lsp: { ...lspPrefsFromState(get()), maxRemoteWorkspaces },
        });
        get()._hydrate(merged.lsp);
      } catch (error) {
        if (get().maxRemoteWorkspaces === maxRemoteWorkspaces) {
          set({ maxRemoteWorkspaces: previous });
        }
        throw error;
      }
    },

    async setMemoryBudgetMb(memoryBudgetMb) {
      const previous = get().memoryBudgetMb;
      set({ memoryBudgetMb });
      try {
        const merged = await window.pier.preferences.update({
          lsp: { ...lspPrefsFromState(get()), memoryBudgetMb },
        });
        get()._hydrate(merged.lsp);
      } catch (error) {
        if (get().memoryBudgetMb === memoryBudgetMb) {
          set({ memoryBudgetMb: previous });
        }
        throw error;
      }
    },

    async setWorktreesEnabled(worktreesEnabled) {
      const previous = get().worktreesEnabled;
      set({ worktreesEnabled });
      try {
        const merged = await window.pier.preferences.update({
          lsp: { ...lspPrefsFromState(get()), worktreesEnabled },
        });
        get()._hydrate(merged.lsp);
      } catch (error) {
        if (get().worktreesEnabled === worktreesEnabled) {
          set({ worktreesEnabled: previous });
        }
        throw error;
      }
    },
  })
);

function lspPrefsFromState(state: LspPreferencesState): LspPolicyPrefs {
  return {
    customServers: state.customServers ?? [],
    enabled: state.enabled,
    idleReleaseMs: state.idleReleaseMs,
    maxLocalWorkspaces: state.maxLocalWorkspaces,
    maxRemoteWorkspaces: state.maxRemoteWorkspaces,
    memoryBudgetMb: state.memoryBudgetMb,
    worktreesEnabled: state.worktreesEnabled,
  };
}

let preferencesListenerAttached = false;
let detachPreferencesListener: (() => void) | null = null;

function attachPreferencesListener(): void {
  if (preferencesListenerAttached || typeof window === "undefined") {
    return;
  }
  const detach = window.pier?.preferences?.onChanged?.((next) => {
    useLspPreferencesStore.getState()._hydrate(next.lsp);
  });
  if (!detach) {
    return;
  }
  detachPreferencesListener = detach;
  preferencesListenerAttached = true;
}

export function detachLspPreferencesListener(): void {
  detachPreferencesListener?.();
  detachPreferencesListener = null;
  preferencesListenerAttached = false;
}

export async function initLspPreferences(): Promise<void> {
  attachPreferencesListener();
  try {
    const snapshot = await window.pier.preferences.read();
    useLspPreferencesStore.getState()._hydrate(snapshot.lsp);
  } catch (err) {
    // Startup hydration is not a direct user action; defaults remain usable.
    console.error(
      "[lsp-preferences.store] init IPC failed; keeping defaults:",
      err
    );
  }
}
