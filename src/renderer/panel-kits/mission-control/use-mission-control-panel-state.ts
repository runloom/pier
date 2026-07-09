import type {
  MissionControlPanelParams,
  MissionControlPanelWidgetEntry,
} from "@shared/contracts/mission-control.ts";
import {
  MISSION_CONTROL_GRID_COLS,
  widgetEntryWidgetId,
} from "@shared/contracts/mission-control.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import type { JsonValue } from "@shared/contracts/plugin-settings.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Layout, LayoutItem } from "react-grid-layout";
import { CORE_MISSION_CONTROL_WIDGETS } from "./core-mission-control-widgets.ts";
import { deriveOptimalAutoLayout } from "./mission-control-auto-layout.ts";
import {
  appendEntry,
  applyDerivedLayoutChange,
  entryToLayoutItem,
  findAddSlot,
  type SizeDeclaration as GridSizeDeclaration,
  layoutToEntries,
} from "./mission-control-grid-geometry.ts";

interface PanelParamsApi {
  updateParameters(params: Record<string, unknown>): void;
}

type SizeDeclaration = GridSizeDeclaration & {
  multiInstance?: boolean | undefined;
};

/** 声明查找：core / 插件 manifest 中找 widget 的尺寸与实例语义。 */
export function findWidgetDeclaration(
  widgetId: string,
  plugins: readonly PluginRegistryEntry[]
): SizeDeclaration | undefined {
  const core = CORE_MISSION_CONTROL_WIDGETS.find((w) => w.id === widgetId);
  if (core) {
    return core;
  }
  for (const entry of plugins) {
    const widget = entry.manifest.missionControlWidgets.find(
      (w) => w.id === widgetId
    );
    if (widget) {
      return widget;
    }
  }
  return;
}

/**
 * 几何结果合并回完整条目：geometry 纯函数只吐 {id,x,y,w,h}，
 * widgetId/params 等非几何字段必须从源条目带回，否则每次拖拽都会丢配置。
 */
function mergeGeometry(
  entries: readonly MissionControlPanelWidgetEntry[],
  geometry: readonly {
    h: number;
    id: string;
    w: number;
    x: number;
    y: number;
  }[]
): MissionControlPanelWidgetEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  return geometry.map((g) => {
    const source = byId.get(g.id);
    return source
      ? { ...source, h: g.h, w: g.w, x: g.x, y: g.y }
      : { h: g.h, id: g.id, w: g.w, x: g.x, y: g.y };
  });
}

function newInstanceEntry(
  entries: readonly MissionControlPanelWidgetEntry[],
  widgetId: string,
  decl: SizeDeclaration | undefined
): MissionControlPanelWidgetEntry {
  const geometry = appendEntry(entries, widgetId, decl);
  const instanceId =
    decl?.multiInstance === true ? crypto.randomUUID() : widgetId;
  return {
    h: geometry.h,
    id: instanceId,
    w: geometry.w,
    widgetId,
    x: geometry.x,
    y: geometry.y,
  };
}

/**
 * 指挥中心面板的组装状态收口：所有 params 变更（添加/移除/复制/尺寸预设/
 * 物料配置/锁定/布局写回）与刷新信号都经此 hook，面板组件只做渲染。
 */
export function useMissionControlPanelState(
  params: MissionControlPanelParams,
  api: PanelParamsApi,
  plugins: readonly PluginRegistryEntry[]
) {
  const prevEntriesRef = useRef(JSON.stringify(params.widgets));
  const [refreshTokens, setRefreshTokens] = useState<Record<string, number>>(
    {}
  );
  const [highlightId, setHighlightId] = useState<string | null>(null);

  useEffect(() => {
    if (highlightId === null) {
      return;
    }
    const timer = setTimeout(() => setHighlightId(null), 1600);
    return () => clearTimeout(timer);
  }, [highlightId]);

  const persist = useCallback(
    (next: readonly MissionControlPanelWidgetEntry[]) => {
      prevEntriesRef.current = JSON.stringify(next);
      api.updateParameters({ ...params, widgets: next });
    },
    [api, params]
  );

  const handleLayoutChange = useCallback(
    (
      newLayout: Layout,
      derived: { isDerived: boolean; layout: readonly LayoutItem[] }
    ) => {
      if (!derived.isDerived) {
        const next = mergeGeometry(params.widgets, layoutToEntries(newLayout));
        const newJson = JSON.stringify(next);
        if (newJson !== prevEntriesRef.current) {
          persist(next);
        }
        return;
      }

      const geometry = applyDerivedLayoutChange(
        params.widgets,
        derived.layout,
        newLayout
      );
      if (geometry) {
        persist(mergeGeometry(params.widgets, geometry));
      }
    },
    [params.widgets, persist]
  );

  const handleArrangeLayout = useCallback(() => {
    const declarationsByInstanceId = new Map<
      string,
      SizeDeclaration | undefined
    >();
    const basis = params.widgets.map((entry) => {
      const decl = findWidgetDeclaration(widgetEntryWidgetId(entry), plugins);
      declarationsByInstanceId.set(entry.id, decl);
      return entryToLayoutItem(entry, decl);
    });
    const arranged = deriveOptimalAutoLayout(basis, MISSION_CONTROL_GRID_COLS, {
      getSizeDeclaration: (instanceId) =>
        declarationsByInstanceId.get(instanceId),
    });
    const next = mergeGeometry(params.widgets, layoutToEntries(arranged));
    const newJson = JSON.stringify(next);
    if (newJson !== prevEntriesRef.current) {
      persist(next);
    }
  }, [params.widgets, persist, plugins]);

  const handleAdd = useCallback(
    (widgetId: string) => {
      const decl = findWidgetDeclaration(widgetId, plugins);
      const entry = newInstanceEntry(params.widgets, widgetId, decl);
      persist([...params.widgets, entry]);
      setHighlightId(entry.id);
    },
    [params.widgets, plugins, persist]
  );

  const handleRemove = useCallback(
    (instanceId: string) => {
      persist(params.widgets.filter((w) => w.id !== instanceId));
    },
    [params.widgets, persist]
  );

  const handleDuplicate = useCallback(
    (instanceId: string) => {
      const source = params.widgets.find((w) => w.id === instanceId);
      if (!source) {
        return;
      }
      const slot = findAddSlot(
        params.widgets,
        MISSION_CONTROL_GRID_COLS,
        source.w,
        source.h
      );
      const entry: MissionControlPanelWidgetEntry = {
        h: source.h,
        id: crypto.randomUUID(),
        ...(source.params
          ? {
              params: structuredClone(source.params),
            }
          : {}),
        w: source.w,
        widgetId: widgetEntryWidgetId(source),
        x: slot.x,
        y: slot.y,
      };
      persist([...params.widgets, entry]);
      setHighlightId(entry.id);
    },
    [params.widgets, persist]
  );

  const handleUpdateParams = useCallback(
    (instanceId: string, patch: Record<string, JsonValue>) => {
      persist(
        params.widgets.map((w) =>
          w.id === instanceId
            ? { ...w, params: { ...(w.params ?? {}), ...patch } }
            : w
        )
      );
    },
    [params.widgets, persist]
  );

  const handleToggleLocked = useCallback(() => {
    api.updateParameters({ ...params, locked: params.locked !== true });
  }, [api, params]);

  const refreshOne = useCallback((instanceId: string) => {
    setRefreshTokens((tokens) => ({
      ...tokens,
      [instanceId]: (tokens[instanceId] ?? 0) + 1,
    }));
  }, []);

  const refreshAll = useCallback(() => {
    setRefreshTokens((tokens) => {
      const next: Record<string, number> = { ...tokens };
      for (const entry of params.widgets) {
        next[entry.id] = (next[entry.id] ?? 0) + 1;
      }
      return next;
    });
  }, [params.widgets]);

  return {
    handleAdd,
    handleArrangeLayout,
    handleDuplicate,
    handleLayoutChange,
    handleRemove,
    handleToggleLocked,
    handleUpdateParams,
    highlightId,
    refreshAll,
    refreshOne,
    refreshTokens,
  };
}
