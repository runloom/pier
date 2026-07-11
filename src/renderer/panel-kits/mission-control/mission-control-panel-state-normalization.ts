import type {
  MissionControlPanelParams,
  MissionControlPanelWidgetEntry,
} from "@shared/contracts/mission-control.ts";
import {
  HOST_MAX_WIDGET_SIZE,
  HOST_MIN_WIDGET_SIZE,
  salvageMissionControlPanelParams,
  widgetEntryWidgetId,
} from "@shared/contracts/mission-control.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { CORE_MISSION_CONTROL_WIDGETS } from "./core-mission-control-widgets.ts";
import {
  clampSize,
  type SizeDeclaration as GridSizeDeclaration,
} from "./mission-control-grid-geometry.ts";

export type SizeDeclaration = GridSizeDeclaration & {
  multiInstance?: boolean | undefined;
};

function findWidgetDeclarationInManifests(
  widgetId: string,
  plugins: readonly PluginRegistryEntry[]
): SizeDeclaration | undefined {
  const core = CORE_MISSION_CONTROL_WIDGETS.find(
    (widget) => widget.id === widgetId
  );
  if (core) return core;
  for (const entry of plugins) {
    const widget = entry.manifest.missionControlWidgets.find(
      (candidate) => candidate.id === widgetId
    );
    if (widget) return widget;
  }
  return;
}

/**
 * 渲染与用户提交共用同一尺寸声明。禁用插件仍保留 manifest，必须继续使用
 * 原声明边界，避免拖拽阶段允许的尺寸在持久化时回弹。
 */
export function findWidgetDeclaration(
  widgetId: string,
  plugins: readonly PluginRegistryEntry[]
): SizeDeclaration | undefined {
  return findWidgetDeclarationInManifests(widgetId, plugins);
}

function canonicalSize(
  entry: MissionControlPanelWidgetEntry,
  declaration: SizeDeclaration | undefined
) {
  return clampSize(
    { h: entry.h, w: entry.w },
    declaration?.minSize ?? HOST_MIN_WIDGET_SIZE,
    declaration?.maxSize ?? HOST_MAX_WIDGET_SIZE
  );
}

/**
 * 规范化只处理实例身份、顺序和尺寸偏好；响应式 x/y 是渲染期派生状态，
 * 不进入 panel params，也不会因 viewport 或插件声明变化而主动写盘。
 */
export function canonicalizeMissionControlPanelParams(
  raw: unknown,
  plugins: readonly PluginRegistryEntry[]
): MissionControlPanelParams {
  const params = salvageMissionControlPanelParams(raw);
  const seenInstanceIds = new Set<string>();
  const seenSingletonWidgetIds = new Set<string>();
  const widgets = params.widgets.flatMap((entry) => {
    if (seenInstanceIds.has(entry.id)) return [];
    seenInstanceIds.add(entry.id);
    const widgetId = widgetEntryWidgetId(entry);
    const declaration = findWidgetDeclarationInManifests(widgetId, plugins);
    if (declaration && declaration.multiInstance !== true) {
      if (seenSingletonWidgetIds.has(widgetId)) return [];
      seenSingletonWidgetIds.add(widgetId);
    }
    const size = canonicalSize(entry, declaration);
    return [{ ...entry, ...size }];
  });
  return { layoutVersion: 3, widgets };
}
