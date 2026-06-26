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
    expect(resolveAppMenuLanguage("system", () => "fr-FR")).toBe("en");
  });

  it("builds a Chinese production menu without development actions", () => {
    const template = buildAppMenuTemplate({
      appName: "Pier",
      getTargetWindow: () => null,
      isDev: false,
      language: "zh-CN",
      onNewTerminal: vi.fn(),
      onNewWindow: vi.fn(),
      onOpenCommandPalette: vi.fn(),
    });

    expect(labels(template)).toEqual(["Pier", "文件", "编辑", "视图", "窗口"]);
    expect(labels(submenu(itemAt(template, 1)))).toContain("新建窗口");
    expect(labels(submenu(itemAt(template, 1)))).toContain("新建终端");
    expect(labels(submenu(itemAt(template, 3)))).toContain("命令面板");
    expect(labels(submenu(itemAt(template, 3)))).not.toContain("重新加载");
    expect(labels(submenu(itemAt(template, 3)))).not.toContain("强制重新加载");
    expect(labels(submenu(itemAt(template, 3)))).not.toContain("开发者工具");
  });

  it("builds an English development menu with development actions", () => {
    const template = buildAppMenuTemplate({
      appName: "Pier",
      getTargetWindow: () => null,
      isDev: true,
      language: "en",
      onNewTerminal: vi.fn(),
      onNewWindow: vi.fn(),
      onOpenCommandPalette: vi.fn(),
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

  it("runs the core menu actions against the target window", () => {
    const send = vi.fn();
    const win = {
      webContents: { send },
    };
    const onNewWindow = vi.fn();
    const onNewTerminal = vi.fn();
    const template = buildAppMenuTemplate({
      appName: "Pier",
      getTargetWindow: () => win as never,
      isDev: false,
      language: "en",
      onNewTerminal,
      onNewWindow,
      onOpenCommandPalette: (target) => {
        target?.webContents.send(PIER_BROADCAST.COMMAND_PALETTE_TOGGLE_REQUEST);
      },
    });

    const fileMenu = submenu(itemAt(template, 1));
    fileMenu
      .find((item) => item.label === "New Window")
      ?.click?.(undefined as never, undefined as never, undefined as never);
    fileMenu
      .find((item) => item.label === "New Terminal")
      ?.click?.(undefined as never, undefined as never, undefined as never);
    submenu(itemAt(template, 3))
      .find((item) => item.label === "Command Palette")
      ?.click?.(undefined as never, undefined as never, undefined as never);

    expect(onNewWindow).toHaveBeenCalledOnce();
    expect(onNewTerminal).toHaveBeenCalledWith(win);
    expect(send).toHaveBeenCalledWith(
      PIER_BROADCAST.COMMAND_PALETTE_TOGGLE_REQUEST
    );
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
      onNewTerminal: vi.fn(),
      onNewWindow: vi.fn(),
      onOpenCommandPalette: vi.fn(),
      readPreferences,
    });

    const listener = subscribe.mock.calls[0]?.[0] as (event: unknown) => void;
    listener({
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
