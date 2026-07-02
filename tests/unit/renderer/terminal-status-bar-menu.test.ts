import type {
  MenuItem,
  MenuPopupOptions,
  MenuPopupResult,
  MenuTemplate,
} from "@shared/contracts/menu.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import type { TerminalStatusBarPrefs } from "@shared/contracts/terminal-status-bar.ts";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { initI18n } from "@/i18n/index.ts";
import {
  declaredRows,
  openTerminalStatusBarContextMenu,
} from "@/panel-kits/terminal/terminal-status-bar-menu.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import { useTerminalStatusBarPrefsStore } from "@/stores/terminal-status-bar-prefs.store.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";

function terminalStatusItemEntry(
  id: string,
  items: Array<{
    id: string;
    order?: number;
    title: string;
  }>,
  enabled = true
): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      engines: { pier: ">=0.1.0" },
      id,
      name: id,
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: items.map((item) => ({
        id: item.id,
        order: item.order,
        permissions: [],
        title: item.title,
      })),
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled, kind: "builtin" },
  };
}

function prefsOf(
  items: TerminalStatusBarPrefs["items"] = {}
): TerminalStatusBarPrefs {
  return { items, version: 1 };
}

function fakeMouseEvent(): ReactMouseEvent {
  return {
    clientX: 10,
    clientY: 20,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as ReactMouseEvent;
}

describe("declaredRows", () => {
  beforeAll(async () => {
    await initI18n();
  });

  it("过滤 disabled 插件贡献的项", () => {
    const rows = declaredRows(
      [
        terminalStatusItemEntry(
          "pier.enabled",
          [{ id: "enabled.item", title: "Enabled Item" }],
          true
        ),
        terminalStatusItemEntry(
          "pier.disabled",
          [{ id: "disabled.item", title: "Disabled Item" }],
          false
        ),
      ],
      prefsOf()
    );

    expect(rows.map((row) => row.itemId)).toEqual(["enabled.item"]);
  });

  it("按 title 字典序排序,与声明顺序无关", () => {
    const rows = declaredRows(
      [
        terminalStatusItemEntry("pier.a", [
          { id: "z.item", title: "Zebra" },
          { id: "a.item", title: "Apple" },
        ]),
      ],
      prefsOf()
    );

    expect(rows.map((row) => row.title)).toEqual(["Apple", "Zebra"]);
  });

  it("hidden 生效值 = 用户覆盖 ?? manifest 声明 ?? 默认可见", () => {
    const rows = declaredRows(
      [
        terminalStatusItemEntry("pier.a", [
          { id: "no.override", title: "No Override" },
          { id: "hidden.override", title: "Hidden Override" },
        ]),
      ],
      prefsOf({ "hidden.override": { hidden: true } })
    );

    const byId = new Map(rows.map((row) => [row.itemId, row.hidden]));
    expect(byId.get("no.override")).toBe(false);
    expect(byId.get("hidden.override")).toBe(true);
  });
});

describe("openTerminalStatusBarContextMenu", () => {
  const popupMock = vi.fn(
    (
      _template: MenuTemplate,
      _options?: MenuPopupOptions
    ): Promise<MenuPopupResult> => Promise.resolve({ actionId: null })
  );
  const setItemOverride = vi.fn(
    (itemId: string, override: TerminalStatusBarPrefs["items"][string]) =>
      Promise.resolve(prefsOf({ [itemId]: override }))
  );
  const resetItem = vi.fn((_itemId: string) => Promise.resolve(prefsOf({})));

  beforeAll(async () => {
    await initI18n();
  });

  beforeEach(() => {
    popupMock.mockReset();
    popupMock.mockImplementation(async () => ({ actionId: null }));
    setItemOverride.mockClear();
    resetItem.mockClear();
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        menu: { popup: popupMock },
        terminalStatusBarPrefs: { resetItem, setItemOverride },
      },
    });
    useZoomStore.setState({ windowZoomLevel: 0 });
    usePluginRegistryStore.setState({
      diagnostics: [],
      error: null,
      initialized: true,
      plugins: [
        terminalStatusItemEntry("pier.a", [
          { id: "visible.item", title: "Visible Item" },
          { id: "hidden.item", title: "Hidden Item" },
        ]),
      ],
    });
    useTerminalStatusBarPrefsStore.setState({
      error: null,
      initialized: true,
      prefs: prefsOf({ "hidden.item": { hidden: true } }),
    });
    useSettingsDialogStore.setState({
      activeSection: "appearance",
      isOpen: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function checkboxItems(template: readonly MenuItem[]) {
    return template.filter(
      (item): item is Extract<MenuItem, { type: "checkbox" }> =>
        item.type === "checkbox"
    );
  }

  it("已隐藏项再点击 → setItemOverride 收到 { hidden: null } 语义的清覆盖(改走 resetItem)", async () => {
    popupMock.mockImplementation((template: readonly MenuItem[]) => {
      const rows = checkboxItems(template);
      const hiddenRow = rows.find((item) => item.id.endsWith("hidden.item"));
      return Promise.resolve({ actionId: hiddenRow?.id ?? null });
    });

    await openTerminalStatusBarContextMenu(fakeMouseEvent());

    // patchItemOverride({ hidden: null }) 与已有覆盖({ hidden: true })合成后
    // 字段全清空 → withItemOverridePatch 返回 null → 落 resetItem(见
    // terminal-status-bar-prefs.store.ts patchItemOverride 实现)。
    expect(resetItem).toHaveBeenCalledWith("hidden.item");
    expect(setItemOverride).not.toHaveBeenCalled();
  });

  it("可见项点击 → setItemOverride(itemId, { hidden: true })", async () => {
    popupMock.mockImplementation((template: readonly MenuItem[]) => {
      const rows = checkboxItems(template);
      const visibleRow = rows.find((item) => item.id.endsWith("visible.item"));
      return Promise.resolve({ actionId: visibleRow?.id ?? null });
    });

    await openTerminalStatusBarContextMenu(fakeMouseEvent());

    expect(setItemOverride).toHaveBeenCalledWith("visible.item", {
      hidden: true,
    });
    expect(resetItem).not.toHaveBeenCalled();
  });

  it("勾选项 checked 态反映当前 hidden 生效值(取反)", async () => {
    let capturedTemplate: readonly MenuItem[] = [];
    popupMock.mockImplementation((template: readonly MenuItem[]) => {
      capturedTemplate = template;
      return Promise.resolve({ actionId: null });
    });

    await openTerminalStatusBarContextMenu(fakeMouseEvent());

    const rows = checkboxItems(capturedTemplate);
    const visibleRow = rows.find((item) => item.id.endsWith("visible.item"));
    const hiddenRow = rows.find((item) => item.id.endsWith("hidden.item"));
    expect(visibleRow?.checked).toBe(true);
    expect(hiddenRow?.checked).toBe(false);
  });

  it("「管理状态栏…」actionId → openSection('terminal') 被调用", async () => {
    popupMock.mockImplementation((template: readonly MenuItem[]) => {
      const manageItem = template.find(
        (item) => item.type === "action" && item.id.includes("manage")
      );
      if (manageItem?.type !== "action") {
        throw new Error("manage action item missing from template");
      }
      return Promise.resolve({ actionId: manageItem.id });
    });

    await openTerminalStatusBarContextMenu(fakeMouseEvent());

    expect(useSettingsDialogStore.getState().activeSection).toBe("terminal");
    expect(useSettingsDialogStore.getState().isOpen).toBe(true);
    expect(setItemOverride).not.toHaveBeenCalled();
    expect(resetItem).not.toHaveBeenCalled();
  });

  it("actionId 为 null(Esc / 点击外部)时不触发任何 patch 或 openSection", async () => {
    await openTerminalStatusBarContextMenu(fakeMouseEvent());

    expect(setItemOverride).not.toHaveBeenCalled();
    expect(resetItem).not.toHaveBeenCalled();
    expect(useSettingsDialogStore.getState().isOpen).toBe(false);
  });
});
