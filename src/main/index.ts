import { join } from "node:path";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
import { app, ipcMain, nativeImage } from "electron";
import {
  type RegisteredLocalControl,
  registerCliLocalControl,
} from "./adapters/cli/register-local-control.ts";
import { appCore } from "./app-core/app-core.ts";
import { installAppMenu } from "./app-menu.ts";
import { installCsp } from "./csp.ts";
import {
  handleAssetProtocol,
  registerAssetScheme,
} from "./fonts/asset-protocol.ts";
import { registerBundledFonts } from "./fonts/register-bundled-fonts.ts";
import { registerAgentsIpc } from "./ipc/agents.ts";
import { registerCommandIpc } from "./ipc/command.ts";
import { registerCommandPaletteMruIpc } from "./ipc/command-palette-mru.ts";
import { registerGitWatchIpc } from "./ipc/git-watch.ts";
import { registerMenuIpc } from "./ipc/menu.ts";
import { registerPreferencesIpc } from "./ipc/preferences.ts";
import { registerRendererCommandIpc } from "./ipc/renderer-command.ts";
import { registerSecretsIpc } from "./ipc/secrets.ts";
import { registerTerminalIpc } from "./ipc/terminal.ts";
import { registerTerminalDebugWindowIpc } from "./ipc/terminal-debug-window.ts";
import { setTerminalPanelClosedHandler } from "./ipc/terminal-panel-closed.ts";
import { registerThemeIpc } from "./ipc/theme.ts";
import { registerWindowIpc } from "./ipc/window.ts";
import { registerWorkspaceIpc } from "./ipc/workspace.ts";
import { handlePreferencesChangedForWindows } from "./preferences-broadcast.ts";
import { isDevRuntime } from "./runtime-mode.ts";
import { formatDevSingleInstanceLockFailure } from "./startup-diagnostics.ts";
import type { AppWindow } from "./windows/app-window.ts";
import { windowManager } from "./windows/window-manager.ts";
import { createWindowZoomController } from "./windows/window-zoom.ts";

const isDev = isDevRuntime();
const isMac = process.platform === "darwin";
const DEV_USER_DATA_ROOT = "Pier-dev";
let localControl: RegisteredLocalControl | null = null;
let didFlushBeforeQuit = false;
const windowZoom = createWindowZoomController({
  listWindows: () => windowManager.getAll(),
  readPreferences: () => appCore.services.preferences.read(),
  updatePreferences: (patch) => appCore.services.preferences.update(patch),
});

windowManager.onCreate(({ window }) => {
  windowZoom.applyPersistedZoomToWindow(window).catch((error) => {
    console.error("[window-zoom] apply to new window failed:", error);
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
if (!gotTheLock) {
  if (isDev) {
    console.error(
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

function createFreshWindowFromMenu(): void {
  appCore.services.window.create({ mode: "fresh" }).catch((error) => {
    console.error(
      "[window] failed to create new window:",
      error instanceof Error ? error.message : String(error)
    );
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

registerAssetScheme();

app.whenReady().then(async () => {
  installCsp();
  handleAssetProtocol();
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
        console.error("[window-zoom] reset failed:", error);
      });
    },
    onZoomIn: () => {
      windowZoom.zoomIn().catch((error) => {
        console.error("[window-zoom] zoom in failed:", error);
      });
    },
    onZoomOut: () => {
      windowZoom.zoomOut().catch((error) => {
        console.error("[window-zoom] zoom out failed:", error);
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
  registerPreferencesIpc(ipcMain);
  registerSecretsIpc(ipcMain, appCore.services.secrets);
  registerRendererCommandIpc(ipcMain);
  // 注册打包字体给 CoreText, 必须早于任何 terminal 创建, 否则 ghostty 找不到非系统字体.
  registerBundledFonts();
  registerTerminalIpc(ipcMain);
  registerTerminalDebugWindowIpc(ipcMain);
  registerThemeIpc(ipcMain);
  registerWorkspaceIpc(ipcMain);
  registerCommandPaletteMruIpc(ipcMain);
  registerGitWatchIpc();
  setTerminalPanelClosedHandler((panelId, exitCode, windowId) => {
    if (typeof exitCode === "number") {
      appCore.services.tasks
        .completePanel(panelId, exitCode, windowId)
        .catch((error) => {
          console.error("[task-run] failed to complete panel:", error);
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
      console.error(
        "[cli] failed to start local control server:",
        error instanceof Error ? error.message : String(error)
      );
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
          console.error(
            "[window] failed to restore window on activate:",
            error instanceof Error ? error.message : String(error)
          );
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
  if (!didFlushBeforeQuit) {
    event.preventDefault();
    didFlushBeforeQuit = true;
    Promise.all([
      appCore.services.window.flushOpenWindows().catch((error) => {
        console.error(
          "[window] failed to flush windows before quit:",
          error instanceof Error ? error.message : String(error)
        );
      }),
      appCore.services.secrets.flush().catch((error) => {
        console.error(
          "[secrets] failed to flush before quit:",
          error instanceof Error ? error.message : String(error)
        );
      }),
    ]).finally(() => {
      app.quit();
    });
    return;
  }
  windowManager.destroyAllForQuit();
  appCore.pluginHost.dispose();
  localControl?.close().catch(() => {
    // ignore: app 正在退出
  });
  localControl = null;
});
