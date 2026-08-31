/**
 * 后台调度接线：git autofetch、更新检查、远程访问开关恢复，以及对应的
 * 聚焦 / 退出生命周期钩子。从 main/index.ts 拆出以守住 file-size 硬上限，
 * 行为不变（app.whenReady 之后调用一次）。
 */
import { createLogger } from "@shared/logger.ts";
import { app } from "electron";
import { restoreRemoteAccessOnBoot } from "./adapters/remote-control/restore.ts";
import { appCore } from "./app-core/index.ts";
import { isDevRuntime } from "./runtime-mode.ts";
import { createAppUpdateScheduler } from "./services/app-updates/scheduler.ts";
import { createGitAutofetchService } from "./services/git/autofetch-service.ts";
import { windowManager } from "./windows/manager.ts";

const log = createLogger("startup");

export async function startBackgroundSchedulers(): Promise<void> {
  const initialPrefs = await appCore.services.preferences.read();
  let autofetchConfig = {
    enabled: initialPrefs.gitAutoFetchEnabled,
    intervalMinutes: initialPrefs.gitAutoFetchIntervalMinutes,
  };
  appCore.eventBus.subscribe((event) => {
    if (event.type === "preferences.changed") {
      autofetchConfig = {
        enabled: event.snapshot.gitAutoFetchEnabled,
        intervalMinutes: event.snapshot.gitAutoFetchIntervalMinutes,
      };
    }
  });
  const gitAutofetch = createGitAutofetchService({
    activeRoots: () => appCore.services.gitWatch.activeRoots(),
    getConfig: () => autofetchConfig,
    isFocused: () => windowManager.getFocused() !== null,
    pulse: (gitRoot) => {
      appCore.services.gitWatch.pulse(gitRoot);
    },
  });
  gitAutofetch.start();
  const appUpdateScheduler = createAppUpdateScheduler({
    check: () => appCore.services.appUpdates.check("background"),
    enabled: !isDevRuntime(),
  });
  appUpdateScheduler.start();
  // 远程访问开关持久化恢复：用户开过 → 重启自动恢复监听与会合拨号。
  if (appCore.services.pairing) {
    restoreRemoteAccessOnBoot({
      log: (message, fields) => {
        log.error(message, fields);
      },
      pairing: appCore.services.pairing,
      ...(appCore.services.remoteControl
        ? { remoteControl: appCore.services.remoteControl }
        : {}),
    }).catch(() => undefined);
  }
  app.on("browser-window-focus", () => {
    gitAutofetch.onFocusGained();
    appUpdateScheduler.onFocusGained();
    // 聚焦时重算活跃仓库签名，补回后台门控跳过的 poll。
    for (const root of appCore.services.gitWatch.activeRoots()) {
      appCore.services.gitWatch.pulse(root);
    }
  });
  app.on("will-quit", () => {
    appUpdateScheduler.stop();
    gitAutofetch.dispose();
    appCore.services.liveModules?.dispose();
  });
}
