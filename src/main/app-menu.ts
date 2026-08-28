import type { PierEvent } from "@shared/contracts/events.ts";
import type { ProjectPreferences } from "@shared/contracts/preferences.ts";
import {
  APP_MENU_TEXT,
  type AppMenuLanguage,
  resolveAppMenuLanguage as resolveMenuLanguage,
} from "@shared/i18n/app-menu.ts";
import { firstAcceleratorForCommand } from "@shared/keybindings.ts";
import { Menu, type MenuItemConstructorOptions } from "electron";
import { createDetachedDevToolsMenuItem } from "./devtools.ts";
import { createOpenSettingsMenuItem } from "./settings-menu.ts";
import type { AppWindow } from "./windows/app-window.ts";

export {
  type AppMenuLanguage,
  resolveAppMenuLanguage,
} from "@shared/i18n/app-menu.ts";

export interface BuildAppMenuTemplateArgs {
  appName: string;
  getTargetWindow: () => AppWindow | null;
  isDev: boolean;
  isMac?: boolean;
  language: AppMenuLanguage;
  onMenuCommand: (target: AppWindow | null, commandId: string) => void;
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
  onMenuCommand,
  onNewTerminal,
  onNewWindow,
  onOpenCommandPalette,
  onResetZoom,
  onZoomIn,
  onZoomOut,
  userKeymap = [],
}: BuildAppMenuTemplateArgs): MenuItemConstructorOptions[] {
  const t = APP_MENU_TEXT[language];
  const cmd = (commandId: string, label: string): MenuItemConstructorOptions =>
    appCommandMenuItem(
      commandId,
      label,
      () => onMenuCommand(getTargetWindow(), commandId),
      userKeymap
    );
  const newWindowMenuItem: MenuItemConstructorOptions = {
    click: () => onNewWindow(),
    label: t.newWindow,
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: t.file,
    submenu: [
      newWindowMenuItem,
      appCommandMenuItem(
        "pier.panel.newTerminal",
        t.newTerminal,
        () => onNewTerminal(getTargetWindow()),
        userKeymap
      ),
      cmd("pier.panel.closeActive", t.closePanel),
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
      cmd("pier.find", t.find),
      cmd("pier.findNext", t.findNext),
      cmd("pier.findPrev", t.findPrevious),
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: t.view,
    submenu: [
      appCommandMenuItem(
        "pier.commandPalette.toggle",
        t.commandPalette,
        () => onOpenCommandPalette(getTargetWindow()),
        userKeymap
      ),
      cmd("pier.files.searchContents", t.searchInFiles),
      separator(),
      cmd("pier.view.toggleSideTree", t.toggleSideTree),
      cmd("pier.agents.list", t.listAgents),
      cmd("pier.agents.focusWaiting", t.focusWaiting),
      ...(isDev
        ? ([
            separator(),
            { label: t.reload, role: "reload" },
            { label: t.forceReload, role: "forceReload" },
          ] satisfies MenuItemConstructorOptions[])
        : []),
      separator(),
      createDetachedDevToolsMenuItem(() => getTargetWindow(), t.devTools),
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

  const windowLayoutItems: MenuItemConstructorOptions[] = [
    cmd("pier.panel.focusNextTab", t.nextTab),
    cmd("pier.panel.focusPrevTab", t.prevTab),
    separator(),
    cmd("pier.panel.splitRight", t.splitRight),
    cmd("pier.panel.splitDown", t.splitDown),
    separator(),
    cmd("pier.panel.focusUp", t.focusUp),
    cmd("pier.panel.focusDown", t.focusDown),
    cmd("pier.panel.focusLeft", t.focusLeft),
    cmd("pier.panel.focusRight", t.focusRight),
  ];

  const windowMenu: MenuItemConstructorOptions = {
    label: t.window,
    submenu: isMac
      ? [
          newWindowMenuItem,
          separator(),
          ...windowLayoutItems,
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
          ...windowLayoutItems,
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
    const language = resolveMenuLanguage(preferences.language, getSystemLocale);
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
