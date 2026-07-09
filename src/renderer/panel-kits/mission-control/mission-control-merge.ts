import type { RendererMissionControlWidgetRegistration } from "@plugins/api/renderer.ts";
import type {
  CoreMissionControlWidgetDeclaration,
  MissionControlPanelParams,
} from "@shared/contracts/mission-control.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { resolvePluginMissionControlWidgetDisplay } from "@/lib/plugins/display.ts";

export type ResolvedWidgetStatus =
  | "core"
  | "plugin-active"
  | "plugin-disabled"
  | "unknown";

export interface ResolvedMissionControlWidget {
  description?: string;
  id: string;
  registration: RendererMissionControlWidgetRegistration | null;
  status: ResolvedWidgetStatus;
  title: string;
}

/**
 * 合并 params ∩ (core 声明 ∪ 插件声明 ∪ 运行时注册) → 渲染清单。
 *
 * 解析逻辑：
 * 1. core 声明 → status "core"，取 core 组件表组件
 * 2. 插件声明且运行时已注册 → status "plugin-active"，取注册表组件
 * 3. 插件声明但未注册（插件禁用） → status "plugin-disabled"，占位卡
 * 4. 声明不存在（插件被卸载） → status "unknown"，占位卡带移除按钮
 */
function collectPluginWidgetIds(
  plugins: readonly PluginRegistryEntry[],
  enabledOnly: boolean
): Set<string> {
  const ids = new Set<string>();
  for (const entry of plugins) {
    if (enabledOnly && !entry.runtime.enabled) {
      continue;
    }
    for (const widget of entry.manifest.missionControlWidgets) {
      ids.add(widget.id);
    }
  }
  return ids;
}

function resolveTitle(
  reg: RendererMissionControlWidgetRegistration | null,
  fallback: string
): string {
  if (!reg) {
    return fallback;
  }
  if (typeof reg.title === "function") {
    // 插件作者代码：merge 阶段在 per-card ErrorBoundary 之外执行，
    // 抛错会炸整个指挥中心 —— 兜底回退到 manifest 标题。
    try {
      return reg.title();
    } catch {
      return fallback;
    }
  }
  return reg.title ?? fallback;
}

function resolvePluginWidgetDescription(
  widgetId: string,
  plugins: readonly PluginRegistryEntry[],
  locale: string
): string | undefined {
  for (const entry of plugins) {
    const widget = entry.manifest.missionControlWidgets.find(
      (w) => w.id === widgetId
    );
    if (widget) {
      return resolvePluginMissionControlWidgetDisplay(
        entry.manifest,
        widget,
        locale
      ).description;
    }
  }
  return;
}

/** manifest 本地化标题（禁用/加载态无运行时 registration 时的回退，胜过裸 id）。 */
function resolvePluginWidgetTitle(
  widgetId: string,
  plugins: readonly PluginRegistryEntry[],
  locale: string
): string | undefined {
  for (const entry of plugins) {
    const widget = entry.manifest.missionControlWidgets.find(
      (w) => w.id === widgetId
    );
    if (widget) {
      return resolvePluginMissionControlWidgetDisplay(
        entry.manifest,
        widget,
        locale
      ).title;
    }
  }
  return;
}

/**
 * 合并 params ∩ (core 声明 ∪ 插件声明 ∪ 运行时注册) → 渲染清单。
 *
 * 解析逻辑：
 * 1. core 声明 → status "core"，取 core 组件表组件
 * 2. 插件声明且运行时已注册 → status "plugin-active"，取注册表组件
 * 3. 插件声明但未注册（插件禁用） → status "plugin-disabled"，占位卡
 * 4. 声明不存在（插件被卸载） → status "unknown"，占位卡带移除按钮
 */
export function resolveMissionControlWidgets(
  params: MissionControlPanelParams,
  coreWidgets: readonly CoreMissionControlWidgetDeclaration[],
  plugins: readonly PluginRegistryEntry[],
  widgetRegistrations: ReadonlyMap<
    string,
    RendererMissionControlWidgetRegistration
  >,
  coreComponentMap: ReadonlyMap<
    string,
    RendererMissionControlWidgetRegistration
  >,
  locale = "en"
): ResolvedMissionControlWidget[] {
  const coreById = new Map(coreWidgets.map((w) => [w.id, w]));
  const enabledPluginIds = collectPluginWidgetIds(plugins, true);
  const allPluginIds = collectPluginWidgetIds(plugins, false);

  const seen = new Set<string>();
  const result: ResolvedMissionControlWidget[] = [];

  for (const entry of params.widgets) {
    if (seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);

    const coreDecl = coreById.get(entry.id);
    if (coreDecl) {
      result.push({
        ...(coreDecl.descriptionKey
          ? { description: coreDecl.descriptionKey }
          : {}),
        id: entry.id,
        registration: coreComponentMap.get(entry.id) ?? null,
        status: "core",
        title: coreDecl.titleKey,
      });
      continue;
    }

    result.push(
      resolvePluginWidget(entry.id, {
        allPluginIds,
        enabledPluginIds,
        locale,
        plugins,
        widgetRegistrations,
      })
    );
  }

  return result;
}

interface PluginWidgetResolveCtx {
  allPluginIds: ReadonlySet<string>;
  enabledPluginIds: ReadonlySet<string>;
  locale: string;
  plugins: readonly PluginRegistryEntry[];
  widgetRegistrations: ReadonlyMap<
    string,
    RendererMissionControlWidgetRegistration
  >;
}

/**
 * 非 core widget 的解析：启用（含加载态）、禁用、已卸载三态。
 * 从 resolveMissionControlWidgets 主循环抽出，控制单函数认知复杂度。
 */
function resolvePluginWidget(
  id: string,
  ctx: PluginWidgetResolveCtx
): ResolvedMissionControlWidget {
  const {
    allPluginIds,
    enabledPluginIds,
    locale,
    plugins,
    widgetRegistrations,
  } = ctx;
  // manifest 本地化标题：启用加载态与禁用态都优先它，胜过裸 id
  const manifestTitle = resolvePluginWidgetTitle(id, plugins, locale);

  if (enabledPluginIds.has(id)) {
    const reg = widgetRegistrations.get(id) ?? null;
    const desc = resolvePluginWidgetDescription(id, plugins, locale);
    return {
      ...(desc ? { description: desc } : {}),
      id,
      registration: reg,
      status: "plugin-active",
      title: resolveTitle(reg, manifestTitle ?? id),
    };
  }

  // 禁用态 manifest 仍在，用本地化标题；unknown（插件已卸载）只剩裸 id
  const isDisabled = allPluginIds.has(id);
  return {
    id,
    registration: null,
    status: isDisabled ? "plugin-disabled" : "unknown",
    title: isDisabled ? (manifestTitle ?? id) : id,
  };
}
