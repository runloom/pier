import { create } from "zustand";

interface AppUpdatePreferenceSnapshot {
  receiveCandidateUpdates: boolean;
}

interface AppUpdatePreferencesState extends AppUpdatePreferenceSnapshot {
  _hydrate: (snapshot: AppUpdatePreferenceSnapshot) => void;
  /** 失败向上抛：设置页开关需要向用户报错并回弹。 */
  setReceiveCandidateUpdates: (next: boolean) => Promise<void>;
}

export const useAppUpdatePreferencesStore = create<AppUpdatePreferencesState>(
  (set) => ({
    receiveCandidateUpdates: false,

    _hydrate(snapshot) {
      set({
        receiveCandidateUpdates: snapshot.receiveCandidateUpdates,
      });
    },

    async setReceiveCandidateUpdates(next) {
      const merged = await window.pier.preferences.update({
        receiveCandidateUpdates: next,
      });
      useAppUpdatePreferencesStore.getState()._hydrate({
        receiveCandidateUpdates: merged.receiveCandidateUpdates,
      });
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
    useAppUpdatePreferencesStore.getState()._hydrate({
      receiveCandidateUpdates: next.receiveCandidateUpdates,
    });
  });
  if (!detach) {
    return;
  }
  detachPreferencesListener = detach;
  preferencesListenerAttached = true;
}

export function detachAppUpdatePreferencesListener(): void {
  detachPreferencesListener?.();
  detachPreferencesListener = null;
  preferencesListenerAttached = false;
}

export async function initAppUpdatePreferences(): Promise<void> {
  attachPreferencesListener();
  try {
    const snapshot = await window.pier.preferences.read();
    useAppUpdatePreferencesStore.getState()._hydrate({
      receiveCandidateUpdates: snapshot.receiveCandidateUpdates,
    });
  } catch (err) {
    console.error(
      "[app-update-preferences.store] init IPC failed; keeping defaults:",
      err
    );
  }
}
