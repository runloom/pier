import {
  type PluginTerminalStatusItemContribution,
  pluginTerminalStatusItemContributionSchema,
} from "@shared/contracts/plugin.ts";
import {
  emptyTerminalStatusBarPrefs,
  terminalStatusBarItemOverrideSchema,
  terminalStatusBarPrefsSchema,
  withItemOverridePatch,
} from "@shared/contracts/terminal-status-bar.ts";
import { describe, expect, it } from "vitest";

describe("pluginTerminalStatusItemContributionSchema — alignment/order", () => {
  it("alignment 与 order 可选,缺省不注入默认值(默认语义由合并层给)", () => {
    const parsed = pluginTerminalStatusItemContributionSchema.parse({
      id: "pier.worktree.status",
      title: "Worktree Status",
    });
    expect(parsed.alignment).toBeUndefined();
    expect(parsed.order).toBeUndefined();
  });

  it("接受合法 alignment/order", () => {
    const parsed: PluginTerminalStatusItemContribution =
      pluginTerminalStatusItemContributionSchema.parse({
        alignment: "right",
        id: "a.b",
        order: 10,
        title: "X",
      });
    expect(parsed.alignment).toBe("right");
    expect(parsed.order).toBe(10);
  });

  it("拒绝非法 alignment", () => {
    expect(() =>
      pluginTerminalStatusItemContributionSchema.parse({
        alignment: "center",
        id: "a.b",
        title: "X",
      })
    ).toThrow();
  });

  it("拒绝非数字 order", () => {
    expect(() =>
      pluginTerminalStatusItemContributionSchema.parse({
        id: "a.b",
        order: "10",
        title: "X",
      })
    ).toThrow();
  });
});

describe("terminalStatusBarPrefsSchema", () => {
  it("接受空 prefs 与完整覆盖", () => {
    expect(
      terminalStatusBarPrefsSchema.parse({ items: {}, version: 1 })
    ).toEqual(emptyTerminalStatusBarPrefs());
    const full = {
      items: {
        "pier.worktree.status": {
          alignment: "right" as const,
          hidden: true,
          order: -5,
        },
      },
      version: 1 as const,
    };
    expect(terminalStatusBarPrefsSchema.parse(full)).toEqual(full);
  });

  it("拒绝错误 version 与非法字段值", () => {
    expect(() =>
      terminalStatusBarPrefsSchema.parse({ items: {}, version: 2 })
    ).toThrow();
    expect(() =>
      terminalStatusBarItemOverrideSchema.parse({ hidden: "yes" })
    ).toThrow();
  });
});

describe("withItemOverridePatch", () => {
  it("值 → 设置;缺省 → 保留现值", () => {
    expect(withItemOverridePatch({ hidden: true }, { order: 20 })).toEqual({
      hidden: true,
      order: 20,
    });
  });

  it("null → 清除该字段", () => {
    expect(
      withItemOverridePatch({ hidden: true, order: 20 }, { hidden: null })
    ).toEqual({ order: 20 });
  });

  it("全部字段清空时返回 null(调用方改走 resetItem)", () => {
    expect(
      withItemOverridePatch({ hidden: true }, { hidden: null })
    ).toBeNull();
    expect(withItemOverridePatch(undefined, {})).toBeNull();
  });

  it("current 为 undefined 时从空覆盖合成", () => {
    expect(withItemOverridePatch(undefined, { alignment: "right" })).toEqual({
      alignment: "right",
    });
  });
});
