// tests/unit/renderer/lib/context-menu/build-entries.test.ts
//
// Test isolation 策略: actionRegistry 是单例无 clear() — 每个用例用 **唯一 surface
// 字符串** (test/empty, test/single, ...) 让 list(surface) 只返回本用例的 actions.
// 测试间 register 残留不互相影响.
import { beforeEach, describe, expect, it } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";
import { buildMenuEntries } from "@/lib/context-menu/build-entries.ts";
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
});
