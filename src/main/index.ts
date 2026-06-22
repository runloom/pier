import { join } from "node:path";
import {
  app,
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
  nativeImage,
  nativeTheme,
  shell,
} from "electron";
import { installCsp } from "./csp.ts";

const isDev = !app.isPackaged;
const isMac = process.platform === "darwin";
const DEV_USER_DATA_ROOT = "Pier-dev";

// dev: win/linux BrowserWindow.icon 让任务栏 / 窗口标题栏看到 Pier 图标; mac 窗口本身不显示
// 图标 (hiddenInset titlebar), 但 dock icon 走 app.dock.setIcon 单独处理.
// packaged: 图标由 electron-builder 烘到可执行文件元数据, 运行时不需要 BrowserWindow.icon.
const DEV_WINDOW_ICON = isDev
  ? join(import.meta.dirname, "../../build/icon.png")
  : undefined;

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

async function createMainWindow(): Promise<BrowserWindow> {
  const resolved: "light" | "dark" = nativeTheme.shouldUseDarkColors
    ? "dark"
    : "light";
  nativeTheme.themeSource = "system";

  const bgPalette: Record<"light" | "dark", string> = {
    light: "#ffffff",
    dark: "#1e1e1e",
  };

  // 原生 titlebar: 保留系统标题栏 (关闭/最大化/最小化按钮), 不自定义.
  const iconOptions: Partial<Electron.BrowserWindowConstructorOptions> =
    !isMac && DEV_WINDOW_ICON ? { icon: DEV_WINDOW_ICON } : {};
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: bgPalette[resolved],
    ...iconOptions,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {
      // ignore: 外部 URL 打开失败由 OS 处理
    });
    return { action: "deny" };
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (isDev && rendererUrl) {
    await win.loadURL(rendererUrl);
  } else {
    await win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }

  return win;
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

  const windowMenu: MenuItemConstructorOptions = {
    label: "Window",
    submenu: isMac
      ? [
          { role: "minimize" },
          { role: "zoom" },
          { type: "separator" },
          { role: "front" },
          { type: "separator" },
          { role: "window" },
        ]
      : [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [macAppMenu] : []),
    editMenu,
    viewMenu,
    windowMenu,
  ];

  return Menu.buildFromTemplate(template);
}

app.whenReady().then(async () => {
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

  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
