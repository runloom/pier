import type { RendererMissionControlWidgetRegistration } from "@plugins/api/renderer.ts";
import type {
  CoreMissionControlWidgetDeclaration,
  MissionControlGridSize,
  MissionControlWidgetCategory,
} from "@shared/contracts/mission-control.ts";
import { HOST_DEFAULT_WIDGET_SIZE } from "@shared/contracts/mission-control.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import type { LucideIcon } from "lucide-react";
import type { FunctionComponent } from "react";
import {
  resolvePluginDisplay,
  resolvePluginMissionControlWidgetDisplay,
} from "@/lib/plugins/display.ts";

/** 物料库条目（对话框渲染单元）。 */
export interface MissionControlLibraryItem {
  addedCount: number;
  category: MissionControlWidgetCategory | null;
  description?: string;
  /** 单实例且已添加 → 保持可见但禁点（可发现性优于隐藏）。 */
  disabled: boolean;
  icon: LucideIcon | null;
  id: string;
  multiInstance: boolean;
  previewComponent: FunctionComponent | null;
  searchTerms: readonly string[];
  size: MissionControlGridSize;
  source:
    | { kind: "core" }
    | { kind: "plugin"; pluginId: string; pluginName: string };
  title: string;
}

/** 分类栏筛选键："all" | "cat:<category>" | "plugin:<pluginId>"。 */
export type MissionControlLibraryFilter = string;

export function buildMissionControlLibraryItems(input: {
  addedCounts: ReadonlyMap<string, number>;
  coreComponentMap: ReadonlyMap<
    string,
    RendererMissionControlWidgetRegistration
  >;
  coreWidgets: readonly CoreMissionControlWidgetDeclaration[];
  locale: string;
  plugins: readonly PluginRegistryEntry[];
  translate: (key: string) => string;
  widgetRegistrations: ReadonlyMap<
    string,
    RendererMissionControlWidgetRegistration
  >;
}): MissionControlLibraryItem[] {
  const {
    addedCounts,
    coreComponentMap,
    coreWidgets,
    locale,
    plugins,
    translate,
    widgetRegistrations,
  } = input;
  const items: MissionControlLibraryItem[] = [];

  for (const decl of coreWidgets) {
    const reg = coreComponentMap.get(decl.id) ?? null;
    const addedCount = addedCounts.get(decl.id) ?? 0;
    const multiInstance = decl.multiInstance === true;
    items.push({
      addedCount,
      category: decl.category ?? null,
      ...(decl.descriptionKey
        ? { description: translate(decl.descriptionKey) }
        : {}),
      disabled: !multiInstance && addedCount > 0,
      icon: reg?.icon ?? null,
      id: decl.id,
      searchTerms: decl.searchTerms ?? [],
      multiInstance,
      previewComponent: reg?.previewComponent ?? null,
      size: decl.defaultSize ?? HOST_DEFAULT_WIDGET_SIZE,
      source: { kind: "core" },
      title: translate(decl.titleKey),
    });
  }

  for (const entry of plugins) {
    if (!entry.runtime.enabled) {
      continue;
    }
    const pluginName = resolvePluginDisplay(entry, locale).name;
    for (const widget of entry.manifest.missionControlWidgets) {
      const reg = widgetRegistrations.get(widget.id) ?? null;
      const display = resolvePluginMissionControlWidgetDisplay(
        entry.manifest,
        widget,
        locale
      );
      const addedCount = addedCounts.get(widget.id) ?? 0;
      const multiInstance = widget.multiInstance === true;
      items.push({
        addedCount,
        category: widget.category ?? null,
        ...(display.description ? { description: display.description } : {}),
        disabled: !multiInstance && addedCount > 0,
        icon: reg?.icon ?? null,
        id: widget.id,
        searchTerms: widget.searchTerms ?? [],
        multiInstance,
        previewComponent: reg?.previewComponent ?? null,
        size: widget.defaultSize ?? HOST_DEFAULT_WIDGET_SIZE,
        source: { kind: "plugin", pluginId: entry.manifest.id, pluginName },
        title: display.title,
      });
    }
  }

  return items;
}

/** 分类栏可用筛选项（按目录内容动态聚合，空分类不显示）。 */
export function collectLibraryFilters(
  items: readonly MissionControlLibraryItem[]
): MissionControlLibraryFilter[] {
  const categoryOrder: MissionControlWidgetCategory[] = [
    "agent",
    "vcs",
    "system",
    "analytics",
    "custom",
  ];
  const filters: MissionControlLibraryFilter[] = ["all"];
  for (const category of categoryOrder) {
    if (items.some((item) => item.category === category)) {
      filters.push(`cat:${category}`);
    }
  }
  const pluginIds = new Set<string>();
  for (const item of items) {
    if (item.source.kind === "plugin") {
      pluginIds.add(item.source.pluginId);
    }
  }
  for (const pluginId of pluginIds) {
    filters.push(`plugin:${pluginId}`);
  }
  return filters;
}

function matchesFilter(
  item: MissionControlLibraryItem,
  filter: MissionControlLibraryFilter
): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter.startsWith("cat:")) {
    return item.category === filter.slice("cat:".length);
  }
  if (filter.startsWith("plugin:")) {
    return (
      item.source.kind === "plugin" &&
      item.source.pluginId === filter.slice("plugin:".length)
    );
  }
  return true;
}

function matchesQuery(item: MissionControlLibraryItem, query: string): boolean {
  if (!query) {
    return true;
  }
  const haystack = [
    item.title,
    item.description ?? "",
    item.id,
    ...item.searchTerms,
  ]
    .join("\n")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

/** 分类 × 搜索叠加过滤。 */
export function filterLibraryItems(
  items: readonly MissionControlLibraryItem[],
  filter: MissionControlLibraryFilter,
  query: string
): MissionControlLibraryItem[] {
  return items.filter(
    (item) => matchesFilter(item, filter) && matchesQuery(item, query)
  );
}
