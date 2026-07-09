import { join } from "node:path";
import { PIER, PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { createLogger } from "@shared/logger.ts";
import { app, BrowserWindow, dialog, ipcMain, nativeImage } from "electron";
import {
  type RegisteredLocalControl,
  registerCliLocalControl,
} from "./adapters/cli/register-local-control.ts";
import { appCore } from "./app-core/app-core.ts";
import { installAppMenu } from "./app-menu.ts";
import { showAppQuitConfirmation } from "./app-quit/quit-confirmation.ts";
import { createAppQuitController } from "./app-quit/quit-controller.ts";
import { createAppQuitRendererTransport } from "./app-quit/quit-renderer-transport.ts";
import { shouldBypassQuitConfirmationForTests } from "./app-quit/quit-test-runtime.ts";
import { installCsp } from "./csp.ts";
import { installMainDiagnosticsLogging } from "./diagnostics/app-diagnostics.ts";
import {
  handleAssetProtocol,
  registerAssetScheme,
} from "./fonts/asset-protocol.ts";
import { registerBundledFonts } from "./fonts/register-bundled-fonts.ts";
import { registerAgentsIpc } from "./ipc/agents.ts";
import { registerCommandIpc } from "./ipc/command.ts";
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
import { registerSecretsIpc } from "./ipc/secrets.ts";
import { registerSystemStatsIpc } from "./ipc/system-stats.ts";
import { registerTerminalIpc } from "./ipc/terminal.ts";
import { registerTerminalDebugWindowIpc } from "./ipc/terminal-debug-window.ts";
import { setTerminalPanelClosedHandler } from "./ipc/terminal-panel-closed.ts";
import { registerThemeIpc } from "./ipc/theme.ts";
import { registerWindowIpc } from "./ipc/window.ts";
import {
  handlePluginAssetProtocol,
  registerPluginAssetScheme,
} from "./plugins/plugin-asset-protocol.ts";
import { handlePreferencesChangedForWindows } from "./preferences-broadcast.ts";
import { isDevRuntime } from "./runtime-mode.ts";
import { createGitAutofetchService } from "./services/git-autofetch-service.ts";
import { formatDevSingleInstanceLockFailure } from "./startup-diagnostics.ts";
import { reconcileOrphanedRunningTasks } from "./state/terminal-session-state.ts";
import type { AppWindow } from "./windows/app-window.ts";
import { windowManager } from "./windows/window-manager.ts";
import { createWindowZoomController } from "./windows/window-zoom.ts";

const isDev = isDevRuntime();
const isMac = process.platform === "darwin";
const DEV_USER_DATA_ROOT = "Pier-dev";
let localControl: RegisteredLocalControl | null = null;
const startupLog = createLogger("startup");
const windowLog = createLogger("window");
const windowZoomLog = createLogger("window-zoom");
const cliLog = createLogger("cli");
const taskRunLog = createLogger("task-run");
const terminalSessionLog = createLogger("terminal-session");
const foregroundActivityLog = createLogger("foreground-activity");
const secretsLog = createLogger("secrets");
const appQuitLog = createLogger("app-quit");
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

// dev mode silence "Insecure CSP (unsafe-eval)" warning: dev CSP 必须含 'unsafe-eval'
// (vite HMR + react-refresh 依赖 eval).
if (isDev) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
}

function hasExplicitUserDataDir(argv: readonly string[]): boolean {
  return argv.some(
    (arg) => arg === "--user-data-dir" || arg.startsWith("--user-data-dir=")
  );
}

function devUserDataDirForCwd(cwd: string): string {
  return join(cwd, `.${DEV_USER_DATA_ROOT.toLowerCase()}`, "userData");
}

function setUserDataPath(userDataDir: string): void {
  if (hasExplicitUserDataDir(process.argv)) {
    return;
  }
  app.setPath("userData", userDataDir);
}

function configureAppIdentity(): void {
  if (isDev) {
    const cwd = process.cwd();
    setUserDataPath(
      process.env.ELECTRON_USER_DATA_DIR ?? devUserDataDirForCwd(cwd)
    );
  }
  app.setName("Pier");
}

configureAppIdentity();

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

async function flushBeforeQuitConfirmed(): Promise<void> {
  try {
    closeForegroundActivityResources();
  } catch (error) {
    foregroundActivityLog.error("failed to close resources before quit", {
      error,
    });
  }

  await Promise.all([
    appCore.flushExternalPluginsBeforeQuit().catch((error) => {
      appQuitLog.error("failed to flush external plugins before quit", {
        error,
      });
    }),
    appCore.services.window.flushOpenWindows().catch((error) => {
      windowLog.error("failed to flush windows before quit", { error });
    }),
    appCore.services.secrets.flush().catch((error) => {
      secretsLog.error("failed to flush before quit", { error });
    }),
  ]);
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
    appCore.services.tasks.dispose();
    windowManager.destroyAllForQuit();
    appCore.disposeManagedPluginDevRuntimeWatch();
    appCore.pluginHost.dispose();
    localControl?.close().catch(() => {
      // ignore: app 正在退出
    });
    localControl = null;
  },
  flushBeforeQuit: flushBeforeQuitConfirmed,
  getActivities: () => foregroundActivityService.snapshot().activities,
  getDialogParent: getQuitDialogParentWindow,
  logFailure: (error) => {
    appQuitLog.error("failed before quit", { error });
  },
  proceedToQuit: () => app.quit(),
  readConfirmationMode: async () => {
    const preferences = await appCore.services.preferences.read();
    return preferences.confirmOnQuit;
  },
  shouldBypassQuitConfirmationForTests,
});

registerAssetScheme();
registerPluginAssetScheme();

app.whenReady().then(async () => {
  installCsp();
  handleAssetProtocol();
  handlePluginAssetProtocol({
    getRuntimeSources: () =>
      appCore.services.managedPlugins.getRuntimeSources(),
  });
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

  // git autofetch：只写 git、经 watch 签名广播进入既有数据流（spec §4）
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
    // 聚焦补课：后台 poll 被门控跳过（A5），聚焦瞬间对活跃仓库全量重算一次签名，
    // 弥补后台错过的 poll，走既有 watch 广播管道。
    for (const root of appCore.services.gitWatch.activeRoots()) {
      appCore.services.gitWatch.pulse(root);
    }
  });
  app.on("will-quit", () => {
    gitAutofetch.dispose();
  });

  // mac dev: dock icon 默认是 Electron 紫色; 显式设成 Pier 图标.
  if (isMac && isDev && app.dock) {
    app.dock.setIcon(
      nativeImage.createFromPath(
        join(import.meta.dirname, "../../build/icon.png")
      )
    );
  }

  registerWindowIpc(ipcMain);
  registerCommandIpc(ipcMain);
  registerMenuIpc(ipcMain);
  registerAgentsIpc(ipcMain);
  registerForegroundActivityIpc(ipcMain);
  registerSystemStatsIpc(ipcMain);
  ipcMain.handle(PIER.APP_QUIT_DECISION, (_event, payload: unknown) => {
    appQuitRendererTransport.handleDecision(payload);
  });
  registerSecretsIpc(ipcMain, appCore.services.secrets);
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
  // 注册打包字体给 CoreText, 必须早于任何 terminal 创建, 否则 ghostty 找不到非系统字体.
  registerBundledFonts();
  registerTerminalIpc(ipcMain, {
    processEnvironment: appCore.services.processEnvironment,
  });
  registerTerminalDebugWindowIpc(ipcMain);
  registerThemeIpc(ipcMain);
  registerNotificationIpc(ipcMain);
  registerGitWatchIpc();
  registerFileWatchIpc();
  setTerminalPanelClosedHandler((panelId, exitCode, windowId) => {
    if (typeof exitCode === "number") {
      appCore.services.tasks
        .completePanel(panelId, exitCode, windowId)
        .catch((error) => {
          taskRunLog.error("failed to complete panel", { error });
        });
      return;
    }
    appCore.services.tasks.markPanelClosed(panelId, windowId);
  });
  registerCliLocalControl()
    .then((control) => {
      localControl = control;
    })
    .catch((error: unknown) => {
      cliLog.error("failed to start local control server", { error });
    });

  // 孤儿 task 清算必须先于窗口恢复：renderer readSession 读到的磁盘状态
  // 从此不说谎（上进程遗留的 running 一律 cancelled）。
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
          windowLog.error("failed to restore window on activate", { error });
        });
    }
  });
});

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
