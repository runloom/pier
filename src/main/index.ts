import { join } from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  nativeImage,
} from "electron";
import { installCsp } from "./csp.ts";
import { registerWindowIpc } from "./ipc/window.ts";
import { windowManager } from "./windows/window-manager.ts";

const isDev = !app.isPackaged;
const isMac = process.platform === "darwin";
const DEV_USER_DATA_ROOT = "Pier-dev";

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
    setUserDataPath(devUserDataDirForCwd(cwd));
  }
  app.setName("Pier");
}

configureAppIdentity();

// 第二实例直接 quit + return 不继续 bootstrap, 否则会撞主实例的 userData 文件锁.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// macOS 默认 Electron menu 极简, 没 Edit menu → Cmd+C/V/X/A 在 app 内 (含 DevTools)
// 全部失效。手动注册标准 menu: App / Edit / View / Window。
// autoHideMenuBar=true 让 win/linux 仍隐藏 menu bar; mac 的 menu 在屏幕顶部不受影响。
function buildAppMenu(): Menu {
  const appName = app.name;
  const macAppMenu: MenuItemConstructorOptions = {
    label: appName,
    submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      ...(isMac
        ? ([
            { role: "pasteAndMatchStyle" },
            { role: "delete" },
            { role: "selectAll" },
          ] as MenuItemConstructorOptions[])
        : ([
            { role: "delete" },
            { type: "separator" },
            { role: "selectAll" },
          ] as MenuItemConstructorOptions[])),
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  };

  const newWindowMenuItem: MenuItemConstructorOptions = {
    click: () => windowManager.create(),
    label: "New Window",
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: "Window",
    submenu: isMac
      ? [
          newWindowMenuItem,
          { type: "separator" },
          { role: "minimize" },
          { role: "zoom" },
          { type: "separator" },
          { role: "front" },
          { type: "separator" },
          { role: "window" },
        ]
      : [
          newWindowMenuItem,
          { type: "separator" },
          { role: "minimize" },
          { role: "zoom" },
          { role: "close" },
        ],
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [macAppMenu] : []),
    editMenu,
    viewMenu,
    windowMenu,
  ];
  return Menu.buildFromTemplate(template);
}

app.whenReady().then(() => {
  installCsp();
  Menu.setApplicationMenu(buildAppMenu());

  // mac dev: dock icon 默认是 Electron 紫色; 显式设成 Pier 图标.
  if (isMac && isDev && app.dock) {
    app.dock.setIcon(
      nativeImage.createFromPath(
        join(import.meta.dirname, "../../build/icon.png")
      )
    );
  }

  registerWindowIpc(ipcMain);

  // 首窗口 id 固定 "main".
  windowManager.create({ id: "main" });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windowManager.create({ id: "main" });
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
