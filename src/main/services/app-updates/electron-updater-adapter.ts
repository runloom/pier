import { createLogger } from "@shared/logger.ts";
import electronUpdater from "electron-updater";
import type { AppUpdaterAdapter } from "./service.ts";

const log = createLogger("app-updater");

export function createElectronAppUpdaterAdapter(): AppUpdaterAdapter {
  // electron-updater 的 autoUpdater 是 getter，取值即构造 MacUpdater 并读取
  // electron app 信息——必须推迟到工厂调用时（仅 production 走到这里），
  // 否则任何 import 链在测试环境都会因 app 未就绪而崩。
  const { autoUpdater } = electronUpdater;
  // Service owns post-check download (single-flight + progress mapping).
  // Keep autoDownload false so checkForUpdates does not start a second download.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // 打包版没有 devtools console：updater 日志转发进结构化 logger，
  // 更新失败才能落盘排查。
  autoUpdater.logger = {
    debug: (message: string) => log.debug(message),
    error: (message: unknown) => log.error(String(message)),
    info: (message: unknown) => log.info(String(message)),
    warn: (message: unknown) => log.warn(String(message)),
  };
  return {
    checkForUpdates: () => autoUpdater.checkForUpdates(),
    downloadUpdate: () => autoUpdater.downloadUpdate(),
    on: (event, cb) => {
      autoUpdater.on(event, cb);
    },
    quitAndInstall: () => autoUpdater.quitAndInstall(),
  };
}
