import type { RendererMissionControlWidgetRegistration } from "@plugins/api/renderer.ts";
import type { CoreMissionControlWidgetDeclaration } from "@shared/contracts/mission-control.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { LayoutDashboard } from "lucide-react";
import { describe, expect, it } from "vitest";
import {
  buildMissionControlLibraryItems,
  collectLibraryFilters,
  filterLibraryItems,
} from "@/panel-kits/mission-control/mission-control-library.ts";

const coreWidgets: readonly CoreMissionControlWidgetDeclaration[] = [
  {
    category: "agent",
    defaultSize: { h: 3, w: 4 },
    descriptionKey: "desc.activity",
    id: "core.activity-overview",
    searchTerms: ["activity", "会话"],
    titleKey: "title.activity",
  },
  {
    category: "custom",
    id: "core.custom-card",
    multiInstance: true,
    titleKey: "title.custom",
  },
];

const coreReg: RendererMissionControlWidgetRegistration = {
  component: () => null,
  icon: LayoutDashboard,
  id: "core.activity-overview",
};

function pluginEntry(enabled: boolean): PluginRegistryEntry {
  return {
    effectivePermissions: [],
    enabled,
    manifest: {
      apiVersion: 1,
      commands: [],
      missionControlWidgets: [
        {
          category: "analytics",
          id: "pier.codex.usage",
          searchTerms: ["usage"],
          permissions: [],
          title: "Codex Usage",
        },
      ],
      settingsPages: [],
      engines: { pier: ">=0.1.0" },
      id: "pier.codex",
      name: "Codex",
      panels: [],
      permissions: [],
      source: { kind: "builtin" },
      terminalStatusItems: [],
      version: "1.0.0",
    },
    runtime: { canToggle: true, enabled, kind: "builtin" },
  } as PluginRegistryEntry;
}

function buildItems(input?: {
  addedCounts?: ReadonlyMap<string, number>;
  plugins?: readonly PluginRegistryEntry[];
}) {
  return buildMissionControlLibraryItems({
    addedCounts: input?.addedCounts ?? new Map(),
    coreComponentMap: new Map([["core.activity-overview", coreReg]]),
    coreWidgets,
    locale: "en",
    plugins: input?.plugins ?? [],
    translate: (key) => `t:${key}`,
    widgetRegistrations: new Map(),
  });
}

describe("buildMissionControlLibraryItems", () => {
  it("core 物料带翻译标题/描述与来源", () => {
    const items = buildItems();
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe("t:title.activity");
    expect(items[0]?.description).toBe("t:desc.activity");
    expect(items[0]?.source).toEqual({ kind: "core" });
    expect(items[0]?.size).toEqual({ h: 3, w: 4 });
  });

  it("单实例已添加 → disabled；多实例已添加 → 可继续加", () => {
    const items = buildItems({
      addedCounts: new Map([
        ["core.activity-overview", 1],
        ["core.custom-card", 2],
      ]),
    });
    expect(items[0]?.disabled).toBe(true);
    expect(items[1]?.disabled).toBe(false);
    expect(items[1]?.addedCount).toBe(2);
  });

  it("只收录启用插件的物料", () => {
    expect(buildItems({ plugins: [pluginEntry(false)] })).toHaveLength(2);
    const items = buildItems({ plugins: [pluginEntry(true)] });
    expect(items).toHaveLength(3);
    expect(items[2]?.source).toEqual({
      kind: "plugin",
      pluginId: "pier.codex",
      pluginName: "Codex",
    });
  });
});

describe("collectLibraryFilters", () => {
  it("聚合出现的分类与插件来源，空分类不显示", () => {
    const items = buildItems({ plugins: [pluginEntry(true)] });
    expect(collectLibraryFilters(items)).toEqual([
      "all",
      "cat:agent",
      "cat:analytics",
      "cat:custom",
      "plugin:pier.codex",
    ]);
  });
});

describe("filterLibraryItems", () => {
  it("分类过滤与搜索叠加", () => {
    const items = buildItems({ plugins: [pluginEntry(true)] });
    expect(filterLibraryItems(items, "cat:agent", "")).toHaveLength(1);
    expect(filterLibraryItems(items, "plugin:pier.codex", "")).toHaveLength(1);
    expect(filterLibraryItems(items, "cat:agent", "usage")).toHaveLength(0);
  });

  it("搜索命中 title/searchTerms（含中文关键词），多词全部命中", () => {
    const items = buildItems();
    expect(filterLibraryItems(items, "all", "会话")).toHaveLength(1);
    expect(filterLibraryItems(items, "all", "ACTIVITY")).toHaveLength(1);
    expect(filterLibraryItems(items, "all", "activity nothing")).toHaveLength(
      0
    );
  });
});
