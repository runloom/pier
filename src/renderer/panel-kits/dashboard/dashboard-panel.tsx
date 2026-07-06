// RGL v2 CSS (v2 合并了 react-resizable 样式，只需一个 CSS 文件)
import "react-grid-layout/css/styles.css";

import {
  DASHBOARD_GRID_COLS,
  type DashboardGridSize,
  salvageDashboardPanelParams,
} from "@shared/contracts/dashboard.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import type { IDockviewPanelProps } from "dockview-react";
import i18next from "i18next";
import { LayoutDashboard } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import GridLayout, {
  type Layout,
  noCompactor,
  type ResizeHandleAxis,
  verticalCompactor,
} from "react-grid-layout";
import { useContainerWidth } from "@/hooks/use-container-width.ts";
import { usePanelDescriptor } from "@/hooks/use-panel-descriptor.ts";
import { useT } from "@/i18n/use-t.ts";
import {
  getPluginDashboardWidgetRegistrations,
  getPluginDashboardWidgetRevision,
  subscribePluginDashboardWidgetRegistry,
} from "@/lib/plugins/plugin-dashboard-widget-registry.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import {
  CORE_DASHBOARD_WIDGET_COMPONENTS,
  CORE_DASHBOARD_WIDGETS,
} from "./core-dashboard-widgets.ts";
import { DashboardAddCard } from "./dashboard-add-card.tsx";
import {
  appendEntry,
  applyDerivedLayoutChange,
  CELL_WIDTH,
  computeAvailableCols,
  deriveLayout,
  entryToLayoutItem,
  findAddSlot,
  gridPixelWidth,
  layoutToEntries,
  MARGIN,
  ROW_HEIGHT,
} from "./dashboard-grid-geometry.ts";
import { resolveDashboardWidgets } from "./dashboard-merge.ts";
import { DashboardWidgetCard } from "./dashboard-widget-card.tsx";

/** 一格占位（格宽 + 水平间距），幽灵卡像素定位用。 */
const GRID_UNIT = CELL_WIDTH + MARGIN[0];

/**
 * 幽灵添加卡的格子高度：与真卡同行并排时取默认 widget 高度（3 格）对齐底边；
 * 独占一行（x=0 落位，典型于窄单列）时降为 2 格——占位不该比真卡更重。
 */
const GHOST_ROWS_INLINE = 3;
const GHOST_ROWS_OWN_ROW = 2;

/**
 * 自定义 resize 手柄：se 角点阵 grip（唯一可见手柄），s / e 边是隐形热区，
 * hover 热区时浮现 2px 细线。RGL 自带 CSS 用高优先级选择器强加 20×20 尺寸、
 * 旋转与 ::after chevron——此处用 important 工具类与容器级 after:hidden 压制，
 * 否则边手柄会被渲染成旋转 45° 的"圆形 chevron 按钮"。
 */
function renderResizeHandle(
  axis: ResizeHandleAxis,
  ref: Ref<HTMLElement>
): ReactNode {
  const base = `react-resizable-handle react-resizable-handle-${axis} absolute z-10 transition-opacity duration-150 after:hidden`;

  if (axis === "se") {
    return (
      <div
        className={`${base} right-0 bottom-0 size-5 cursor-se-resize`}
        ref={ref as Ref<HTMLDivElement>}
      >
        {/* 经典双斜线 se-resize 图形——点阵在暗色下读作噪点，已弃用 */}
        <svg
          aria-hidden="true"
          className="absolute right-1 bottom-1 size-2.5 text-muted-foreground/40"
          fill="none"
          viewBox="0 0 8 8"
        >
          <path
            d="M7 1L1 7"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.2"
          />
          <path
            d="M7 4.5L4.5 7"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.2"
          />
        </svg>
      </div>
    );
  }

  if (axis === "s") {
    return (
      <div
        className={`${base} group/handle transform-none! right-2 bottom-0 left-2! ml-0! h-2! w-auto! cursor-s-resize`}
        ref={ref as Ref<HTMLDivElement>}
      >
        <div className="absolute inset-x-6 bottom-0.5 h-0.5 rounded-full bg-primary/40 opacity-0 transition-opacity group-hover/handle:opacity-100" />
      </div>
    );
  }

  // axis === "e"
  return (
    <div
      className={`${base} group/handle transform-none! top-2! right-0 bottom-2 mt-0! h-auto! w-2! cursor-e-resize`}
      ref={ref as Ref<HTMLDivElement>}
    >
      <div className="absolute inset-y-6 right-0.5 w-0.5 rounded-full bg-primary/40 opacity-0 transition-opacity group-hover/handle:opacity-100" />
    </div>
  );
}

/** 声明查找：core / 插件 manifest 中找 widget 的尺寸三元组。 */
function findSizeDeclaration(
  id: string,
  plugins: readonly PluginRegistryEntry[]
):
  | {
      defaultSize?: DashboardGridSize | undefined;
      maxSize?: DashboardGridSize | undefined;
      minSize?: DashboardGridSize | undefined;
    }
  | undefined {
  const core = CORE_DASHBOARD_WIDGETS.find((w) => w.id === id);
  if (core) {
    return core;
  }
  for (const entry of plugins) {
    const widget = entry.manifest.dashboardWidgets.find((w) => w.id === id);
    if (widget) {
      return widget;
    }
  }
  return;
}

export function DashboardPanel(props: IDockviewPanelProps) {
  const t = useT();
  usePanelDescriptor(props.api, {
    display: {
      long: t("dashboard.panelTitle"),
      short: t("dashboard.panelTitleShort"),
    },
  });

  const [containerRef, containerWidth] = useContainerWidth();
  const cols = computeAvailableCols(containerWidth);
  const isDerived = cols < DASHBOARD_GRID_COLS;

  // 订阅 widget 注册表变化——捕获 revision 数值作为依赖
  const widgetRevision = useSyncExternalStore(
    subscribePluginDashboardWidgetRegistry,
    getPluginDashboardWidgetRevision,
    getPluginDashboardWidgetRevision
  );

  const plugins = usePluginRegistryStore((s) => s.plugins);

  const params = useMemo(
    () => salvageDashboardPanelParams(props.params),
    [props.params]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: widgetRevision is the cache-buster for this mutable Map
  const widgetRegistrations = useMemo(
    // 复制成新 Map：注册表 getter 返回的是同一个被原地修改的实例，直接透传
    // 会让下游 resolved useMemo 因引用相等永不重算（插件晚于首渲注册时
    // widget 卡死在 Loading 态）。
    () => new Map(getPluginDashboardWidgetRegistrations()),
    [widgetRevision]
  );

  const locale = i18next.language || "en";

  const resolved = useMemo(
    () =>
      resolveDashboardWidgets(
        params,
        CORE_DASHBOARD_WIDGETS,
        plugins,
        widgetRegistrations,
        CORE_DASHBOARD_WIDGET_COMPONENTS,
        locale
      ),
    [params, plugins, widgetRegistrations, locale]
  );

  const basisLayout = useMemo(
    () =>
      params.widgets.map((entry) => {
        const decl = findSizeDeclaration(entry.id, plugins);
        return entryToLayoutItem(entry, decl);
      }),
    [params.widgets, plugins]
  );

  // k<12 进入派生模式：纯函数换行重排，结果只渲染不持久化
  const layout = useMemo(
    () => (isDerived ? deriveLayout(basisLayout, cols) : basisLayout),
    [basisLayout, cols, isDerived]
  );

  const addedIds = useMemo(
    () => new Set(params.widgets.map((w) => w.id)),
    [params.widgets]
  );

  // 幽灵添加卡落位：显示布局的下一个 first-fit 空位（默认卡宽随 k clamp）。
  // 先按 3 格高试放——放得下且与真卡同行（x>0）就对齐底边；
  // 否则按 2 格高独占一行。
  const ghostW = Math.min(4, cols);
  const ghost = useMemo(() => {
    const inlineSlot = findAddSlot(layout, cols, ghostW, GHOST_ROWS_INLINE);
    if (inlineSlot.x > 0) {
      return { rows: GHOST_ROWS_INLINE, slot: inlineSlot };
    }
    return {
      rows: GHOST_ROWS_OWN_ROW,
      slot: findAddSlot(layout, cols, ghostW, GHOST_ROWS_OWN_ROW),
    };
  }, [layout, cols, ghostW]);

  const prevEntriesRef = useRef(JSON.stringify(params.widgets));

  const handleLayoutChange = useCallback(
    (newLayout: Layout) => {
      // 全宽模式：直存基准（原有路径）
      if (!isDerived) {
        const newEntries = layoutToEntries(newLayout);
        const newJson = JSON.stringify(newEntries);
        if (newJson !== prevEntriesRef.current) {
          prevEntriesRef.current = newJson;
          props.api.updateParameters({ widgets: newEntries });
        }
        return;
      }

      // 派生模式：绝不把 k 列坐标写回。resize 差分与拖拽换序的识别
      // 收敛在 applyDerivedLayoutChange 纯函数里，纯回声返回 null。
      const next = applyDerivedLayoutChange(params.widgets, layout, newLayout);
      if (next) {
        prevEntriesRef.current = JSON.stringify(next);
        props.api.updateParameters({ widgets: next });
      }
    },
    [isDerived, layout, params.widgets, props.api]
  );

  const handleAdd = useCallback(
    (widgetId: string) => {
      const decl = findSizeDeclaration(widgetId, plugins);
      const newEntry = appendEntry(params.widgets, widgetId, decl);
      const next = [...params.widgets, newEntry];
      prevEntriesRef.current = JSON.stringify(next);
      props.api.updateParameters({ widgets: next });
    },
    [params.widgets, plugins, props.api]
  );

  const handleRemove = useCallback(
    (widgetId: string) => {
      const next = params.widgets.filter((w) => w.id !== widgetId);
      prevEntriesRef.current = JSON.stringify(next);
      props.api.updateParameters({ widgets: next });
    },
    [params.widgets, props.api]
  );

  return (
    <div
      className={[
        "flex h-full flex-col bg-surface-canvas",
        // RGL 自带 CSS 给 placeholder 强加 background:red + opacity:.2，
        // 同优先级靠加载序生效，必须 important 压制
        "[&_.react-grid-placeholder]:rounded-xl! [&_.react-grid-placeholder]:bg-primary/10! [&_.react-grid-placeholder]:opacity-100!",
        "[&_.react-grid-item:hover_.react-resizable-handle]:opacity-100 [&_.react-resizable-handle]:opacity-0",
        // 拖拽中：卡片抬升（阴影加深 + 提层），落点占位框由上面的 placeholder 样式承载
        "[&_.react-grid-item.react-draggable-dragging]:z-30",
        "[&_.react-grid-item.react-draggable-dragging_[data-slot=card]]:shadow-lg",
      ].join(" ")}
    >
      <div
        // 外边距 = 网格 gutter（MARGIN 12px），四边与卡间距同节奏
        className="flex-1 overflow-auto p-3"
        data-scrollbar="stable"
        ref={containerRef}
      >
        {/* 左对齐（用户定）：左/上/下边距恒等于卡间距 12px，不做居中留白 */}
        <div
          data-testid="dashboard-grid-wrapper"
          style={{ width: gridPixelWidth(cols) }}
        >
          {resolved.length > 0 ? (
            <div
              className="relative"
              style={{
                minHeight: (ghost.slot.y + ghost.rows) * GRID_UNIT - MARGIN[1],
              }}
            >
              <GridLayout
                // 派生布局保序输出可能带竖向空隙，verticalCompactor 会上提回填
                // 并在挂载时触发"误判为用户拖拽"的写盘，故派生模式禁压实。
                compactor={isDerived ? noCompactor : verticalCompactor}
                dragConfig={{
                  // 整卡可拖（对齐主流仪表盘直觉：抓哪里都能拖），交互元素豁免。
                  // 不再限定 header 把手——用户第一反应是抓卡片身体，抓不动
                  // 会被感知为"拖拽坏了"。[data-no-drag] 是 widget 体内的逃生舱。
                  cancel:
                    "button, a, input, textarea, select, [role='menuitem'], [data-no-drag]",
                }}
                gridConfig={{
                  cols,
                  containerPadding: [0, 0],
                  margin: MARGIN,
                  rowHeight: ROW_HEIGHT,
                }}
                layout={layout}
                onLayoutChange={handleLayoutChange}
                resizeConfig={{
                  handleComponent: renderResizeHandle,
                  handles: ["se", "s", "e"],
                }}
                width={gridPixelWidth(cols)}
              >
                {resolved.map((widget) => {
                  const item = layout.find((l) => l.i === widget.id);
                  const size: DashboardGridSize = item
                    ? { h: item.h, w: item.w }
                    : { h: 3, w: 4 };
                  return (
                    <div key={widget.id}>
                      <DashboardWidgetCard
                        onRemove={() => handleRemove(widget.id)}
                        size={size}
                        widget={widget}
                      />
                    </div>
                  );
                })}
              </GridLayout>
              {/* 幽灵添加卡占据网格的下一个空位，而非横贯底部 */}
              <div
                className="absolute"
                style={{
                  height: ghost.rows * GRID_UNIT - MARGIN[1],
                  left: ghost.slot.x * GRID_UNIT,
                  top: ghost.slot.y * GRID_UNIT,
                  width: gridPixelWidth(ghostW),
                }}
              >
                <DashboardAddCard
                  addedIds={addedIds}
                  coreWidgetRegistrations={CORE_DASHBOARD_WIDGET_COMPONENTS}
                  coreWidgets={CORE_DASHBOARD_WIDGETS}
                  isEmpty={false}
                  onAdd={handleAdd}
                  plugins={plugins}
                  widgetRegistrations={widgetRegistrations}
                />
              </div>
            </div>
          ) : (
            <DashboardAddCard
              addedIds={addedIds}
              coreWidgetRegistrations={CORE_DASHBOARD_WIDGET_COMPONENTS}
              coreWidgets={CORE_DASHBOARD_WIDGETS}
              isEmpty
              onAdd={handleAdd}
              plugins={plugins}
              widgetRegistrations={widgetRegistrations}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export const dashboardPanelKit = {
  component: DashboardPanel,
  icon: LayoutDashboard,
  kind: "web",
} as const;
