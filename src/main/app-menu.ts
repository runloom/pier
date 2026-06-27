import type { PierEvent } from "@shared/contracts/events.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import { firstAcceleratorForCommand } from "@shared/keybindings.ts";
import { Menu, type MenuItemConstructorOptions } from "electron";
import { createDetachedDevToolsMenuItem } from "./devtools.ts";
import { createOpenSettingsMenuItem } from "./settings-menu.ts";
import type { AppWindow } from "./windows/app-window.ts";

export type AppMenuLanguage = "en" | "zh-CN";

interface MenuText {
  about: (appName: string) => string;
  bringAllToFront: string;
  commandPalette: string;
  copy: string;
  cut: string;
  delete: string;
  devTools: string;
  edit: string;
  file: string;
  find: string;
  forceReload: string;
  hide: (appName: string) => string;
  hideOthers: string;
  minimize: string;
  newTerminal: string;
  newWindow: string;
  paste: string;
  pasteAndMatchStyle: string;
  quit: (appName: string) => string;
  redo: string;
  reload: string;
  resetZoom: string;
  selectAll: string;
  services: string;
  settings: string;
  toggleFullscreen: string;
  undo: string;
  unhide: string;
  view: string;
  window: string;
  zoom: string;
  zoomIn: string;
  zoomOut: string;
}

const MENU_TEXT: Record<AppMenuLanguage, MenuText> = {
  en: {
    about: (appName) => `About ${appName}`,
    bringAllToFront: "Bring All to Front",
    commandPalette: "Command Palette",
    copy: "Copy",
    cut: "Cut",
    delete: "Delete",
    devTools: "Developer Tools",
    edit: "Edit",
    file: "File",
    find: "Find",
    forceReload: "Force Reload",
    hide: (appName) => `Hide ${appName}`,
    hideOthers: "Hide Others",
    minimize: "Minimize",
    newTerminal: "New Terminal",
    newWindow: "New Window",
    paste: "Paste",
    pasteAndMatchStyle: "Paste and Match Style",
    quit: (appName) => `Quit ${appName}`,
    redo: "Redo",
    reload: "Reload",
    resetZoom: "Reset Zoom",
    selectAll: "Select All",
    services: "Services",
    settings: "Settings...",
    toggleFullscreen: "Toggle Full Screen",
    undo: "Undo",
    unhide: "Show All",
    view: "View",
    window: "Window",
    zoom: "Zoom",
    zoomIn: "Zoom In",
    zoomOut: "Zoom Out",
  },
  "zh-CN": {
    about: (appName) => `关于 ${appName}`,
    bringAllToFront: "全部置于最前",
    commandPalette: "命令面板",
    copy: "复制",
    cut: "剪切",
    delete: "删除",
    devTools: "开发者工具",
    edit: "编辑",
    file: "文件",
    find: "查找",
    forceReload: "强制重新加载",
    hide: (appName) => `隐藏 ${appName}`,
    hideOthers: "隐藏其他",
    minimize: "最小化",
    newTerminal: "新建终端",
    newWindow: "新建窗口",
    paste: "粘贴",
    pasteAndMatchStyle: "粘贴并匹配样式",
    quit: (appName) => `退出 ${appName}`,
    redo: "重做",
    reload: "重新加载",
    resetZoom: "重置缩放",
    selectAll: "全选",
    services: "服务",
    settings: "设置...",
    toggleFullscreen: "切换全屏",
    undo: "撤销",
    unhide: "全部显示",
    view: "视图",
    window: "窗口",
    zoom: "缩放",
    zoomIn: "放大",
    zoomOut: "缩小",
  },
};

export function resolveAppMenuLanguage(
  language: ProjectPreferences["language"],
  getSystemLocale: () => string
): AppMenuLanguage {
  if (language === "zh-CN" || language === "en") {
    return language;
  }

  const normalized = getSystemLocale().toLowerCase();
  if (normalized === "zh-cn" || normalized.startsWith("zh-hans")) {
    return "zh-CN";
  }
  return "en";
}

export interface BuildAppMenuTemplateArgs {
  appName: string;
  getTargetWindow: () => AppWindow | null;
  isDev: boolean;
  isMac?: boolean;
  language: AppMenuLanguage;
  onFindInTerminal: (target: AppWindow | null) => void;
  onNewTerminal: (target: AppWindow | null) => void;
  onNewWindow: () => void;
  onOpenCommandPalette: (target: AppWindow | null) => void;
  onResetZoom: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  userKeymap?: ProjectPreferences["userKeymap"];
}

function separator(): MenuItemConstructorOptions {
  return { type: "separator" };
}

function appCommandMenuItem(
  commandId: string,
  label: string,
  click: () => void,
  userKeymap: ProjectPreferences["userKeymap"]
): MenuItemConstructorOptions {
  const accelerator = firstAcceleratorForCommand(commandId, userKeymap);
  return {
    ...(accelerator ? { accelerator } : {}),
    click,
    label,
  };
}

export function buildAppMenuTemplate({
  appName,
  getTargetWindow,
  isDev,
  isMac = true,
  language,
  onFindInTerminal,
  onNewTerminal,
  onNewWindow,
  onOpenCommandPalette,
  onResetZoom,
  onZoomIn,
  onZoomOut,
  userKeymap = [],
}: BuildAppMenuTemplateArgs): MenuItemConstructorOptions[] {
  const t = MENU_TEXT[language];
  const newWindowMenuItem: MenuItemConstructorOptions = {
    click: () => onNewWindow(),
    label: t.newWindow,
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: t.file,
    submenu: [
      newWindowMenuItem,
      {
        click: () => onNewTerminal(getTargetWindow()),
        label: t.newTerminal,
      },
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: t.edit,
    submenu: [
      { label: t.undo, role: "undo" },
      { label: t.redo, role: "redo" },
      separator(),
      { label: t.cut, role: "cut" },
      { label: t.copy, role: "copy" },
      { label: t.paste, role: "paste" },
      ...(isMac
        ? ([
            { label: t.pasteAndMatchStyle, role: "pasteAndMatchStyle" },
            { label: t.delete, role: "delete" },
            { label: t.selectAll, role: "selectAll" },
          ] satisfies MenuItemConstructorOptions[])
        : ([
            { label: t.delete, role: "delete" },
            separator(),
            { label: t.selectAll, role: "selectAll" },
          ] satisfies MenuItemConstructorOptions[])),
      separator(),
      appCommandMenuItem(
        "pier.terminal.search",
        t.find,
        () => onFindInTerminal(getTargetWindow()),
        userKeymap
      ),
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: t.view,
    submenu: [
      {
        click: () => onOpenCommandPalette(getTargetWindow()),
        label: t.commandPalette,
      },
      ...(isDev
        ? ([
            separator(),
            { label: t.reload, role: "reload" },
            { label: t.forceReload, role: "forceReload" },
            createDetachedDevToolsMenuItem(() => getTargetWindow(), t.devTools),
          ] satisfies MenuItemConstructorOptions[])
        : []),
      separator(),
      appCommandMenuItem(
        "pier.view.resetZoom",
        t.resetZoom,
        onResetZoom,
        userKeymap
      ),
      appCommandMenuItem("pier.view.zoomIn", t.zoomIn, onZoomIn, userKeymap),
      appCommandMenuItem("pier.view.zoomOut", t.zoomOut, onZoomOut, userKeymap),
      separator(),
      { label: t.toggleFullscreen, role: "togglefullscreen" },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: t.window,
    submenu: isMac
      ? [
          newWindowMenuItem,
          separator(),
          { label: t.minimize, role: "minimize" },
          { label: t.zoom, role: "zoom" },
          separator(),
          { label: t.bringAllToFront, role: "front" },
          separator(),
          { label: t.window, role: "window" },
        ]
      : [
          newWindowMenuItem,
          separator(),
          { label: t.minimize, role: "minimize" },
          { label: t.zoom, role: "zoom" },
          { role: "close" },
        ],
  };

  const macAppMenu: MenuItemConstructorOptions = {
    label: appName,
    submenu: [
      { label: t.about(appName), role: "about" },
      createOpenSettingsMenuItem(getTargetWindow, t.settings),
      separator(),
      { label: t.services, role: "services" },
      separator(),
      { label: t.hide(appName), role: "hide" },
      { label: t.hideOthers, role: "hideOthers" },
      { label: t.unhide, role: "unhide" },
      separator(),
      { label: t.quit(appName), role: "quit" },
    ],
  };

  return [
    ...(isMac ? [macAppMenu] : []),
    fileMenu,
    editMenu,
    viewMenu,
    windowMenu,
  ];
}

export interface InstallAppMenuArgs
  extends Omit<BuildAppMenuTemplateArgs, "language"> {
  eventBus: {
    subscribe(listener: (event: PierEvent) => void): () => void;
  };
  getSystemLocale: () => string;
  readPreferences: () => Promise<
    Pick<ProjectPreferences, "language" | "userKeymap">
  >;
}

export async function installAppMenu({
  eventBus,
  getSystemLocale,
  readPreferences,
  ...menuArgs
}: InstallAppMenuArgs): Promise<() => void> {
  const applyMenu = (
    preferences: Pick<ProjectPreferences, "language" | "userKeymap">
  ) => {
    const language = resolveAppMenuLanguage(
      preferences.language,
      getSystemLocale
    );
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(
        buildAppMenuTemplate({
          ...menuArgs,
          language,
          userKeymap: preferences.userKeymap,
        })
      )
    );
  };

  const preferences = await readPreferences();
  applyMenu(preferences);

  return eventBus.subscribe((event) => {
    if (event.type === "preferences.changed") {
      applyMenu(event.snapshot);
    }
  });
}
