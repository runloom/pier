import {
  type AgentAttentionSettings,
  DEFAULT_AGENT_ATTENTION_SETTINGS,
} from "@shared/contracts/agent-attention.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import { create } from "zustand";

interface AgentAttentionPreferencesState {
  _hydrate: (next: AgentAttentionSettings) => void;
  agentAttention: AgentAttentionSettings;
  /**
   * 接受完整对象或基于最新 state 的 patch 函数，避免连点用过期 current 覆盖。
   */
  setAgentAttention: (
    next:
      | AgentAttentionSettings
      | ((current: AgentAttentionSettings) => AgentAttentionSettings)
  ) => Promise<void>;
}

function snapshotFrom(prefs: ProjectPreferences): AgentAttentionSettings {
  return { ...prefs.agentAttention };
}

/** 串行化写，避免并发 update 乱序。 */
let writeChain: Promise<void> = Promise.resolve();

export const useAgentAttentionPreferencesStore =
  create<AgentAttentionPreferencesState>((set, get) => ({
    agentAttention: { ...DEFAULT_AGENT_ATTENTION_SETTINGS },

    _hydrate(next) {
      set({ agentAttention: { ...next } });
    },

    async setAgentAttention(nextOrUpdater) {
      const run = async (): Promise<void> => {
        const prev = get().agentAttention;
        const next =
          typeof nextOrUpdater === "function"
            ? nextOrUpdater(prev)
            : nextOrUpdater;
        set({ agentAttention: { ...next } });
        try {
          const merged = await window.pier.preferences.update({
            agentAttention: next,
          });
          set({ agentAttention: snapshotFrom(merged) });
        } catch (err) {
          set({ agentAttention: prev });
          throw err;
        }
      };

      const queued = writeChain.then(run, run);
      writeChain = queued.then(
        () => undefined,
        () => undefined
      );
      await queued;
    },
  }));

let listenerAttached = false;
let detachFn: (() => void) | null = null;

function attachListener(): void {
  if (listenerAttached || typeof window === "undefined") {
    return;
  }
  const detach = window.pier?.preferences?.onChanged?.((next) => {
    useAgentAttentionPreferencesStore.getState()._hydrate(snapshotFrom(next));
  });
  if (!detach) {
    return;
  }
  detachFn = detach;
  listenerAttached = true;
}

export function detachAgentAttentionPreferencesListener(): void {
  detachFn?.();
  detachFn = null;
  listenerAttached = false;
}

export async function initAgentAttentionPreferences(): Promise<void> {
  attachListener();
  try {
    const snapshot = await window.pier.preferences.read();
    useAgentAttentionPreferencesStore
      .getState()
      ._hydrate(snapshotFrom(snapshot));
  } catch (err) {
    console.error(
      "[agent-attention-preferences.store] init failed; keeping defaults:",
      err
    );
  }
}
