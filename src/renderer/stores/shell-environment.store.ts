import type { ShellEnvironmentPrefs } from "@shared/contracts/preferences.ts";
import type { ShellEnvironmentHostStatus } from "@shared/contracts/shell-environment.ts";
import i18next from "i18next";
import { create } from "zustand";
import { showAppAlert } from "@/stores/app-dialog.store.ts";

interface ShellEnvironmentState {
  _hydratePrefs: (prefs: ShellEnvironmentPrefs) => void;
  disabled: boolean;
  hostStatus: ShellEnvironmentHostStatus | null;
  loadHostStatus: (options?: { quiet?: boolean }) => Promise<void>;
  loading: boolean;
  refreshHostStatus: () => Promise<void>;
  setDisabled: (next: boolean) => Promise<void>;
  setTimeoutMs: (next: number) => Promise<void>;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function clampTimeoutMs(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(120_000, Math.max(1000, Math.trunc(value)));
}

async function reportShellEnvFailure(
  titleKey: string,
  err: unknown
): Promise<void> {
  await showAppAlert({
    body: err instanceof Error ? err.message : String(err),
    title: i18next.t(titleKey),
  });
}

export const useShellEnvironmentStore = create<ShellEnvironmentState>(
  (set, get) => ({
    disabled: false,
    hostStatus: null,
    loading: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,

    _hydratePrefs(prefs) {
      set({
        disabled: prefs.disabled,
        timeoutMs: clampTimeoutMs(prefs.timeoutMs),
      });
    },

    async loadHostStatus(options) {
      try {
        const hostStatus = await window.pier.shellEnvironment.status();
        set({ hostStatus });
      } catch (err) {
        console.error("[shell-environment.store] status failed:", err);
        // Boot init uses quiet — avoid modal before settings UI is open.
        if (!options?.quiet) {
          await reportShellEnvFailure(
            "settings.shellEnvironment.statusFailed",
            err
          );
        }
      }
    },

    async refreshHostStatus() {
      set({ loading: true });
      try {
        const hostStatus = await window.pier.shellEnvironment.refresh();
        set({ hostStatus });
      } catch (err) {
        console.error("[shell-environment.store] refresh failed:", err);
        await reportShellEnvFailure(
          "settings.shellEnvironment.refreshFailed",
          err
        );
      } finally {
        set({ loading: false });
      }
    },

    async setDisabled(next) {
      try {
        const merged = await window.pier.preferences.update({
          shellEnvironment: {
            disabled: next,
            timeoutMs: get().timeoutMs,
          },
        });
        get()._hydratePrefs(merged.shellEnvironment);
        // Design K24: disabled flip must re-resolve (or skip) via invalidate.
        await get().refreshHostStatus();
      } catch (err) {
        console.error("[shell-environment.store] setDisabled failed:", err);
        await reportShellEnvFailure(
          "settings.shellEnvironment.updateFailed",
          err
        );
      }
    },

    async setTimeoutMs(next) {
      const timeoutMs = clampTimeoutMs(next);
      try {
        const merged = await window.pier.preferences.update({
          shellEnvironment: {
            disabled: get().disabled,
            timeoutMs,
          },
        });
        get()._hydratePrefs(merged.shellEnvironment);
        // New timeout should apply on the next dump immediately.
        await get().refreshHostStatus();
      } catch (err) {
        console.error("[shell-environment.store] setTimeoutMs failed:", err);
        await reportShellEnvFailure(
          "settings.shellEnvironment.updateFailed",
          err
        );
      }
    },
  })
);

let prefsListenerAttached = false;

export async function initShellEnvironmentStore(): Promise<void> {
  if (!prefsListenerAttached && typeof window !== "undefined") {
    window.pier?.preferences?.onChanged?.((next) => {
      useShellEnvironmentStore.getState()._hydratePrefs(next.shellEnvironment);
    });
    prefsListenerAttached = true;
  }
  try {
    const snapshot = await window.pier.preferences.read();
    useShellEnvironmentStore
      .getState()
      ._hydratePrefs(snapshot.shellEnvironment);
  } catch (err) {
    console.error("[shell-environment.store] init prefs failed:", err);
    // Boot path: no user-triggered alert (mirror other store init failures).
  }
  await useShellEnvironmentStore.getState().loadHostStatus({ quiet: true });
}
