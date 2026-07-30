import {
  DEFAULT_PANEL_CLOSE_FOCUS_POLICY,
  type PanelCloseFocusPolicy,
} from "@shared/contracts/preferences.ts";
import { create } from "zustand";

interface WorkspacePreferenceSnapshot {
  panelCloseFocusPolicy: PanelCloseFocusPolicy;
}

interface WorkspacePreferencesState extends WorkspacePreferenceSnapshot {
  _hydrate: (snapshot: WorkspacePreferenceSnapshot) => void;
  setPanelCloseFocusPolicy: (next: PanelCloseFocusPolicy) => Promise<void>;
}

function asPanelCloseFocusPolicy(value: unknown): PanelCloseFocusPolicy {
  if (value === "adjacent" || value === "recent") {
    return value;
  }
  return DEFAULT_PANEL_CLOSE_FOCUS_POLICY;
}

export const useWorkspacePreferencesStore = create<WorkspacePreferencesState>(
  (set) => ({
    panelCloseFocusPolicy: DEFAULT_PANEL_CLOSE_FOCUS_POLICY,

    _hydrate(snapshot) {
      set({
        panelCloseFocusPolicy: asPanelCloseFocusPolicy(
          snapshot.panelCloseFocusPolicy
        ),
      });
    },

    async setPanelCloseFocusPolicy(next) {
      try {
        const merged = await window.pier.preferences.update({
          panelCloseFocusPolicy: next,
        });
        useWorkspacePreferencesStore.getState()._hydrate({
          panelCloseFocusPolicy: merged.panelCloseFocusPolicy,
        });
      } catch (err) {
        console.error(
          "[workspace-preferences.store] setPanelCloseFocusPolicy failed:",
          err
        );
      }
    },
  })
);

let preferencesListenerAttached = false;
let detachPreferencesListener: (() => void) | null = null;

function attachPreferencesListener(): void {
  if (preferencesListenerAttached || typeof window === "undefined") {
    return;
  }
  const detach = window.pier?.preferences?.onChanged?.((next) => {
    useWorkspacePreferencesStore.getState()._hydrate({
      panelCloseFocusPolicy: next.panelCloseFocusPolicy,
    });
  });
  if (!detach) {
    return;
  }
  detachPreferencesListener = detach;
  preferencesListenerAttached = true;
}

export function detachWorkspacePreferencesListener(): void {
  detachPreferencesListener?.();
  detachPreferencesListener = null;
  preferencesListenerAttached = false;
}

export async function initWorkspacePreferences(): Promise<void> {
  attachPreferencesListener();
  try {
    const snapshot = await window.pier.preferences.read();
    useWorkspacePreferencesStore.getState()._hydrate({
      panelCloseFocusPolicy: snapshot.panelCloseFocusPolicy,
    });
  } catch (err) {
    console.error(
      "[workspace-preferences.store] init IPC failed; keeping defaults:",
      err
    );
  }
}
