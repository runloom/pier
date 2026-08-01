import type { AppUpdateSnapshot } from "@shared/contracts/app-update.ts";
import { app } from "electron";
import { getNotificationCenterService } from "../ipc/notification-center.ts";
import { createElectronAppUpdaterAdapter } from "../services/app-updates/electron-updater-adapter.ts";
import { notifyAppUpdateReady } from "../services/app-updates/notify-ready.ts";
import {
  type AppUpdateRuntimeMode,
  type AppUpdateService,
  createAppUpdateService,
} from "../services/app-updates/service.ts";
import { resolveAppUpdateUiLocale } from "../services/app-updates/ui-locale.ts";
import { broadcastAppUpdateChanged } from "./window-broadcasts.ts";

export function createWiredAppUpdateService(
  runtimeMode: AppUpdateRuntimeMode
): AppUpdateService {
  return createAppUpdateService({
    currentVersion: app.getVersion(),
    onChange: (snapshot: AppUpdateSnapshot) => {
      broadcastAppUpdateChanged(snapshot);
    },
    onReady: (version) => {
      notifyAppUpdateReady(version, {
        getService: getNotificationCenterService,
        resolveLocale: resolveAppUpdateUiLocale,
      });
    },
    runtimeMode,
    ...(runtimeMode === "production"
      ? { updater: createElectronAppUpdaterAdapter() }
      : {}),
  });
}
