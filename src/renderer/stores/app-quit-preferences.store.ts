import type { AppQuitConfirmationMode } from "@shared/contracts/preferences.ts";
import { create } from "zustand";

interface AppQuitPreferenceSnapshot {
  confirmOnQuit: AppQuitConfirmationMode;
}

interface AppQuitPreferencesState extends AppQuitPreferenceSnapshot {
  _hydrate: (snapshot: AppQuitPreferenceSnapshot) => void;
  setConfirmOnQuit: (next: AppQuitConfirmationMode) => Promise<void>;
}

export const useAppQuitPreferencesStore = create<AppQuitPreferencesState>(
  (set) => ({
    confirmOnQuit: "hasActivity",

    _hydrate(snapshot) {
      set({
        confirmOnQuit: snapshot.confirmOnQuit,
      });
    },

    async setConfirmOnQuit(next) {
      try {
        const merged = await window.pier.preferences.update({
          confirmOnQuit: next,
        });
        useAppQuitPreferencesStore.getState()._hydrate({
          confirmOnQuit: merged.confirmOnQuit as AppQuitConfirmationMode,
        });
      } catch (err) {
        console.error(
          "[app-quit-preferences.store] setConfirmOnQuit failed:",
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
    useAppQuitPreferencesStore.getState()._hydrate({
      confirmOnQuit: next.confirmOnQuit as AppQuitConfirmationMode,
    });
  });
  if (!detach) {
    return;
  }
  detachPreferencesListener = detach;
  preferencesListenerAttached = true;
}

export function detachAppQuitPreferencesListener(): void {
  detachPreferencesListener?.();
  detachPreferencesListener = null;
  preferencesListenerAttached = false;
}

export async function initAppQuitPreferences(): Promise<void> {
  attachPreferencesListener();
  try {
    const snapshot = await window.pier.preferences.read();
    useAppQuitPreferencesStore.getState()._hydrate({
      confirmOnQuit: snapshot.confirmOnQuit as AppQuitConfirmationMode,
    });
  } catch (err) {
    console.error(
      "[app-quit-preferences.store] init IPC failed; keeping defaults:",
      err
    );
  }
}
