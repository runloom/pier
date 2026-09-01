// tests/unit/renderer/lib/context-menu/build-entries.test.ts
//
// Test isolation 策略: actionRegistry 是单例无 clear() — 每个用例用 **唯一 surface
// 字符串** (test/empty, test/single, ...) 让 list(surface) 只返回本用例的 actions.
// 测试间 register 残留不互相影响.
import { beforeEach, describe, expect, it } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";
import {
  buildMenuEntries,
  expandContextMenuSurfaces,
  PANEL_CONTENT_SURFACE,
  PANEL_EDIT_SURFACE,
  PANEL_LAYOUT_SURFACE,
} from "@/lib/context-menu/build-entries.ts";
import { keybindingRegistry } from "@/lib/keybindings/registry.ts";

describe("buildMenuEntries", () => {
  beforeEach(() => actionRegistry.clearForTests());

  it("空 surface 返回空数组", () => {
    expect(buildMenuEntries("test/empty")).toEqual([]);
  });

  it("单 group 内按 sortOrder 升序, 无 separator", () => {
    actionRegistry.register({
      id: "t.a",
      category: "T",
      title: () => "A",
      surfaces: ["test/single"],
      metadata: { group: "1_x", sortOrder: 2 },
      handler: () => undefined,
    });
    actionRegistry.register({
      id: "t.b",
      category: "T",
      title: () => "B",
      surfaces: ["test/single"],
      metadata: { group: "1_x", sortOrder: 1 },
      handler: () => undefined,
    });
    const entries = buildMenuEntries("test/single");
    expect(entries.map((e) => (e.type === "action" ? e.id : e.type))).toEqual([
      "t.b",
      "t.a",
    ]);
  });

  it("不同 group 之间插 separator (group 字典序)", () => {
    actionRegistry.register({
      id: "t.first",
      category: "T",
      title: () => "First",
      surfaces: ["test/two-groups"],
      metadata: { group: "1_a" },
      handler: () => undefined,
    });
    actionRegistry.register({
      id: "t.second",
      category: "T",
      title: () => "Second",
      surfaces: ["test/two-groups"],
      metadata: { group: "9_z" },
      handler: () => undefined,
    });
    const entries = buildMenuEntries("test/two-groups");
    expect(entries.map((e) => e.type)).toEqual([
      "action",
      "separator",
      "action",
    ]);
  });

  it("无 group 视作 9_other (落到中后段)", () => {
    actionRegistry.register({
      id: "t.no-group",
      category: "T",
      title: () => "NoGroup",
      surfaces: ["test/no-group"],
      handler: () => undefined,
    });
    actionRegistry.register({
      id: "t.first",
      category: "T",
      title: () => "First",
      surfaces: ["test/no-group"],
      metadata: { group: "1_first" },
      handler: () => undefined,
    });
    actionRegistry.register({
      id: "t.last",
      category: "T",
      title: () => "Last",
      surfaces: ["test/no-group"],
      metadata: { group: "z_last" },
      handler: () => undefined,
    });
    const entries = buildMenuEntries("test/no-group");
    const ids = entries
      .filter((e) => e.type === "action")
      .map((e) => (e.type === "action" ? e.id : ""));
    expect(ids).toEqual(["t.first", "t.no-group", "t.last"]);
  });

  it("metadata.menuHidden() 为 true 的 action 整行移除 (含空 group 不留 separator)", () => {
    actionRegistry.register({
      id: "t.visible",
      category: "T",
      title: () => "Visible",
      surfaces: ["test/hidden"],
      metadata: { group: "1_a" },
      handler: () => undefined,
    });
    actionRegistry.register({
      id: "t.hidden",
      category: "T",
      title: () => "Hidden",
      surfaces: ["test/hidden"],
      metadata: { group: "9_z", menuHidden: () => true },
      handler: () => undefined,
    });
    const entries = buildMenuEntries("test/hidden");
    expect(entries.map((e) => (e.type === "action" ? e.id : e.type))).toEqual([
      "t.visible",
    ]);
  });

  it("enabled() 函数结果写到 entry.enabled", () => {
    actionRegistry.register({
      id: "t.disabled",
      category: "T",
      title: () => "Disabled",
      surfaces: ["test/enabled"],
      enabled: () => false,
      handler: () => undefined,
    });
    const entries = buildMenuEntries("test/enabled");
    expect(entries[0]).toMatchObject({ type: "action", enabled: false });
  });

  it("有 keybinding 时反查 accelerator (Electron 格式)", () => {
    actionRegistry.register({
      id: "t.with-key",
      category: "T",
      title: () => "WithKey",
      surfaces: ["test/key"],
      handler: () => undefined,
    });
    keybindingRegistry.registerDefaults([
      { commandId: "t.with-key", keys: "Mod+KeyK", scope: "global" },
    ]);
    const entries = buildMenuEntries("test/key");
    const first = entries[0];
    const accelerator =
      first?.type === "action" ? first.accelerator : undefined;
    expect(accelerator).toBe("CmdOrCtrl+K");
  });

  it("支持从指定 commandId 反查菜单 accelerator", () => {
    actionRegistry.register({
      id: "t.menu-close",
      category: "T",
      title: () => "Close",
      surfaces: ["test/shortcut-source"],
      metadata: { shortcutSourceId: "t.close-active" },
      handler: () => undefined,
    });
    keybindingRegistry.registerDefaults([
      { commandId: "t.close-active", keys: "Mod+KeyW", scope: "global" },
    ]);

    const entries = buildMenuEntries("test/shortcut-source");
    const first = entries[0];
    const accelerator =
      first?.type === "action" ? first.accelerator : undefined;

    expect(accelerator).toBe("CmdOrCtrl+W");
  });

  it("displayChord 在没有真实绑定时只作为菜单提示", () => {
    actionRegistry.register({
      id: "t.native-copy",
      category: "T",
      title: () => "Copy",
      surfaces: ["test/display-chord"],
      metadata: { displayChord: "Mod+KeyC" },
      handler: () => undefined,
    });

    const entries = buildMenuEntries("test/display-chord");
    const first = entries[0];
    const accelerator =
      first?.type === "action" ? first.accelerator : undefined;
    expect(accelerator).toBe("CmdOrCtrl+C");
  });

  it("shortcutSourceId 可按 invocation 决定是否借用", () => {
    actionRegistry.register({
      id: "t.tab-copy-path",
      category: "T",
      title: () => "Copy Path",
      surfaces: ["test/dynamic-source"],
      metadata: {
        shortcutSourceId: (invocation) =>
          invocation?.metadata?.disk === true ? "t.files-copy-path" : undefined,
      },
      handler: () => undefined,
    });
    keybindingRegistry.registerDefaults([
      {
        commandId: "t.files-copy-path",
        keys: "Mod+Alt+KeyC",
        scope: "global",
      },
    ]);

    const withDisk = buildMenuEntries("test/dynamic-source", {
      metadata: { disk: true },
    });
    const withoutDisk = buildMenuEntries("test/dynamic-source", {
      metadata: { disk: false },
    });
    const diskItem = withDisk[0];
    const otherItem = withoutDisk[0];
    expect(diskItem?.type === "action" ? diskItem.accelerator : undefined).toBe(
      "CmdOrCtrl+Alt+C"
    );
    expect(
      otherItem?.type === "action" ? otherItem.accelerator : undefined
    ).toBeUndefined();
  });

  it("viewport surface 按能力表并入 panel/edit 与 panel/layout", () => {
    actionRegistry.register({
      category: "T",
      handler: () => undefined,
      id: "t.local",
      metadata: { group: "0_edit", sortOrder: 1 },
      surfaces: ["terminal/content"],
      title: () => "local",
    });
    actionRegistry.register({
      category: "T",
      handler: () => undefined,
      id: "t.shared-layout",
      metadata: { group: "4_layout", sortOrder: 1 },
      surfaces: [PANEL_LAYOUT_SURFACE],
      title: () => "shared",
    });

    expect(expandContextMenuSurfaces("terminal/content")).toEqual([
      "terminal/content",
      PANEL_LAYOUT_SURFACE,
    ]);
    expect(
      buildMenuEntries("terminal/content").map((e) =>
        e.type === "action" ? e.id : e.type
      )
    ).toEqual(["t.local", "separator", "t.shared-layout"]);

    expect(expandContextMenuSurfaces("files/markdown-preview")).toEqual([
      "files/markdown-preview",
      PANEL_EDIT_SURFACE,
    ]);
    expect(expandContextMenuSurfaces("files/canvas-preview")).toEqual([
      "files/canvas-preview",
      PANEL_EDIT_SURFACE,
    ]);
    expect(expandContextMenuSurfaces(PANEL_CONTENT_SURFACE)).toEqual([
      PANEL_CONTENT_SURFACE,
      PANEL_EDIT_SURFACE,
      PANEL_LAYOUT_SURFACE,
    ]);
  });

  it("object / chrome surface 不并入 edit 或 layout", () => {
    actionRegistry.register({
      category: "T",
      handler: () => undefined,
      id: "t.tab-only",
      metadata: { group: "9_close", sortOrder: 1 },
      surfaces: ["dockview-tab"],
      title: () => "close",
    });
    actionRegistry.register({
      category: "T",
      handler: () => undefined,
      id: "t.layout",
      metadata: { group: "4_layout", sortOrder: 1 },
      surfaces: ["panel/layout"],
      title: () => "layout",
    });
    actionRegistry.register({
      category: "T",
      handler: () => undefined,
      id: "t.tree",
      metadata: { group: "1_new", sortOrder: 1 },
      surfaces: ["files/tree-item"],
      title: () => "new",
    });

    expect(expandContextMenuSurfaces("dockview-tab")).toEqual(["dockview-tab"]);
    expect(expandContextMenuSurfaces("command-palette")).toEqual([
      "command-palette",
    ]);
    expect(expandContextMenuSurfaces("files/tree-item")).toEqual([
      "files/tree-item",
    ]);
    expect(expandContextMenuSurfaces("git/review-tree-item")).toEqual([
      "git/review-tree-item",
    ]);
    expect(expandContextMenuSurfaces("unknown/surface")).toEqual([
      "unknown/surface",
    ]);
    expect(
      buildMenuEntries("dockview-tab").map((e) =>
        e.type === "action" ? e.id : e.type
      )
    ).toEqual(["t.tab-only"]);
    expect(
      buildMenuEntries("files/tree-item").map((e) =>
        e.type === "action" ? e.id : e.type
      )
    ).toEqual(["t.tree"]);
  });
});
