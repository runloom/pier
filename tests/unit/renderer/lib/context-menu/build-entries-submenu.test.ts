import type {
  MenuItemAction,
  MenuItemSubmenu,
} from "@shared/contracts/menu.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { actionRegistry } from "@/lib/actions/registry.ts";
import type { Action } from "@/lib/actions/types.ts";
import { buildMenuEntries } from "@/lib/context-menu/build-entries.ts";

const SURFACE = "test/submenu";

const noop = () => undefined;

describe("buildMenuEntries — submenu 聚合", () => {
  const disposers: (() => void)[] = [];

  function mkAction(
    id: string,
    group: string,
    sortOrder: number,
    submenu?: string
  ): Action {
    return {
      id,
      title: () => id,
      category: "Test",
      handler: noop,
      surfaces: [SURFACE],
      metadata: {
        group,
        sortOrder,
        ...(submenu !== undefined && { submenu: () => submenu }),
      },
    };
  }

  function register(a: Action): void {
    disposers.push(actionRegistry.register(a));
  }

  beforeEach(() => {
    disposers.length = 0;
  });

  afterEach(() => {
    for (const d of disposers) {
      d();
    }
  });

  it("没 submenu 字段的 action 平铺", () => {
    register(mkAction("a", "1_g", 1));
    register(mkAction("b", "1_g", 2));
    const items = buildMenuEntries(SURFACE);
    expect(items).toEqual([
      { type: "action", id: "a", label: "a", enabled: true },
      { type: "action", id: "b", label: "b", enabled: true },
    ]);
  });

  it("同 submenu key 聚合成一个 MenuItemSubmenu", () => {
    register(mkAction("split-r", "2_split", 1, "Split"));
    register(mkAction("split-d", "2_split", 2, "Split"));
    const items = buildMenuEntries(SURFACE);
    expect(items).toEqual([
      {
        type: "submenu",
        label: "Split",
        submenu: [
          { type: "action", id: "split-r", label: "split-r", enabled: true },
          { type: "action", id: "split-d", label: "split-d", enabled: true },
        ],
      },
    ]);
  });

  it("子菜单内按 sortOrder 排", () => {
    register(mkAction("split-u", "2_split", 4, "Split"));
    register(mkAction("split-r", "2_split", 1, "Split"));
    register(mkAction("split-l", "2_split", 3, "Split"));
    register(mkAction("split-d", "2_split", 2, "Split"));
    const items = buildMenuEntries(SURFACE);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "submenu", label: "Split" });
    const submenuItems = (items[0] as MenuItemSubmenu)
      .submenu as MenuItemAction[];
    expect(submenuItems.map((x) => x.id)).toEqual([
      "split-r",
      "split-d",
      "split-l",
      "split-u",
    ]);
  });

  it("子菜单位置 = 其内第一个 action 的位置", () => {
    // group "2_g" 内: a(sortOrder 1), 然后两个 submenu key=Sub(sortOrder 2,3),
    // 再 d(sortOrder 4). submenu 应该出现在 a 和 d 之间.
    register(mkAction("a", "2_g", 1));
    register(mkAction("sub-b", "2_g", 2, "Sub"));
    register(mkAction("sub-c", "2_g", 3, "Sub"));
    register(mkAction("d", "2_g", 4));
    const items = buildMenuEntries(SURFACE);
    const labels = items.map((x) => {
      if ("id" in x) {
        return x.id;
      }
      if (x.type === "submenu") {
        return `sub:${x.label}`;
      }
      return x.type;
    });
    expect(labels).toEqual(["a", "sub:Sub", "d"]);
  });

  it("不同 group 的 submenu key 相同时仍聚成两个独立子菜单", () => {
    // group 不同 = 不同桶, 不跨桶聚合
    register(mkAction("a", "1_g", 1, "S"));
    register(mkAction("b", "2_g", 1, "S"));
    const items = buildMenuEntries(SURFACE);
    // 两个独立 submenu + 一个 separator
    expect(items.filter((x) => x.type === "submenu")).toHaveLength(2);
    expect(items.filter((x) => x.type === "separator")).toHaveLength(1);
  });

  it("同 group 混合 submenu / 非 submenu 的输出顺序符合预期", () => {
    register(mkAction("a", "2_g", 1));
    register(mkAction("sub-b", "2_g", 2, "Sub"));
    register(mkAction("c", "2_g", 3));
    const items = buildMenuEntries(SURFACE);
    expect(items).toEqual([
      { type: "action", id: "a", label: "a", enabled: true },
      {
        type: "submenu",
        label: "Sub",
        submenu: [
          { type: "action", id: "sub-b", label: "sub-b", enabled: true },
        ],
      },
      { type: "action", id: "c", label: "c", enabled: true },
    ]);
  });
});
