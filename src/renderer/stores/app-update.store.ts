import type { AppUpdateSnapshot } from "@shared/contracts/app-update.ts";
import i18next from "i18next";
import { create } from "zustand";
import { systemNotify } from "@/lib/notifications/system-notify.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useHostCatalogStore } from "@/stores/host-catalog/store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";

interface AppUpdateApi {
  check(): Promise<AppUpdateSnapshot>;
  download(): Promise<AppUpdateSnapshot>;
  onChanged(cb: (snapshot: AppUpdateSnapshot) => void): () => void;
  quitAndInstall(): Promise<AppUpdateSnapshot>;
  status(): Promise<AppUpdateSnapshot>;
}

function appUpdateApi(): AppUpdateApi | undefined {
  return window.pier?.appUpdate;
}

interface AppUpdateState {
  applySnapshot: (snapshot: AppUpdateSnapshot) => void;
  check: () => Promise<void>;
  download: () => Promise<void>;
  pending: boolean;
  quitAndInstall: () => Promise<void>;
  reset: () => void;
  snapshot: AppUpdateSnapshot | null;
}

export const useAppUpdateStore = create<AppUpdateState>((set, get) => ({
  pending: false,
  snapshot: null,
  applySnapshot: (snapshot) => {
    // Ready toast is process-level on main (downloaded edge → NCS).
    // Do not systemNotify here: multi-window mirrors would double-report.
    set({ snapshot });
  },
  reset: () => {
    set({ pending: false, snapshot: null });
  },
  check: async () => {
    const api = appUpdateApi();
    if (!api) {
      return;
    }
    set({ pending: true });
    try {
      const snapshot = await api.check();
      get().applySnapshot(snapshot);
      try {
        await useHostCatalogStore.getState().ensureFresh({
          class: "local",
          domain: "pier-app",
          force: true,
        });
      } catch (stampErr: unknown) {
        console.error("[app-update] catalog stamp failed:", stampErr);
      }
    } catch (err) {
      await showAppAlert({
        body: err instanceof Error ? err.message : String(err),
        title: i18next.t("settings.appUpdate.toast.checkFailed"),
      });
    } finally {
      set({ pending: false });
    }
  },
  download: async () => {
    const api = appUpdateApi();
    if (!api) {
      return;
    }
    set({ pending: true });
    try {
      const snapshot = await api.download();
      get().applySnapshot(snapshot);
    } catch (err) {
      await showAppAlert({
        body: err instanceof Error ? err.message : String(err),
        title: i18next.t("settings.appUpdate.toast.downloadFailed"),
      });
    } finally {
      set({ pending: false });
    }
  },
  quitAndInstall: async () => {
    const api = appUpdateApi();
    if (!api) {
      return;
    }
    set({ pending: true });
    try {
      const snapshot = await api.quitAndInstall();
      get().applySnapshot(snapshot);
    } catch (err) {
      await showAppAlert({
        body: err instanceof Error ? err.message : String(err),
        title: i18next.t("settings.appUpdate.toast.installFailed"),
      });
    } finally {
      set({ pending: false });
    }
  },
}));

/**
 * Subscribe to app-update broadcasts first, then pull status once.
 */
export function initAppUpdateBridge(): { dispose: () => void } {
  const api = appUpdateApi();
  if (!api) {
    return {
      dispose: () => {
        useAppUpdateStore.getState().reset();
      },
    };
  }
  const apply = (snapshot: AppUpdateSnapshot): void => {
    useAppUpdateStore.getState().applySnapshot(snapshot);
  };
  const unsubscribe = api.onChanged(apply);
  api
    .status()
    .then(apply)
    .catch((err: unknown) => {
      // 启动拉取失败不弹窗打断：只落消息中心（带技术详情）。
      systemNotify({
        body: err instanceof Error ? err.message : String(err),
        kind: "app.update",
        severity: "warning",
        suppressToast: true,
        titleKey: "settings.appUpdate.toast.statusFailed",
      });
    });
  return {
    dispose: () => {
      unsubscribe();
      useAppUpdateStore.getState().reset();
    },
  };
}

export function openAppUpdateSettings(): void {
  useSettingsDialogStore.getState().openSection("updates");
}

export function appUpdateNeedsAttention(
  snapshot: AppUpdateSnapshot | null
): boolean {
  const state = snapshot?.state;
  return (
    state === "available" ||
    state === "downloading" ||
    state === "downloaded" ||
    state === "error"
  );
}
