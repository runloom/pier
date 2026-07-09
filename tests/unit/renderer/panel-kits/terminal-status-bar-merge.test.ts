import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import type {
  CoreTerminalStatusItemDeclaration,
  TerminalStatusBarPrefs,
} from "@shared/contracts/terminal-status-bar.ts";
import { describe, expect, it } from "vitest";
import {
  compareOuterFirst,
  type DeclaredTerminalStatusItem,
  declaredTerminalStatusItemsById,
  mergeTerminalStatusItems,
  normalizedGroupOrders,
  resolveEffectiveTerminalStatusItemConfig,
} from "@/panel-kits/terminal/terminal-status-bar-merge.ts";

interface Item {
  readonly id: string;
}

function items(...ids: string[]): Item[] {
  return ids.map((id) => ({ id }));
}

function declared(
  entries: Record<string, DeclaredTerminalStatusItem>
): ReadonlyMap<string, DeclaredTerminalStatusItem> {
  return new Map(Object.entries(entries));
}

function prefsOf(
  overrides: TerminalStatusBarPrefs["items"] = {}
): TerminalStatusBarPrefs {
  return { items: overrides, version: 1 };
}

function pluginEntry(
  id: string,
  opts: { enabled: boolean; runtimeEnabled: boolean }
): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled: opts.enabled,
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
      terminalStatusItems: [{ id: `${id}.item`, permissions: [], title: id }],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled: opts.runtimeEnabled, kind: "builtin" },
  };
}

describe("resolveEffectiveTerminalStatusItemConfig", () => {
  it("默认值:left / 0 / 可见", () => {
    expect(
      resolveEffectiveTerminalStatusItemConfig(undefined, undefined)
    ).toEqual({ alignment: "left", hidden: false, order: 0 });
  });

  it("manifest 声明覆盖默认", () => {
    expect(
      resolveEffectiveTerminalStatusItemConfig(
        { alignment: "right", order: 10 },
        undefined
      )
    ).toEqual({ alignment: "right", hidden: false, order: 10 });
  });

  it("用户覆盖优先于 manifest", () => {
    expect(
      resolveEffectiveTerminalStatusItemConfig(
        { alignment: "right", order: 10 },
        { alignment: "left", hidden: true, order: -1 }
      )
    ).toEqual({ alignment: "left", hidden: true, order: -1 });
  });

  it("覆盖字段独立回落:只覆盖 order 时 alignment 仍取 manifest", () => {
    expect(
      resolveEffectiveTerminalStatusItemConfig(
        { alignment: "right" },
        { order: 5 }
      )
    ).toEqual({ alignment: "right", hidden: false, order: 5 });
  });
});

describe("mergeTerminalStatusItems", () => {
  it("无声明无覆盖:全部落左组,order 0 下按 id 字典序", () => {
    const groups = mergeTerminalStatusItems(
      items("b.item", "a.item"),
      declared({}),
      prefsOf()
    );
    expect(groups.left.map((i) => i.id)).toEqual(["a.item", "b.item"]);
    expect(groups.right).toEqual([]);
  });

  it("按生效 alignment 分两组", () => {
    const groups = mergeTerminalStatusItems(
      items("l.one", "r.one"),
      declared({ "r.one": { alignment: "right" } }),
      prefsOf()
    );
    expect(groups.left.map((i) => i.id)).toEqual(["l.one"]);
    expect(groups.right.map((i) => i.id)).toEqual(["r.one"]);
  });

  it("left 组 DOM 序 = order 升序(order 小靠左)", () => {
    const groups = mergeTerminalStatusItems(
      items("a", "b", "c"),
      declared({ a: { order: 20 }, b: { order: 0 }, c: { order: 10 } }),
      prefsOf()
    );
    expect(groups.left.map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  it("right 组 DOM 序 = order 升序再 reverse(order 小落 DOM 最右)", () => {
    const groups = mergeTerminalStatusItems(
      items("a", "b", "c"),
      declared({
        a: { alignment: "right", order: 20 },
        b: { alignment: "right", order: 0 },
        c: { alignment: "right", order: 10 },
      }),
      prefsOf()
    );
    // 外侧优先序 b(0) c(10) a(20);DOM 从左到右 = a c b,b 在最右(最外)
    expect(groups.right.map((i) => i.id)).toEqual(["a", "c", "b"]);
  });

  it("同 order 按 id 字典序 tie-break,字典序小者更靠外侧", () => {
    const left = mergeTerminalStatusItems(
      items("z.item", "a.item"),
      declared({ "z.item": { order: 5 }, "a.item": { order: 5 } }),
      prefsOf()
    );
    expect(left.left.map((i) => i.id)).toEqual(["a.item", "z.item"]);
    const right = mergeTerminalStatusItems(
      items("z.item", "a.item"),
      declared({
        "z.item": { alignment: "right", order: 5 },
        "a.item": { alignment: "right", order: 5 },
      }),
      prefsOf()
    );
    // DOM 最右 = 最外 = 字典序小的 a.item
    expect(right.right.map((i) => i.id)).toEqual(["z.item", "a.item"]);
  });

  it("用户覆盖换组 + 重排生效(覆盖 ?? manifest ?? 默认)", () => {
    const groups = mergeTerminalStatusItems(
      items("a", "b"),
      declared({ a: { alignment: "left", order: 10 } }),
      prefsOf({ a: { alignment: "right" }, b: { order: -1 } })
    );
    expect(groups.left.map((i) => i.id)).toEqual(["b"]);
    expect(groups.right.map((i) => i.id)).toEqual(["a"]);
  });

  it("hidden 覆盖在此层过滤", () => {
    const groups = mergeTerminalStatusItems(
      items("a", "b"),
      declared({}),
      prefsOf({ a: { hidden: true } })
    );
    expect(groups.left.map((i) => i.id)).toEqual(["b"]);
  });
});

describe("compareOuterFirst / normalizedGroupOrders", () => {
  it("compareOuterFirst:order 升序,同 order 按 id 字典序", () => {
    expect(
      [
        { id: "b", order: 10 },
        { id: "a", order: 10 },
        { id: "c", order: 0 },
      ]
        .sort(compareOuterFirst)
        .map((i) => i.id)
    ).toEqual(["c", "a", "b"]);
  });

  it("normalizedGroupOrders:按外侧优先目标顺序给 index*10", () => {
    expect(normalizedGroupOrders(["x", "y", "z"])).toEqual({
      x: 0,
      y: 10,
      z: 20,
    });
  });
});

describe("declaredTerminalStatusItemsById(F12:口径统一用 runtime.enabled)", () => {
  it("enabled=false 但 runtime.enabled=true 时仍纳入(以运行时激活态为准)", () => {
    const byId = declaredTerminalStatusItemsById(
      [pluginEntry("pier.drift", { enabled: false, runtimeEnabled: true })],
      []
    );
    expect(byId.has("pier.drift.item")).toBe(true);
  });

  it("enabled=true 但 runtime.enabled=false 时被排除(以运行时激活态为准)", () => {
    const byId = declaredTerminalStatusItemsById(
      [pluginEntry("pier.drift", { enabled: true, runtimeEnabled: false })],
      []
    );
    expect(byId.has("pier.drift.item")).toBe(false);
  });
});

describe("declaredTerminalStatusItemsById(core 声明源)", () => {
  const coreItem: CoreTerminalStatusItemDeclaration = {
    id: "core.foo",
    order: -5,
    alignment: "left",
    titleKey: "core.foo.title",
  };

  it("core 声明进入 map,与插件声明并列", () => {
    const byId = declaredTerminalStatusItemsById(
      [pluginEntry("pier.a", { enabled: true, runtimeEnabled: true })],
      [coreItem]
    );
    expect(byId.has("core.foo")).toBe(true);
    expect(byId.has("pier.a.item")).toBe(true);
    expect(byId.get("core.foo")).toEqual({ alignment: "left", order: -5 });
  });

  it("同 id 时 core 优先,plugin 声明被跳过", () => {
    const collisionPlugin: PluginRegistryEntry = {
      ...pluginEntry("pier.collide", { enabled: true, runtimeEnabled: true }),
    };
    collisionPlugin.manifest = {
      ...collisionPlugin.manifest,
      terminalStatusItems: [
        { id: "core.foo", order: 999, permissions: [], title: "Plugin Steal" },
      ],
    };
    const byId = declaredTerminalStatusItemsById([collisionPlugin], [coreItem]);
    expect(byId.get("core.foo")).toEqual({ alignment: "left", order: -5 });
  });

  it("无 core 声明时行为等价旧签名(coreItems=[])", () => {
    const byId = declaredTerminalStatusItemsById(
      [pluginEntry("pier.a", { enabled: true, runtimeEnabled: true })],
      []
    );
    expect(byId.size).toBe(1);
    expect(byId.has("pier.a.item")).toBe(true);
  });
});
