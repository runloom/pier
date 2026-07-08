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
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import { useTerminalStatusBarPrefsStore } from "@/stores/terminal-status-bar-prefs.store.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

const { declaredRows, openTerminalStatusBarContextMenu } = await import(
  "@/panel-kits/terminal/terminal-status-bar-menu.ts"
);

function terminalStatusItemEntry(
  id: string,
  items: Array<{
    id: string;
    order?: number;
    title: string;
  }>,
  enabled = true,
  runtimeEnabled: boolean = enabled
): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      missionControlWidgets: [],
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
    runtime: { canToggle: true, enabled: runtimeEnabled, kind: "builtin" },
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

  it("core 声明源的项出现在 rows 里,title 走 i18next.t(titleKey)", () => {
    const rows = declaredRows([], prefsOf(), [
      {
        id: "core.foo",
        titleKey: "terminal.statusBar.item.agentStatus.title", // 复用已翻译 key(Task 6 添加)
      },
    ]);

    expect(rows.map((row) => row.itemId)).toContain("core.foo");
  });

  it("同 id 时 core 优先,plugin 声明被跳过", () => {
    const rows = declaredRows(
      [
        terminalStatusItemEntry(
          "pier.a",
          [{ id: "core.foo", title: "Plugin Steal" }],
          true
        ),
      ],
      prefsOf(),
      [
        {
          id: "core.foo",
          titleKey: "terminal.statusBar.item.agentStatus.title",
        },
      ]
    );

    const fooRows = rows.filter((row) => row.itemId === "core.foo");
    expect(fooRows).toHaveLength(1);
    // core 走 i18next.t,plugin 走 resolvePluginTerminalStatusItemDisplay;
    // core 优先意味着 title 精确等于 titleKey 翻译结果,而非 "Plugin Steal"
    expect(fooRows[0]?.title).toBe("Agent status");
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
      prefsOf(),
      []
    );

    expect(rows.map((row) => row.itemId)).toEqual(["enabled.item"]);
  });

  it("F12:口径以 runtime.enabled 为准 —— 顶层 enabled=false 但 runtime.enabled=true 时仍纳入", () => {
    const rows = declaredRows(
      [
        terminalStatusItemEntry(
          "pier.drift",
          [{ id: "drift.item", title: "Drift Item" }],
          /* enabled */ false,
          /* runtimeEnabled */ true
        ),
      ],
      prefsOf(),
      []
    );

    expect(rows.map((row) => row.itemId)).toEqual(["drift.item"]);
  });

  it("F12:顶层 enabled=true 但 runtime.enabled=false 时被排除", () => {
    const rows = declaredRows(
      [
        terminalStatusItemEntry(
          "pier.drift",
          [{ id: "drift.item", title: "Drift Item" }],
          /* enabled */ true,
          /* runtimeEnabled */ false
        ),
      ],
      prefsOf(),
      []
    );

    expect(rows).toEqual([]);
  });

  it("按 title 字典序排序,与声明顺序无关", () => {
    const rows = declaredRows(
      [
        terminalStatusItemEntry("pier.a", [
          { id: "z.item", title: "Zebra" },
          { id: "a.item", title: "Apple" },
        ]),
      ],
      prefsOf(),
      []
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
      prefsOf({ "hidden.override": { hidden: true } }),
      []
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
    toastError.mockClear();
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

  it("已隐藏项再点击 → patchItemOverride 收到 { hidden: null } 并原样透传给 main(F7:不再本地合成判断清空)", async () => {
    popupMock.mockImplementation((template: readonly MenuItem[]) => {
      const rows = checkboxItems(template);
      const hiddenRow = rows.find((item) => item.id.endsWith("hidden.item"));
      return Promise.resolve({ actionId: hiddenRow?.id ?? null });
    });

    await openTerminalStatusBarContextMenu(fakeMouseEvent());

    // F7:renderer 不再读自身 prefs 判断合成后是否为空 —— { hidden: null } 原样
    // 经 setItemOverride(patch) 传给 main,由 main 侧 withItemOverridePatch 合成
    // 并在结果为空时删除该 key(见 src/main/state/terminal-status-bar-prefs.ts)。
    expect(setItemOverride).toHaveBeenCalledWith("hidden.item", {
      hidden: null,
    });
    expect(resetItem).not.toHaveBeenCalled();
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

  it("F9:显隐切换 IPC 失败时 toast 报错(不吞错误)", async () => {
    setItemOverride.mockImplementationOnce(() =>
      Promise.reject(new Error("menu toggle boom"))
    );
    popupMock.mockImplementation((template: readonly MenuItem[]) => {
      const rows = checkboxItems(template);
      const visibleRow = rows.find((item) => item.id.endsWith("visible.item"));
      return Promise.resolve({ actionId: visibleRow?.id ?? null });
    });

    await openTerminalStatusBarContextMenu(fakeMouseEvent());

    expect(toastError).toHaveBeenCalledWith(
      "Failed to update status bar item",
      expect.objectContaining({ description: "menu toggle boom" })
    );
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
