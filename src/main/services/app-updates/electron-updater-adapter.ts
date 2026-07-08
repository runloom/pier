import electronUpdater from "electron-updater";
import type { AppUpdaterAdapter } from "./app-update-service.ts";

const { autoUpdater } = electronUpdater;

export function createElectronAppUpdaterAdapter(): AppUpdaterAdapter {
  autoUpdater.autoDownload = false;
  return {
    checkForUpdates: () => autoUpdater.checkForUpdates(),
    downloadUpdate: () => autoUpdater.downloadUpdate(),
    on: (event, cb) => {
      autoUpdater.on(event, cb);
    },
    quitAndInstall: () => autoUpdater.quitAndInstall(),
  };
}
