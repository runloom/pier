import type { MenuItemConstructorOptions } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => ({
    template,
  })),
  setApplicationMenu: vi.fn(),
}));

vi.mock("electron", () => ({
  Menu: {
    buildFromTemplate: electronMock.buildFromTemplate,
    setApplicationMenu: electronMock.setApplicationMenu,
  },
}));

import {
  buildAppMenuTemplate,
  installAppMenu,
  resolveAppMenuLanguage,
} from "@main/app-menu.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";

function submenu(
  item: MenuItemConstructorOptions
): MenuItemConstructorOptions[] {
  return item.submenu as MenuItemConstructorOptions[];
}

function itemAt(
  items: readonly MenuItemConstructorOptions[],
  index: number
): MenuItemConstructorOptions {
  const item = items[index];
  if (!item) {
    throw new Error(`menu item missing at index ${index}`);
  }
  return item;
}

function labels(items: readonly MenuItemConstructorOptions[]): string[] {
  return items
    .map((item) => item.label)
    .filter((label): label is string => typeof label === "string");
}

describe("app menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves explicit and system menu languages", () => {
    expect(resolveAppMenuLanguage("zh-CN", () => "en-US")).toBe("zh-CN");
    expect(resolveAppMenuLanguage("en", () => "zh-CN")).toBe("en");
    expect(resolveAppMenuLanguage("system", () => "zh-Hans-CN")).toBe("zh-CN");
    expect(resolveAppMenuLanguage("system", () => "zh-TW")).toBe("zh-CN");
    expect(resolveAppMenuLanguage("system", () => "ja-JP")).toBe("ja");
    expect(resolveAppMenuLanguage("system", () => "ko-KR")).toBe("ko");
    expect(resolveAppMenuLanguage("system", () => "fr-FR")).toBe("en");
    expect(resolveAppMenuLanguage("ja", () => "en-US")).toBe("ja");
    expect(resolveAppMenuLanguage("ko", () => "en-US")).toBe("ko");
  });

  it("builds a Chinese production menu without reload, but with DevTools", () => {
    const template = buildAppMenuTemplate({
      appName: "Pier",
      getTargetWindow: () => null,
      isDev: false,
      language: "zh-CN",
      onMenuCommand: vi.fn(),
      onNewTerminal: vi.fn(),
      onNewWindow: vi.fn(),
      onOpenCommandPalette: vi.fn(),
      onResetZoom: vi.fn(),
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
    });

    expect(labels(template)).toEqual(["Pier", "文件", "编辑", "视图", "窗口"]);
    expect(labels(submenu(itemAt(template, 1)))).toContain("新建窗口");
    expect(labels(submenu(itemAt(template, 1)))).toContain("新建终端");
    expect(labels(submenu(itemAt(template, 3)))).toContain("命令面板");
    expect(labels(submenu(itemAt(template, 3)))).not.toContain("重新加载");
    expect(labels(submenu(itemAt(template, 3)))).not.toContain("强制重新加载");
    // Field diagnosis: production also exposes detached DevTools (⌘⌥I).
    expect(labels(submenu(itemAt(template, 3)))).toContain("开发者工具");
  });

  it("builds an English development menu with development actions", () => {
    const template = buildAppMenuTemplate({
      appName: "Pier",
      getTargetWindow: () => null,
      isDev: true,
      language: "en",
      onMenuCommand: vi.fn(),
      onNewTerminal: vi.fn(),
      onNewWindow: vi.fn(),
      onOpenCommandPalette: vi.fn(),
      onResetZoom: vi.fn(),
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
    });

    expect(labels(template)).toEqual([
      "Pier",
      "File",
      "Edit",
      "View",
      "Window",
    ]);
    expect(labels(submenu(itemAt(template, 3)))).toContain("Command Palette");
    expect(labels(submenu(itemAt(template, 3)))).toContain("Reload");
    expect(labels(submenu(itemAt(template, 3)))).toContain("Force Reload");
    expect(labels(submenu(itemAt(template, 3)))).toContain("Developer Tools");
  });

  it("builds Japanese and Korean menus from the shared catalog", () => {
    const japanese = buildAppMenuTemplate({
      appName: "Pier",
      getTargetWindow: () => null,
      isDev: false,
      language: "ja",
      onMenuCommand: vi.fn(),
      onNewTerminal: vi.fn(),
      onNewWindow: vi.fn(),
      onOpenCommandPalette: vi.fn(),
      onResetZoom: vi.fn(),
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
    });
    expect(labels(japanese)).toEqual([
      "Pier",
      "ファイル",
      "編集",
      "表示",
      "ウインドウ",
    ]);
    expect(labels(submenu(itemAt(japanese, 1)))).toContain("新規ターミナル");

    const korean = buildAppMenuTemplate({
      appName: "Pier",
      getTargetWindow: () => null,
      isDev: false,
      language: "ko",
      onMenuCommand: vi.fn(),
      onNewTerminal: vi.fn(),
      onNewWindow: vi.fn(),
      onOpenCommandPalette: vi.fn(),
      onResetZoom: vi.fn(),
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
    });
    expect(labels(korean)).toEqual(["Pier", "파일", "편집", "보기", "윈도우"]);
    expect(labels(submenu(itemAt(korean, 1)))).toContain("새 터미널");
  });

  it("runs the core menu actions against the target window", () => {
    const send = vi.fn();
    const win = {
      webContents: { send },
    };
    const onNewWindow = vi.fn();
    const onNewTerminal = vi.fn();
    const onResetZoom = vi.fn();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onMenuCommand = vi.fn();
    const template = buildAppMenuTemplate({
      appName: "Pier",
      getTargetWindow: () => win as never,
      isDev: false,
      language: "en",
      onMenuCommand,
      onNewTerminal,
      onNewWindow,
      onOpenCommandPalette: (target) => {
        target?.webContents.send(PIER_BROADCAST.COMMAND_PALETTE_TOGGLE_REQUEST);
      },
      onResetZoom,
      onZoomIn,
      onZoomOut,
    });

    const fileMenu = submenu(itemAt(template, 1));
    expect(
      fileMenu.find((item) => item.label === "New Terminal")
    ).toMatchObject({ accelerator: "CmdOrCtrl+T" });
    expect(
      submenu(itemAt(template, 3)).find(
        (item) => item.label === "Command Palette"
      )
    ).toMatchObject({ accelerator: "CmdOrCtrl+Shift+P" });
    fileMenu
      .find((item) => item.label === "New Window")
      ?.click?.(undefined as never, undefined as never, undefined as never);
    fileMenu
      .find((item) => item.label === "New Terminal")
      ?.click?.(undefined as never, undefined as never, undefined as never);
    submenu(itemAt(template, 3))
      .find((item) => item.label === "Command Palette")
      ?.click?.(undefined as never, undefined as never, undefined as never);
    submenu(itemAt(template, 2))
      .find((item) => item.label === "Find")
      ?.click?.(undefined as never, undefined as never, undefined as never);

    expect(onNewWindow).toHaveBeenCalledOnce();
    expect(onNewTerminal).toHaveBeenCalledWith(win);
    expect(onMenuCommand).toHaveBeenCalledWith(win, "pier.find");
    expect(send).toHaveBeenCalledWith(
      PIER_BROADCAST.COMMAND_PALETTE_TOGGLE_REQUEST
    );
  });

  it("adds a Find menu item with the pier.find accelerator", () => {
    const template = buildAppMenuTemplate({
      appName: "Pier",
      getTargetWindow: () => null,
      isDev: false,
      language: "en",
      onMenuCommand: vi.fn(),
      onNewTerminal: vi.fn(),
      onNewWindow: vi.fn(),
      onOpenCommandPalette: vi.fn(),
      onResetZoom: vi.fn(),
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
    });

    const editMenu = submenu(itemAt(template, 2));
    const find = editMenu.find((item) => item.label === "Find");

    expect(find).toMatchObject({ accelerator: "CmdOrCtrl+F" });
    expect(find).not.toHaveProperty("role");
    expect(editMenu.find((item) => item.label === "Find Next")).toMatchObject({
      accelerator: "CmdOrCtrl+G",
    });
    expect(
      editMenu.find((item) => item.label === "Find Previous")
    ).toMatchObject({
      accelerator: "CmdOrCtrl+Shift+G",
    });
  });

  it("shows split accelerators without registering them globally", () => {
    const template = buildAppMenuTemplate({
      appName: "Pier",
      getTargetWindow: () => null,
      isDev: false,
      language: "en",
      onMenuCommand: vi.fn(),
      onNewTerminal: vi.fn(),
      onNewWindow: vi.fn(),
      onOpenCommandPalette: vi.fn(),
      onResetZoom: vi.fn(),
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
    });

    const windowMenu = submenu(itemAt(template, 4));
    expect(windowMenu.find((item) => item.label === "Split Right")).toEqual(
      expect.objectContaining({
        accelerator: "CmdOrCtrl+D",
        registerAccelerator: false,
      })
    );
    expect(windowMenu.find((item) => item.label === "Split Down")).toEqual(
      expect.objectContaining({
        accelerator: "CmdOrCtrl+Shift+D",
        registerAccelerator: false,
      })
    );
    expect(
      windowMenu.find((item) => item.label === "Next Tab")
    ).not.toHaveProperty("registerAccelerator");

    const viewMenu = submenu(itemAt(template, 3));
    expect(viewMenu.find((item) => item.label === "Agent List")).toEqual(
      expect.objectContaining({
        accelerator: "CmdOrCtrl+Shift+L",
        registerAccelerator: false,
      })
    );
    expect(windowMenu.find((item) => item.label === "Focus Up")).toEqual(
      expect.objectContaining({
        accelerator: "CmdOrCtrl+Alt+Up",
        registerAccelerator: false,
      })
    );
    expect(windowMenu.find((item) => item.label === "Focus Down")).toEqual(
      expect.objectContaining({
        accelerator: "CmdOrCtrl+Alt+Down",
        registerAccelerator: false,
      })
    );
    expect(windowMenu.find((item) => item.label === "Focus Left")).toEqual(
      expect.objectContaining({
        accelerator: "CmdOrCtrl+Alt+Left",
      })
    );
    expect(
      windowMenu.find((item) => item.label === "Focus Left")
    ).not.toHaveProperty("registerAccelerator");
  });

  it("routes zoom menu items through Pier handlers with keymap accelerators", () => {
    const onResetZoom = vi.fn();
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const template = buildAppMenuTemplate({
      appName: "Pier",
      getTargetWindow: () => null,
      isDev: false,
      language: "en",
      onMenuCommand: vi.fn(),
      onNewTerminal: vi.fn(),
      onNewWindow: vi.fn(),
      onOpenCommandPalette: vi.fn(),
      onResetZoom,
      onZoomIn,
      onZoomOut,
    });

    const viewMenu = submenu(itemAt(template, 3));
    const resetZoom = viewMenu.find((item) => item.label === "Reset Zoom");
    const zoomIn = viewMenu.find((item) => item.label === "Zoom In");
    const zoomOut = viewMenu.find((item) => item.label === "Zoom Out");

    expect(resetZoom).toMatchObject({ accelerator: "CmdOrCtrl+0" });
    expect(zoomIn).toMatchObject({ accelerator: "CmdOrCtrl+=" });
    expect(zoomOut).toMatchObject({ accelerator: "CmdOrCtrl+-" });
    expect(resetZoom).not.toHaveProperty("role");
    expect(zoomIn).not.toHaveProperty("role");
    expect(zoomOut).not.toHaveProperty("role");

    resetZoom?.click?.(
      undefined as never,
      undefined as never,
      undefined as never
    );
    zoomIn?.click?.(undefined as never, undefined as never, undefined as never);
    zoomOut?.click?.(
      undefined as never,
      undefined as never,
      undefined as never
    );

    expect(onResetZoom).toHaveBeenCalledOnce();
    expect(onZoomIn).toHaveBeenCalledOnce();
    expect(onZoomOut).toHaveBeenCalledOnce();
  });

  it("rebuilds the application menu when language preferences change", async () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(
      (_listener: (event: unknown) => void) => unsubscribe
    );
    const readPreferences = vi
      .fn()
      .mockResolvedValueOnce({ language: "en" })
      .mockResolvedValueOnce({ language: "zh-CN" });

    await installAppMenu({
      appName: "Pier",
      eventBus: { subscribe },
      getTargetWindow: () => null,
      getSystemLocale: () => "en-US",
      isDev: false,
      onMenuCommand: vi.fn(),
      onNewTerminal: vi.fn(),
      onNewWindow: vi.fn(),
      onOpenCommandPalette: vi.fn(),
      onResetZoom: vi.fn(),
      onZoomIn: vi.fn(),
      onZoomOut: vi.fn(),
      readPreferences,
    });

    const listener = subscribe.mock.calls[0]?.[0] as (event: unknown) => void;
    listener({
      changedKeys: ["language"],
      snapshot: { language: "zh-CN" },
      type: "preferences.changed",
    });

    expect(electronMock.setApplicationMenu).toHaveBeenCalledTimes(2);
    expect(
      labels(
        (electronMock.buildFromTemplate.mock.calls[1]?.[0] ??
          []) as MenuItemConstructorOptions[]
      )
    ).toEqual(["Pier", "文件", "编辑", "视图", "窗口"]);
    unsubscribe();
  });
});
