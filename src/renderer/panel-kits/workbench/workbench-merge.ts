import type { RendererWorkbenchWidgetRegistration } from "@plugins/api/renderer.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import type { JsonValue } from "@shared/contracts/plugin-settings.ts";
import type {
  CoreWorkbenchWidgetDeclaration,
  PluginWorkbenchWidgetContribution,
  WorkbenchPanelParams,
} from "@shared/contracts/workbench.ts";
import { widgetEntryWidgetId } from "@shared/contracts/workbench.ts";
import { resolvePluginWorkbenchWidgetDisplay } from "@/lib/plugins/display.ts";

export type ResolvedWidgetStatus =
  | "core"
  | "plugin-active"
  | "plugin-disabled"
  | "unknown";

const EMPTY_PARAMS: Readonly<Record<string, JsonValue>> = Object.freeze({});

/**
 * 渲染清单条目 —— 实例模型（v2）：
 * `instanceId` 是持久化条目 id（多实例物料为 uuid），`widgetId` 是物料 id。
 * chrome 能力位（configurable/multiInstance/refreshable）来自声明，
 * unknown 态一律 false。
 */
export interface ResolvedWorkbenchWidget {
  configurable: boolean;
  description?: string;
  instanceId: string;
  multiInstance: boolean;
  params: Readonly<Record<string, JsonValue>>;
  refreshable: boolean;
  registration: RendererWorkbenchWidgetRegistration | null;
  status: ResolvedWidgetStatus;
  title: string;
  widgetId: string;
}

function collectPluginWidgetIds(
  plugins: readonly PluginRegistryEntry[],
  enabledOnly: boolean
): Set<string> {
  const ids = new Set<string>();
  for (const entry of plugins) {
    if (enabledOnly && !entry.runtime.enabled) {
      continue;
    }
    for (const widget of entry.manifest.workbenchWidgets) {
      ids.add(widget.id);
    }
  }
  return ids;
}

function resolveTitle(
  reg: RendererWorkbenchWidgetRegistration | null,
  fallback: string
): string {
  if (!reg) {
    return fallback;
  }
  if (typeof reg.title === "function") {
    // 插件作者代码：merge 阶段在 per-card ErrorBoundary 之外执行，
    // 抛错会炸整个工作台 —— 兜底回退到 manifest 标题。
    try {
      return reg.title();
    } catch {
      return fallback;
    }
  }
  return reg.title ?? fallback;
}

function findPluginContribution(
  widgetId: string,
  plugins: readonly PluginRegistryEntry[]
):
  | {
      contribution: PluginWorkbenchWidgetContribution;
      manifest: PluginRegistryEntry["manifest"];
    }
  | undefined {
  for (const entry of plugins) {
    const widget = entry.manifest.workbenchWidgets.find(
      (w) => w.id === widgetId
    );
    if (widget) {
      return { contribution: widget, manifest: entry.manifest };
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
 *
 * 实例语义：按实例 id 去重（同一 uuid 只渲染一次）；同一 widgetId 的多个
 * 实例（multiInstance 物料）各自独立解析。
 */
export function resolveWorkbenchWidgets(
  params: WorkbenchPanelParams,
  coreWidgets: readonly CoreWorkbenchWidgetDeclaration[],
  plugins: readonly PluginRegistryEntry[],
  widgetRegistrations: ReadonlyMap<string, RendererWorkbenchWidgetRegistration>,
  coreComponentMap: ReadonlyMap<string, RendererWorkbenchWidgetRegistration>,
  locale = "en"
): ResolvedWorkbenchWidget[] {
  const coreById = new Map(coreWidgets.map((w) => [w.id, w]));
  const enabledPluginIds = collectPluginWidgetIds(plugins, true);
  const allPluginIds = collectPluginWidgetIds(plugins, false);

  const seen = new Set<string>();
  const result: ResolvedWorkbenchWidget[] = [];

  for (const entry of params.widgets) {
    if (seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    const widgetId = widgetEntryWidgetId(entry);
    const instance = {
      instanceId: entry.id,
      params: entry.params ?? EMPTY_PARAMS,
      widgetId,
    };

    const coreDecl = coreById.get(widgetId);
    if (coreDecl) {
      result.push({
        ...(coreDecl.descriptionKey
          ? { description: coreDecl.descriptionKey }
          : {}),
        ...instance,
        configurable: coreDecl.configurable === true,
        multiInstance: coreDecl.multiInstance === true,
        refreshable: coreDecl.refreshable === true,
        registration: coreComponentMap.get(widgetId) ?? null,
        status: "core",
        title: coreDecl.titleKey,
      });
      continue;
    }

    result.push(
      resolvePluginWidget(instance, {
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
  widgetRegistrations: ReadonlyMap<string, RendererWorkbenchWidgetRegistration>;
}

/**
 * 非 core widget 的解析：启用（含加载态）、禁用、已卸载三态。
 * 从 resolveWorkbenchWidgets 主循环抽出，控制单函数认知复杂度。
 */
function resolvePluginWidget(
  instance: {
    instanceId: string;
    params: Readonly<Record<string, JsonValue>>;
    widgetId: string;
  },
  ctx: PluginWidgetResolveCtx
): ResolvedWorkbenchWidget {
  const {
    allPluginIds,
    enabledPluginIds,
    locale,
    plugins,
    widgetRegistrations,
  } = ctx;
  const { widgetId } = instance;
  const declared = findPluginContribution(widgetId, plugins);
  // manifest 本地化标题：启用加载态与禁用态都优先它，胜过裸 id
  const display = declared
    ? resolvePluginWorkbenchWidgetDisplay(
        declared.manifest,
        declared.contribution,
        locale
      )
    : undefined;
  const flags = {
    configurable: declared?.contribution.configurable === true,
    multiInstance: declared?.contribution.multiInstance === true,
    refreshable: declared?.contribution.refreshable === true,
  };

  if (enabledPluginIds.has(widgetId)) {
    const reg = widgetRegistrations.get(widgetId) ?? null;
    return {
      ...(display?.description ? { description: display.description } : {}),
      ...instance,
      ...flags,
      registration: reg,
      status: "plugin-active",
      title: resolveTitle(reg, display?.title ?? widgetId),
    };
  }

  // 禁用态 manifest 仍在，用本地化标题；unknown（插件已卸载）只剩裸 id
  const isDisabled = allPluginIds.has(widgetId);
  return {
    ...instance,
    ...flags,
    registration: null,
    status: isDisabled ? "plugin-disabled" : "unknown",
    title: isDisabled ? (display?.title ?? widgetId) : widgetId,
  };
}
