import {
  type AgentDefaultArgs,
  type AgentDefaultEnv,
  type AgentKind,
  UNSUPPORTED_ARGS,
} from "@shared/contracts/agent.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import { create } from "zustand";

const WHITESPACE_RE = /\s+/;

// NOTE: UNSUPPORTED_ARGS entries must be single tokens (no embedded whitespace).
// A value-bearing flag like "--approval-mode yolo" won't be stripped by this token
// filter; if one is ever needed, extend this to also drop the following value token.
export function sanitizeAgentDefaultArgs(
  args: AgentDefaultArgs
): AgentDefaultArgs {
  const out: AgentDefaultArgs = {};
  for (const [id, value] of Object.entries(args) as [AgentKind, string][]) {
    if (value === undefined) {
      continue;
    }
    let next = value;
    for (const flag of UNSUPPORTED_ARGS[id] ?? []) {
      next = next
        .split(WHITESPACE_RE)
        .filter((t) => t !== flag)
        .join(" ");
    }
    if (next.trim() !== "") {
      out[id] = next.trim();
    }
  }
  return out;
}

type DefaultAgentId = AgentKind | "blank" | null;

interface AgentPreferenceSnapshot {
  agentCommandOverrides: Partial<Record<AgentKind, string>>;
  agentDefaultArgs: AgentDefaultArgs;
  agentDefaultEnv: AgentDefaultEnv;
  defaultAgentId: DefaultAgentId;
  disabledAgentIds: AgentKind[];
}

interface AgentPreferencesState extends AgentPreferenceSnapshot {
  _hydrate: (snapshot: AgentPreferenceSnapshot) => void;
  setAgentCommandOverrides: (
    next: Partial<Record<AgentKind, string>>
  ) => Promise<void>;
  setAgentDefaultArgs: (next: AgentDefaultArgs) => Promise<void>;
  setAgentDefaultEnv: (next: AgentDefaultEnv) => Promise<void>;
  setDefaultAgentId: (next: DefaultAgentId) => Promise<void>;
  setDisabledAgentIds: (next: AgentKind[]) => Promise<void>;
}

export const useAgentPreferencesStore = create<AgentPreferencesState>(
  (set) => ({
    agentCommandOverrides: {},
    agentDefaultArgs: {},
    agentDefaultEnv: {},
    defaultAgentId: null,
    disabledAgentIds: [],

    _hydrate(snapshot) {
      set(snapshot);
    },

    async setDefaultAgentId(next) {
      try {
        const merged = await window.pier.preferences.update({
          defaultAgentId: next,
        });
        useAgentPreferencesStore.getState()._hydrate(snapshotFrom(merged));
      } catch (err) {
        console.error(
          "[agent-preferences.store] setDefaultAgentId failed:",
          err
        );
      }
    },

    async setDisabledAgentIds(next) {
      try {
        const merged = await window.pier.preferences.update({
          disabledAgentIds: next,
        });
        useAgentPreferencesStore.getState()._hydrate(snapshotFrom(merged));
      } catch (err) {
        console.error(
          "[agent-preferences.store] setDisabledAgentIds failed:",
          err
        );
      }
    },

    async setAgentDefaultArgs(next) {
      const clean = sanitizeAgentDefaultArgs(next);
      try {
        const merged = await window.pier.preferences.update({
          agentDefaultArgs: clean,
        });
        useAgentPreferencesStore.getState()._hydrate(snapshotFrom(merged));
      } catch (err) {
        console.error(
          "[agent-preferences.store] setAgentDefaultArgs failed:",
          err
        );
      }
    },

    async setAgentDefaultEnv(next) {
      try {
        const merged = await window.pier.preferences.update({
          agentDefaultEnv: next,
        });
        useAgentPreferencesStore.getState()._hydrate(snapshotFrom(merged));
      } catch (err) {
        console.error(
          "[agent-preferences.store] setAgentDefaultEnv failed:",
          err
        );
      }
    },

    async setAgentCommandOverrides(next) {
      try {
        const merged = await window.pier.preferences.update({
          agentCommandOverrides: next,
        });
        useAgentPreferencesStore.getState()._hydrate(snapshotFrom(merged));
      } catch (err) {
        console.error(
          "[agent-preferences.store] setAgentCommandOverrides failed:",
          err
        );
      }
    },
  })
);

function snapshotFrom(prefs: ProjectPreferences): AgentPreferenceSnapshot {
  return {
    agentCommandOverrides: prefs.agentCommandOverrides,
    agentDefaultArgs: prefs.agentDefaultArgs,
    agentDefaultEnv: prefs.agentDefaultEnv,
    defaultAgentId: prefs.defaultAgentId,
    disabledAgentIds: prefs.disabledAgentIds,
  };
}

let agentPreferencesListenerAttached = false;
let agentPreferencesDetachFn: (() => void) | null = null;

function attachAgentPreferencesListener(): void {
  if (agentPreferencesListenerAttached || typeof window === "undefined") {
    return;
  }
  const detach = window.pier?.preferences?.onChanged?.((next) => {
    useAgentPreferencesStore.getState()._hydrate(snapshotFrom(next));
  });
  if (!detach) {
    return;
  }
  agentPreferencesDetachFn = detach;
  agentPreferencesListenerAttached = true;
}

export function detachAgentPreferencesListener(): void {
  agentPreferencesDetachFn?.();
  agentPreferencesDetachFn = null;
  agentPreferencesListenerAttached = false;
}

export async function initAgentPreferences(): Promise<void> {
  attachAgentPreferencesListener();
  try {
    const snapshot = await window.pier.preferences.read();
    useAgentPreferencesStore.getState()._hydrate(snapshotFrom(snapshot));
  } catch (err) {
    console.error(
      "[agent-preferences.store] init IPC failed; keeping defaults:",
      err
    );
  }
}
