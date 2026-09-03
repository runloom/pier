import { PIER } from "@shared/ipc-channels.ts";
import { createLogger } from "@shared/logger.ts";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { createLocalControlRegistrationOwner } from "./adapters/cli/local-control/registration.ts";
import { registerCliLocalControl } from "./adapters/cli/register-local-control.ts";
import { registerPeerUidFromNativeAddon } from "./adapters/cli/register-peer-uid-native.ts";
import { appCore } from "./app-core/index.ts";
import {
  consumeIntentionalQuitAction,
  disarmIntentionalRelaunch,
  isIntentionalRelaunchArmed,
} from "./app-core/relaunch.ts";
import { configureMainAppIdentity } from "./app-identity.ts";
import { installAppMenu } from "./app-menu.ts";
import { showAppQuitConfirmation } from "./app-quit/confirmation.ts";
import { createAppQuitController } from "./app-quit/controller.ts";
import { formatQuitFailure } from "./app-quit/failure-format.ts";
import { createAppQuitRendererTransport } from "./app-quit/renderer-transport.ts";
import { shouldBypassQuitConfirmationForTests } from "./app-quit/test-runtime.ts";
import { handleMainStartupFailure } from "./app-startup-failure.ts";
import { startBackgroundSchedulers } from "./background-schedulers.ts";
import {
  attachPrivilegedProtocolHandlers,
  registerPrivilegedProtocolSchemes,
} from "./bootstrap-privileged-protocols.ts";
import { installMainDiagnosticsLogging } from "./diagnostics/app.ts";
import { installProcessMemoryTrail } from "./diagnostics/process-memory.ts";
import { installDisplayCapturePolicy } from "./display-capture-policy.ts";
import { registerHtmlPreviewTicketIpc } from "./files/html-preview-ipc.ts";
import { registerBundledFonts } from "./fonts/register-bundled-fonts.ts";
import { applyGpuWorkarounds } from "./gpu-workarounds.ts";
import { registerAgentRuntimeHostIpc } from "./ipc/agent-runtime-host.ts";
import { registerAgentsIpc } from "./ipc/agents.ts";
import { registerClipboardIpc } from "./ipc/clipboard.ts";
import { registerCommandIpc } from "./ipc/command.ts";
import { registerExternalNavigationIpc } from "./ipc/external-navigation.ts";
import { registerFilePreviewTicketIpc } from "./ipc/file-preview-ticket.ts";
import { registerFileQueryIpc } from "./ipc/file-query.ts";
import { registerFileSaveTargetIpc } from "./ipc/file-save-target.ts";
import { registerFileWatchIpc } from "./ipc/file-watch.ts";
import { registerFilesFolderPermissionIpc } from "./ipc/files/folder-permission.ts";
import {
  closeForegroundActivityResources,
  foregroundActivityService,
  registerForegroundActivityIpc,
} from "./ipc/foreground-activity.ts";
import { registerGitWatchIpc } from "./ipc/git-watch.ts";
import { registerHostCatalogIpc } from "./ipc/host-catalog.ts";
import { disposeLspIpcHost, registerLspIpc } from "./ipc/lsp.ts";
import { registerMediaPreviewIpc } from "./ipc/media-preview.ts";
import { registerMenuIpc } from "./ipc/menu.ts";
import {
  flushNotificationCenterHistory,
  registerNotificationCenterIpc,
} from "./ipc/notification-center.ts";
import { registerPierResourceIpc } from "./ipc/pier-resource.ts";
import { registerRendererCommandIpc } from "./ipc/renderer-command.ts";
import { registerTaskRuntimeDiagnosticsIpc } from "./ipc/task-runtime-diagnostics.ts";
import { registerTerminalDebugWindowIpc } from "./ipc/terminal/debug-window.ts";
import { getTerminalAddon, registerTerminalIpc } from "./ipc/terminal/index.ts";
import { registerThemeIpc } from "./ipc/theme.ts";
import { registerUsageDataIpc } from "./ipc/usage-data.ts";
import { registerWindowIpc } from "./ipc/window.ts";
import {
  invokeRendererMenuCommand,
  openTerminalFromMenu,
  prepareQuitDialogWindow,
  toggleCommandPaletteFromMenu,
} from "./menu/window-actions.ts";
import { handlePreferencesChangedForWindows } from "./preferences-broadcast.ts";
import { isDevRuntime } from "./runtime-mode.ts";
import { abortMissingSingleInstanceLock } from "./startup-diagnostics.ts";
import { reconcileOrphanedBackgroundProcesses } from "./state/background-task-process-ledger.ts";
import { flushPairingState } from "./state/pairing-store.ts";
import { migrateTerminalSessionScopesToRecordIds } from "./state/terminal-session-scope-migration.ts";
import {
  migrateLegacyAgentSuccessTabs,
  reconcileOrphanedRunningTasks,
} from "./state/terminal-session-state.ts";
import { readPreferredOpenWindowRecordIds } from "./state/window-record-state.ts";
import type { AppWindow } from "./windows/app-window.ts";
import { windowManager } from "./windows/manager.ts";
import { createWindowZoomController } from "./windows/zoom.ts";

const isDev = isDevRuntime();
const isMac = process.platform === "darwin";
const startupLog = createLogger("startup");
const windowLog = createLogger("window");
const windowZoomLog = createLogger("window-zoom");
const cliLog = createLogger("cli");
const terminalSessionLog = createLogger("terminal-session");
const foregroundActivityLog = createLogger("foreground-activity");
const appQuitLog = createLogger("app-quit");
const localControlRegistration = createLocalControlRegistrationOwner({
  logError: (error) => {
    cliLog.error("failed to start or close local control server", { error });
  },
  register: (signal) => registerCliLocalControl({ signal }),
});
const windowZoom = createWindowZoomController({
  listWindows: () => windowManager.getAll(),
  readPreferences: () => appCore.services.preferences.read(),
  updatePreferences: (patch) => appCore.services.preferences.update(patch),
});
windowManager.onCreate(({ window }) => {
  windowZoom.applyPersistedZoomToWindow(window).catch((error) => {
    windowZoomLog.error("apply to new window failed", { error });
  });
});
configureMainAppIdentity(isDev);
applyGpuWorkarounds();
// 第二实例不再继续 bootstrap。dev 打印原因并 exit(1)；生产包仍 quit。
const gotTheLock = app.requestSingleInstanceLock();
if (gotTheLock) {
  installMainDiagnosticsLogging();
  installProcessMemoryTrail();
} else {
  abortMissingSingleInstanceLock(isDev, app, (message) => {
    startupLog.error(message);
  });
}

function getMenuTargetWindow(): AppWindow | null {
  return (
    windowManager.getFocused() ??
    windowManager.getAll().find((win) => !win.isDestroyed()) ??
    null
  );
}

function getQuitDialogParentWindow(): AppWindow | null {
  return getMenuTargetWindow();
}

function createFreshWindowFromMenu(): void {
  appCore.services.window.create({ mode: "fresh" }).catch((error) => {
    windowLog.error("failed to create new window", { error });
  });
}

async function flushBeforeQuitConfirmed(): Promise<void> {
  await appCore.services.window.flushOpenWindows(async () => {
    await Promise.all([
      appCore.flushExternalPluginsBeforeQuit(),
      appCore.services.secrets.flush(),
      appCore.services.agentUsage.flush(),
      appCore.services.usageData.flush(),
      flushNotificationCenterHistory(),
    ]);
  });
  // remote-control：先停监听与会合拨号（断开移动端连接）再 flush 配对状态落盘。
  appCore.services.remoteControl?.uplink?.stop();
  await appCore.services.remoteControl?.owner.stop();
  await flushPairingState();
  // Clean quit：在销毁窗口前对 background 任务做 TERM→grace→KILL。
  await appCore.services.tasks.shutdownForQuit();
  await localControlRegistration.close();
  await disposeLspIpcHost();
}

const appQuitRendererTransport = createAppQuitRendererTransport({
  getFallbackWindow: getQuitDialogParentWindow,
  prepareWindow: prepareQuitDialogWindow,
});

const appQuitController = createAppQuitController({
  confirmQuit: ({ parent, summaries }) =>
    showAppQuitConfirmation({
      sendRequest: (request) =>
        appQuitRendererTransport.sendRequest(parent, request),
      summaries,
    }),
  finalCleanup: () => {
    try {
      closeForegroundActivityResources();
    } catch (error) {
      foregroundActivityLog.error("failed to close resources before quit", {
        error,
      });
    }
    appCore.services.tasks.dispose();
    windowManager.destroyAllForQuit();
    appCore.disposeManagedPluginDevRuntimeWatch();
    appCore.disposePluginDataProjections();
    appCore.pluginHost.dispose();
    localControlRegistration.close().catch((error: unknown) => {
      appQuitLog.error("failed to close local control before quit", { error });
    });
    appCore.services.remoteControl?.uplink?.stop();
    appCore.services.remoteControl?.owner.stop().catch((error: unknown) => {
      appQuitLog.error("failed to stop remote control before quit", {
        error,
      });
    });
  },
  flushBeforeQuit: flushBeforeQuitConfirmed,
  getActivities: () => foregroundActivityService.snapshot().activities,
  getTaskRuns: () => appCore.services.tasks.runsSnapshot(),
  getDialogParent: getQuitDialogParentWindow,
  logFailure: (error) => {
    appQuitLog.error("failed before quit", { error });
  },
  reportFailure: (error) => {
    dialog.showErrorBox(
      app.getLocale().toLowerCase().startsWith("zh")
        ? "无法退出 Pier"
        : "Unable to quit Pier",
      formatQuitFailure(error)
    );
  },
  proceedToQuit: () => {
    // flush 成功后才执行 intentional relaunch / quitAndInstall，避免
    // 更新安装跳过 prepareClose 导致布局与 window-record 未落盘。
    // 先旁路 close intercept：updater / 二次 app.quit 关窗时不再二次 prepareClose。
    windowManager.beginQuit();
    const action = consumeIntentionalQuitAction();
    if (action === "quitAndInstall") {
      appCore.services.appUpdates.quitAndInstall();
      // updater 在 state 竞态下可能 no-op；仍退出，避免卡在 quitting。
      app.quit();
      return;
    }
    if (action === "relaunch") {
      app.relaunch();
    }
    app.quit();
  },
  readConfirmationMode: async () => {
    const preferences = await appCore.services.preferences.read();
    return preferences.confirmOnQuit;
  },
  disarmIntentionalRelaunch,
  isIntentionalRelaunch: isIntentionalRelaunchArmed,
  shouldBypassQuitConfirmationForTests,
});

if (gotTheLock) {
  Promise.resolve()
    .then(() => {
      registerPrivilegedProtocolSchemes();
      return app.whenReady();
    })
    .then(async () => {
      attachPrivilegedProtocolHandlers({
        getPluginRuntimeSources: () =>
          appCore.services.managedPlugins.getRuntimeSources(),
      });
      installDisplayCapturePolicy();
      await appCore.ready;
      await appCore.pluginHost.refresh();
      await installAppMenu({
        appName: app.name,
        eventBus: appCore.eventBus,
        getSystemLocale: () => app.getLocale(),
        getTargetWindow: getMenuTargetWindow,
        isDev,
        isMac,
        onMenuCommand: invokeRendererMenuCommand,
        onNewTerminal: openTerminalFromMenu,
        onNewWindow: createFreshWindowFromMenu,
        onOpenCommandPalette: toggleCommandPaletteFromMenu,
        onResetZoom: () => {
          windowZoom.resetZoom().catch((error) => {
            windowZoomLog.error("reset failed", { error });
          });
        },
        onZoomIn: () => {
          windowZoom.zoomIn().catch((error) => {
            windowZoomLog.error("zoom in failed", { error });
          });
        },
        onZoomOut: () => {
          windowZoom.zoomOut().catch((error) => {
            windowZoomLog.error("zoom out failed", { error });
          });
        },
        readPreferences: () => appCore.services.preferences.read(),
      });
      appCore.eventBus.subscribe((event) => {
        if (event.type === "preferences.changed") {
          handlePreferencesChangedForWindows({
            applyZoomLevel: (level) => windowZoom.applyZoomLevel(level),
            changedKeys: event.changedKeys,
            listWindows: () => windowManager.getAll(),
            snapshot: event.snapshot,
          });
        }
      });

      await startBackgroundSchedulers();
      registerWindowIpc(ipcMain);
      registerCommandIpc(ipcMain);
      registerExternalNavigationIpc(ipcMain, {
        // Same instance as the app.openExternal command path so the nonce
        // replay guard covers both entrances.
        service: appCore.services.externalNavigation,
        windowForSender: (sender) => windowManager.fromWebContents(sender),
      });
      registerFileSaveTargetIpc(ipcMain);
      registerFilesFolderPermissionIpc(ipcMain);
      registerFilePreviewTicketIpc();
      registerHtmlPreviewTicketIpc();
      registerMediaPreviewIpc();
      registerMenuIpc(ipcMain);
      registerClipboardIpc(ipcMain);
      registerAgentsIpc(ipcMain);
      registerHostCatalogIpc(ipcMain);
      registerForegroundActivityIpc(ipcMain);
      registerNotificationCenterIpc(ipcMain, {
        eventBus: appCore.eventBus,
      });
      registerAgentRuntimeHostIpc(ipcMain, {
        eventBus: appCore.eventBus,
        index: appCore.services.agentRuntimeIndex,
        ...(appCore.services.pendingInteractions
          ? { pendingInteractions: appCore.services.pendingInteractions }
          : {}),
      });
      registerPierResourceIpc(ipcMain);
      registerUsageDataIpc(ipcMain, appCore.services.usageData);
      ipcMain.handle(PIER.APP_QUIT_DECISION, (_event, payload: unknown) => {
        appQuitRendererTransport.handleDecision(payload);
      });
      ipcMain.handle(PIER.ENVIRONMENT_PICK_PROJECT_DIRECTORY, async (event) => {
        const focusedWindow =
          BrowserWindow.fromWebContents(event.sender) ??
          BrowserWindow.getFocusedWindow();
        if (focusedWindow) {
          const result = await dialog.showOpenDialog(focusedWindow, {
            properties: ["openDirectory"],
          });
          return result.canceled ? null : (result.filePaths[0] ?? null);
        }
        const result = await dialog.showOpenDialog({
          properties: ["openDirectory"],
        });
        return result.canceled ? null : (result.filePaths[0] ?? null);
      });
      registerRendererCommandIpc(ipcMain);
      registerBundledFonts();
      registerTerminalIpc(ipcMain, {
        launchGate: appCore.services.agentLaunchGate,
        localEnvironments: appCore.services.localEnvironments,
        processEnvironment: appCore.services.processEnvironment,
        recordAgentLaunch: (id) =>
          appCore.services.agentUsage.recordSuccessfulLaunch(id),
        taskService: appCore.services.tasks,
      });
      registerPeerUidFromNativeAddon(getTerminalAddon());
      registerTaskRuntimeDiagnosticsIpc(ipcMain);
      registerTerminalDebugWindowIpc(ipcMain, {
        isQuitting: () => windowManager.isQuitting(),
      });
      registerThemeIpc(ipcMain);
      registerGitWatchIpc();
      registerFileWatchIpc();
      registerFileQueryIpc();
      registerLspIpc();
      localControlRegistration.start();
      // Legacy session keys → record UUIDs; must finish before restore.
      try {
        await migrateTerminalSessionScopesToRecordIds(
          await readPreferredOpenWindowRecordIds()
        );
      } catch (error: unknown) {
        terminalSessionLog.error("session scope migration failed", { error });
        throw error;
      }
      // Panel transfer journal must converge before orphan reconcile + window restore.
      await appCore.services.panelTransfer
        ?.recoverPending()
        .catch((error: unknown) => {
          terminalSessionLog.error("panel transfer recovery failed", { error });
        });
      // 孤儿 task 清算必须先于窗口恢复(renderer readSession 磁盘状态不再说谎:
      // 上进程 running 一律 cancelled), 并在 UI sweep 前只回收本 app 登记的 pid.
      await reconcileOrphanedBackgroundProcesses().catch((error: unknown) => {
        terminalSessionLog.error("orphan background process sweep failed", {
          error,
        });
      });
      await reconcileOrphanedRunningTasks().catch((error: unknown) => {
        terminalSessionLog.error("orphan task sweep failed", { error });
      });
      await migrateLegacyAgentSuccessTabs().catch((error: unknown) => {
        terminalSessionLog.error("legacy agent success tab migrate failed", {
          error,
        });
      });
      const restored = await appCore.services.window.restoreOpenWindows();
      if (restored.length === 0) {
        await appCore.services.window.create({ mode: "fresh" });
      }

      app.on("activate", () => {
        if (windowManager.getAll().length === 0) {
          appCore.services.window
            .restoreMostRecentClosed()
            .then(async (restoredWindow) => {
              if (!restoredWindow) {
                await appCore.services.window.create({ mode: "fresh" });
              }
            })
            .catch((error) => {
              windowLog.error("failed to restore window on activate", {
                error,
              });
            });
        }
      });
    })
    .catch((error: unknown) =>
      handleMainStartupFailure({
        cleanupTasks: [
          {
            label: "foreground activity",
            run: () => closeForegroundActivityResources(),
          },
          { label: "tasks", run: () => appCore.services.tasks.dispose() },
          { label: "windows", run: () => windowManager.destroyAllForQuit() },
          {
            label: "managed plugin watcher",
            run: () => appCore.disposeManagedPluginDevRuntimeWatch(),
          },
          { label: "plugin host", run: () => appCore.pluginHost.dispose() },
          {
            label: "local control",
            run: () => localControlRegistration.close(),
          },
        ],
        error,
        exit: (code) => app.exit(code),
        isChinese: app.getLocale().toLowerCase().startsWith("zh"),
        log: (message, cause) => startupLog.error(message, { error: cause }),
        showError: (title, body) => dialog.showErrorBox(title, body),
      })
    );
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (!gotTheLock) {
    return;
  }
  appQuitController.handleBeforeQuit(event);
});
