import { join } from "node:path";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { createLogger } from "@shared/logger.ts";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  shell,
} from "electron";
import { createLocalControlRegistrationOwner } from "./adapters/cli/local-control-registration.ts";
import { registerCliLocalControl } from "./adapters/cli/register-local-control.ts";
import { appCore } from "./app-core/app-core.ts";
import { configureMainAppIdentity } from "./app-identity.ts";
import { installAppMenu } from "./app-menu.ts";
import { showAppQuitConfirmation } from "./app-quit/quit-confirmation.ts";
import { createAppQuitController } from "./app-quit/quit-controller.ts";
import { createAppQuitRendererTransport } from "./app-quit/quit-renderer-transport.ts";
import { shouldBypassQuitConfirmationForTests } from "./app-quit/quit-test-runtime.ts";
import { handleMainStartupFailure } from "./app-startup-failure.ts";
import { installCsp } from "./csp.ts";
import { installMainDiagnosticsLogging } from "./diagnostics/app-diagnostics.ts";
import {
  handleFilePreviewProtocol,
  registerFilePreviewRequestGuard,
  registerFilePreviewScheme,
} from "./files/file-preview-protocol.ts";
import {
  handleAssetProtocol,
  registerAssetScheme,
} from "./fonts/asset-protocol.ts";
import { registerBundledFonts } from "./fonts/register-bundled-fonts.ts";
import { registerAgentsIpc } from "./ipc/agents.ts";
import { registerCommandIpc } from "./ipc/command.ts";
import { registerExternalNavigationIpc } from "./ipc/external-navigation.ts";
import { registerFilePreviewTicketIpc } from "./ipc/file-preview-ticket.ts";
import { registerFileSaveTargetIpc } from "./ipc/file-save-target.ts";
import { registerFileWatchIpc } from "./ipc/file-watch.ts";
import {
  closeForegroundActivityResources,
  foregroundActivityService,
  registerForegroundActivityIpc,
} from "./ipc/foreground-activity.ts";
import { registerGitWatchIpc } from "./ipc/git-watch.ts";
import { registerMenuIpc } from "./ipc/menu.ts";
import { registerNotificationIpc } from "./ipc/notification.ts";
import { registerRendererCommandIpc } from "./ipc/renderer-command.ts";
import { registerSystemStatsIpc } from "./ipc/system-stats.ts";
import { registerTerminalIpc } from "./ipc/terminal.ts";
import { registerTerminalDebugWindowIpc } from "./ipc/terminal-debug-window.ts";
import { registerThemeIpc } from "./ipc/theme.ts";
import { registerUsageDataIpc } from "./ipc/usage-data.ts";
import { registerWindowIpc } from "./ipc/window.ts";
import {
  handlePluginAssetProtocol,
  registerPluginAssetScheme,
} from "./plugins/plugin-asset-protocol.ts";
import { handlePreferencesChangedForWindows } from "./preferences-broadcast.ts";
import { isDevRuntime } from "./runtime-mode.ts";
import { createExternalNavigationService } from "./services/external-navigation.ts";
import { createGitAutofetchService } from "./services/git-autofetch-service.ts";
import { formatDevSingleInstanceLockFailure } from "./startup-diagnostics.ts";
import { reconcileOrphanedBackgroundProcesses } from "./state/background-task-process-ledger.ts";
import { reconcileOrphanedRunningTasks } from "./state/terminal-session-state.ts";
import type { AppWindow } from "./windows/app-window.ts";
import { windowManager } from "./windows/window-manager.ts";
import { createWindowZoomController } from "./windows/window-zoom.ts";

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

// 第二实例直接 quit + return 不继续 bootstrap, 否则会撞主实例的 userData 文件锁.
const gotTheLock = app.requestSingleInstanceLock();
if (gotTheLock) {
  installMainDiagnosticsLogging();
} else {
  if (isDev) {
    startupLog.error(
      formatDevSingleInstanceLockFailure({
        userDataDir: app.getPath("userData"),
        ...(process.env.PIER_DEV_PROFILE
          ? { profile: process.env.PIER_DEV_PROFILE }
          : {}),
        ...(process.env.ELECTRON_RENDERER_URL
          ? { rendererUrl: process.env.ELECTRON_RENDERER_URL }
          : {}),
      })
    );
  }
  app.quit();
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

function openTerminalFromMenu(target: AppWindow | null): void {
  if (!target || target.isDestroyed() || target.webContents.isDestroyed()) {
    return;
  }
  if (target.isMinimized()) {
    target.restore();
  }
  if (isMac) {
    app.focus({ steal: true });
  }
  target.focus();
  target.webContents.focus();
  target.webContents.send(PIER_BROADCAST.NEW_TERMINAL_REQUEST);
}

function openTerminalSearchFromMenu(target: AppWindow | null): void {
  if (!target || target.isDestroyed() || target.webContents.isDestroyed()) {
    return;
  }
  if (target.isMinimized()) {
    target.restore();
  }
  if (isMac) {
    app.focus({ steal: true });
  }
  target.focus();
  target.webContents.focus();
  target.webContents.send(PIER_BROADCAST.TERMINAL_SEARCH_OPEN_REQUEST);
}

function toggleCommandPaletteFromMenu(target: AppWindow | null): void {
  if (!target || target.isDestroyed() || target.webContents.isDestroyed()) {
    return;
  }
  if (target.isMinimized()) {
    target.restore();
  }
  if (isMac) {
    app.focus({ steal: true });
  }
  target.focus();
  target.webContents.focus();
  target.webContents.send(PIER_BROADCAST.COMMAND_PALETTE_TOGGLE_REQUEST);
}

function prepareQuitDialogWindow(target: AppWindow): void {
  if (target.isMinimized()) {
    target.restore();
  }
  if (isMac) {
    app.focus({ steal: true });
  }
  target.focus();
  target.webContents.focus();
}

function formatQuitFailure(error: unknown): string {
  const isChinese = app.getLocale().toLowerCase().startsWith("zh");
  if (!(error instanceof Error)) return String(error);
  let summary = error.message;
  if (summary === "window close preparation failed") {
    summary = isChinese
      ? "窗口关闭准备失败"
      : "Window close preparation failed";
  }
  if (!(error instanceof AggregateError)) return summary;
  const details = error.errors.map((item) =>
    item instanceof Error ? item.message : String(item)
  );
  return [summary, ...details].join("\n");
}

async function flushBeforeQuitConfirmed(): Promise<void> {
  await appCore.services.window.flushOpenWindows(async () => {
    await Promise.all([
      appCore.flushExternalPluginsBeforeQuit(),
      appCore.services.secrets.flush(),
      appCore.services.agentUsage.flush(),
      appCore.services.usageData.flush(),
    ]);
  });
  // Clean quit：在销毁窗口前对 background 任务做 TERM→grace→KILL。
  await appCore.services.tasks.shutdownForQuit();
  await localControlRegistration.close();
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
    appCore.pluginHost.dispose();
    localControlRegistration.close().catch((error: unknown) => {
      appQuitLog.error("failed to close local control before quit", { error });
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
  proceedToQuit: () => app.quit(),
  readConfirmationMode: async () => {
    const preferences = await appCore.services.preferences.read();
    return preferences.confirmOnQuit;
  },
  shouldBypassQuitConfirmationForTests,
});

if (gotTheLock) {
  Promise.resolve()
    .then(() => {
      registerAssetScheme();
      registerPluginAssetScheme();
      registerFilePreviewScheme();
      return app.whenReady();
    })
    .then(async () => {
      installCsp();
      handleAssetProtocol();
      registerFilePreviewRequestGuard();
      handleFilePreviewProtocol();
      handlePluginAssetProtocol({
        getRuntimeSources: () =>
          appCore.services.managedPlugins.getRuntimeSources(),
      });
      await appCore.ready;
      await appCore.pluginHost.refresh();
      await installAppMenu({
        appName: app.name,
        eventBus: appCore.eventBus,
        getSystemLocale: () => app.getLocale(),
        getTargetWindow: getMenuTargetWindow,
        isDev,
        isMac,
        onFindInTerminal: openTerminalSearchFromMenu,
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
      app.on("browser-window-focus", () => {
        gitAutofetch.onFocusGained();
        // 聚焦时重算活跃仓库签名，补回后台门控跳过的 poll。
        for (const root of appCore.services.gitWatch.activeRoots()) {
          appCore.services.gitWatch.pulse(root);
        }
      });
      app.on("will-quit", () => {
        gitAutofetch.dispose();
      });

      if (isMac && isDev && app.dock) {
        app.dock.setIcon(
          nativeImage.createFromPath(
            join(import.meta.dirname, "../../build/icon.png")
          )
        );
      }

      registerWindowIpc(ipcMain);
      registerCommandIpc(ipcMain);
      registerExternalNavigationIpc(ipcMain, {
        service: createExternalNavigationService({
          now: Date.now,
          openExternal: (url) => shell.openExternal(url),
        }),
        windowForSender: (sender) => windowManager.fromWebContents(sender),
      });
      registerFileSaveTargetIpc(ipcMain);
      registerFilePreviewTicketIpc();
      registerMenuIpc(ipcMain);
      registerAgentsIpc(ipcMain);
      registerForegroundActivityIpc(ipcMain);
      registerSystemStatsIpc(ipcMain);
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
        recordAgentLaunch: (agentId) =>
          appCore.services.agentUsage.recordSuccessfulLaunch(agentId),
        processEnvironment: appCore.services.processEnvironment,
        taskService: appCore.services.tasks,
      });
      registerTerminalDebugWindowIpc(ipcMain, {
        isQuitting: () => windowManager.isQuitting(),
      });
      registerThemeIpc(ipcMain);
      registerNotificationIpc(ipcMain);
      registerGitWatchIpc();
      registerFileWatchIpc();
      localControlRegistration.start();
      // 孤儿 task 清算必须先于窗口恢复：renderer readSession 读到的磁盘状态
      // 从此不说谎（上进程遗留的 running 一律 cancelled）。
      // background OS 进程回收在 UI sweep 之前：只杀本 app 登记过的 pid。
      await reconcileOrphanedBackgroundProcesses().catch((error: unknown) => {
        terminalSessionLog.error("orphan background process sweep failed", {
          error,
        });
      });
      await reconcileOrphanedRunningTasks().catch((error: unknown) => {
        terminalSessionLog.error("orphan task sweep failed", { error });
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
