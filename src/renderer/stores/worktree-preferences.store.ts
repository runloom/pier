import { create } from "zustand";

interface WorktreePreferenceSnapshot {
  worktreeRootPath: string;
}

interface WorktreePreferencesState extends WorktreePreferenceSnapshot {
  _hydrate: (snapshot: WorktreePreferenceSnapshot) => void;
  setWorktreeRootPath: (next: string) => Promise<void>;
}

export const useWorktreePreferencesStore = create<WorktreePreferencesState>(
  (set) => ({
    worktreeRootPath: "",

    _hydrate(snapshot) {
      set({
        worktreeRootPath: snapshot.worktreeRootPath,
      });
    },

    async setWorktreeRootPath(next) {
      const worktreeRootPath = next.trim();
      try {
        const merged = await window.pier.preferences.update({
          worktreeRootPath,
        });
        useWorktreePreferencesStore.getState()._hydrate({
          worktreeRootPath: merged.worktreeRootPath,
        });
      } catch (err) {
        console.error(
          "[worktree-preferences.store] setWorktreeRootPath failed:",
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
    useWorktreePreferencesStore.getState()._hydrate({
      worktreeRootPath: next.worktreeRootPath,
    });
  });
  if (!detach) {
    return;
  }
  detachPreferencesListener = detach;
  preferencesListenerAttached = true;
}

export function detachWorktreePreferencesListener(): void {
  detachPreferencesListener?.();
  detachPreferencesListener = null;
  preferencesListenerAttached = false;
}

export async function initWorktreePreferences(): Promise<void> {
  attachPreferencesListener();
  try {
    const snapshot = await window.pier.preferences.read();
    useWorktreePreferencesStore.getState()._hydrate({
      worktreeRootPath: snapshot.worktreeRootPath,
    });
  } catch (err) {
    console.error(
      "[worktree-preferences.store] init IPC failed; keeping defaults:",
      err
    );
  }
}
