// RGL v2 CSS（v2 合并了 react-resizable 样式，只需一个 CSS 文件）
import "react-grid-layout/css/styles.css";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@pier/ui/context-menu.tsx";
import type { MissionControlGridSize } from "@shared/contracts/mission-control.ts";
import {
  MISSION_CONTROL_GRID_COLS,
  salvageMissionControlPanelParams,
  widgetEntryWidgetId,
} from "@shared/contracts/mission-control.ts";
import type { IDockviewPanelProps } from "dockview-react";
import i18next from "i18next";
import {
  LayoutDashboard,
  LayoutGrid,
  Lock,
  LockOpen,
  Plus,
  RefreshCw,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import GridLayout, { noCompactor, verticalCompactor } from "react-grid-layout";
import { useContainerWidth } from "@/hooks/use-container-width.ts";
import { usePanelDescriptor } from "@/hooks/use-panel-descriptor.ts";
import { useT } from "@/i18n/use-t.ts";
import {
  getPluginMissionControlWidgetRegistrations,
  getPluginMissionControlWidgetRevision,
  subscribePluginMissionControlWidgetRegistry,
} from "@/lib/plugins/plugin-mission-control-widget-registry.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import {
  CORE_MISSION_CONTROL_WIDGET_COMPONENTS,
  CORE_MISSION_CONTROL_WIDGETS,
} from "./core-mission-control-widgets.ts";
import { MissionControlAddCard } from "./mission-control-add-card.tsx";
import {
  CELL_WIDTH,
  computeAvailableCols,
  deriveLayout,
  entryToLayoutItem,
  gridPixelWidth,
  MARGIN,
  ROW_HEIGHT,
  resolveResponsiveGridSize,
} from "./mission-control-grid-geometry.ts";
import { buildMissionControlLibraryItems } from "./mission-control-library.ts";
import { MissionControlLibraryDialog } from "./mission-control-library-dialog.tsx";
import { resolveMissionControlWidgets } from "./mission-control-merge.ts";
import { MissionControlSettingsSheet } from "./mission-control-settings-sheet.tsx";
import { MissionControlToolbar } from "./mission-control-toolbar.tsx";
import { MissionControlWidgetCard } from "./mission-control-widget-card.tsx";
import {
  findWidgetDeclaration,
  useMissionControlPanelState,
} from "./use-mission-control-panel-state.ts";
import { usePanelVisible } from "./use-panel-visible.ts";

/** 一格占位（格宽 + 水平间距），添加入口尺寸换算用。 */
const GRID_UNIT = CELL_WIDTH + MARGIN[0];

/** 添加卡的展示尺寸：和普通中号物料同宽，窄容器可收缩成轻量入口。 */
const GHOST_PREFERRED_SIZE: MissionControlGridSize = { h: 3, w: 4 };
const GHOST_MIN_SIZE: MissionControlGridSize = { h: 2, w: 2 };

export function MissionControlPanel(props: IDockviewPanelProps) {
  const t = useT();
  usePanelDescriptor(props.api, {
    display: {
      long: t("missionControl.panelTitle"),
      short: t("missionControl.panelTitleShort"),
    },
  });

  const [containerRef, containerWidth] = useContainerWidth();
  const cols = computeAvailableCols(containerWidth);
  const isDerived = cols < MISSION_CONTROL_GRID_COLS;

  // 订阅 widget 注册表变化——捕获 revision 数值作为依赖
  const widgetRevision = useSyncExternalStore(
    subscribePluginMissionControlWidgetRegistry,
    getPluginMissionControlWidgetRevision,
    getPluginMissionControlWidgetRevision
  );

  const plugins = usePluginRegistryStore((s) => s.plugins);

  const params = useMemo(
    () => salvageMissionControlPanelParams(props.params),
    [props.params]
  );
  const locked = params.locked === true;

  const sizeDeclarationsByInstanceId = useMemo(() => {
    const map = new Map<
      string,
      ReturnType<typeof findWidgetDeclaration> | undefined
    >();
    for (const entry of params.widgets) {
      map.set(
        entry.id,
        findWidgetDeclaration(widgetEntryWidgetId(entry), plugins)
      );
    }
    return map;
  }, [params.widgets, plugins]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: widgetRevision is the cache-buster for this mutable Map
  const widgetRegistrations = useMemo(
    // 复制成新 Map：注册表 getter 返回的是同一个被原地修改的实例，直接透传
    // 会让下游 resolved useMemo 因引用相等永不重算（插件晚于首渲注册时
    // widget 卡死在 Loading 态）。
    () => new Map(getPluginMissionControlWidgetRegistrations()),
    [widgetRevision]
  );

  const locale = i18next.language || "en";

  const resolved = useMemo(
    () =>
      resolveMissionControlWidgets(
        params,
        CORE_MISSION_CONTROL_WIDGETS,
        plugins,
        widgetRegistrations,
        CORE_MISSION_CONTROL_WIDGET_COMPONENTS,
        locale
      ),
    [params, plugins, widgetRegistrations, locale]
  );

  const basisLayout = useMemo(
    () =>
      params.widgets.map((entry) =>
        entryToLayoutItem(entry, sizeDeclarationsByInstanceId.get(entry.id))
      ),
    [params.widgets, sizeDeclarationsByInstanceId]
  );

  const getSizeDeclaration = useCallback(
    (instanceId: string) => sizeDeclarationsByInstanceId.get(instanceId),
    [sizeDeclarationsByInstanceId]
  );

  const layout = useMemo(
    () =>
      isDerived
        ? deriveLayout(basisLayout, cols, { getSizeDeclaration })
        : basisLayout,
    [basisLayout, cols, getSizeDeclaration, isDerived]
  );

  const state = useMissionControlPanelState(params, props.api, plugins);
  const visible = usePanelVisible(props.api);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [settingsInstanceId, setSettingsInstanceId] = useState<string | null>(
    null
  );
  const settingsWidget =
    resolved.find((w) => w.instanceId === settingsInstanceId) ?? null;

  const addedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of params.widgets) {
      const widgetId = widgetEntryWidgetId(entry);
      counts.set(widgetId, (counts.get(widgetId) ?? 0) + 1);
    }
    return counts;
  }, [params.widgets]);

  const libraryItems = useMemo(
    () =>
      buildMissionControlLibraryItems({
        addedCounts,
        coreComponentMap: CORE_MISSION_CONTROL_WIDGET_COMPONENTS,
        coreWidgets: CORE_MISSION_CONTROL_WIDGETS,
        locale,
        plugins,
        translate: t,
        widgetRegistrations,
      }),
    [addedCounts, locale, plugins, t, widgetRegistrations]
  );

  // 添加入口尺寸跟随容器列数；位置固定在网格下方，避免承诺自动重排后的落点。
  const ghostSize = useMemo(
    () =>
      resolveResponsiveGridSize(
        GHOST_PREFERRED_SIZE,
        { minSize: GHOST_MIN_SIZE },
        cols
      ),
    [cols]
  );
  const addCardStyle = useMemo(
    () => ({
      height: ghostSize.h * GRID_UNIT - MARGIN[1],
      width: gridPixelWidth(ghostSize.w),
    }),
    [ghostSize]
  );

  // 新添加的卡滚动入视口（高亮环由 data-highlighted 样式承载）
  useEffect(() => {
    if (state.highlightId === null) {
      return;
    }
    const el = document.querySelector(
      `[data-testid="mission-control-widget-${state.highlightId}"]`
    );
    el?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [state.highlightId]);

  const showGhost = !locked && resolved.length > 0;

  return (
    <div
      className={[
        "flex h-full flex-col bg-surface-canvas",
        "[&_.react-grid-placeholder]:rounded-xl! [&_.react-grid-placeholder]:bg-primary/10! [&_.react-grid-placeholder]:opacity-100!",
        "[&_.react-grid-item:hover_.react-resizable-handle]:opacity-100 [&_.react-resizable-handle]:opacity-40",
        // 拖拽中：卡片抬升（阴影加深 + 提层），落点占位框由上面的 placeholder 样式承载
        "[&_.react-grid-item.react-draggable-dragging]:z-30",
        "[&_.react-grid-item.react-draggable-dragging_[data-slot=card]]:shadow-lg",
        // 新添加卡的一次性高亮环
        "[&_[data-highlighted=true]_[data-slot=card]]:ring-2 [&_[data-highlighted=true]_[data-slot=card]]:ring-primary/50",
      ].join(" ")}
    >
      <MissionControlToolbar
        canArrange={resolved.length > 0}
        locked={locked}
        onAdd={() => setLibraryOpen(true)}
        onArrange={state.handleArrangeLayout}
        onRefreshAll={state.refreshAll}
        onToggleLocked={state.handleToggleLocked}
      />
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            // 外边距 = 网格 gutter（MARGIN 12px），四边与卡间距同节奏
            className="flex-1 overflow-auto p-3"
            data-scrollbar="stable"
            ref={containerRef}
          >
            {/* 左对齐（用户定）：左/上/下边距恒等于卡间距 12px，不做居中留白 */}
            <div
              data-testid="mission-control-grid-wrapper"
              style={{ width: gridPixelWidth(cols) }}
            >
              {resolved.length > 0 ? (
                <div>
                  <GridLayout
                    compactor={isDerived ? noCompactor : verticalCompactor}
                    dragConfig={{
                      cancel:
                        "button, a, input, textarea, select, [role='menuitem'], [data-no-drag]",
                      enabled: !locked,
                      handle: ".mission-control-widget-drag-handle",
                    }}
                    gridConfig={{
                      cols,
                      containerPadding: [0, 0],
                      margin: MARGIN,
                      rowHeight: ROW_HEIGHT,
                    }}
                    layout={layout}
                    onLayoutChange={(newLayout) =>
                      state.handleLayoutChange(newLayout, { isDerived, layout })
                    }
                    resizeConfig={{
                      enabled: !locked,
                      handles: locked ? [] : ["se"],
                    }}
                    width={gridPixelWidth(cols)}
                  >
                    {resolved.map((widget) => {
                      const item = layout.find(
                        (layoutItem) => layoutItem.i === widget.instanceId
                      );
                      const size: MissionControlGridSize = {
                        h: item?.h ?? 3,
                        w: item?.w ?? 4,
                      };
                      return (
                        <div
                          data-highlighted={
                            widget.instanceId === state.highlightId
                          }
                          key={widget.instanceId}
                        >
                          <MissionControlWidgetCard
                            locked={locked}
                            onDuplicate={() =>
                              state.handleDuplicate(widget.instanceId)
                            }
                            onOpenSettings={() =>
                              setSettingsInstanceId(widget.instanceId)
                            }
                            onRefresh={() =>
                              state.refreshOne(widget.instanceId)
                            }
                            onRemove={() =>
                              state.handleRemove(widget.instanceId)
                            }
                            refreshToken={
                              state.refreshTokens[widget.instanceId] ?? 0
                            }
                            size={size}
                            updateParams={(patch) =>
                              state.handleUpdateParams(widget.instanceId, patch)
                            }
                            visible={visible}
                            widget={widget}
                          />
                        </div>
                      );
                    })}
                  </GridLayout>
                  {/* 添加入口只负责打开物料库；新物料落点由持久化基准布局决定。 */}
                  {showGhost ? (
                    <div className="mt-3" style={addCardStyle}>
                      <MissionControlAddCard
                        isEmpty={false}
                        onBrowse={() => setLibraryOpen(true)}
                      />
                    </div>
                  ) : null}
                </div>
              ) : (
                <MissionControlAddCard
                  isEmpty
                  locked={locked}
                  onBrowse={() => setLibraryOpen(true)}
                  showAction={!locked}
                />
              )}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-44">
          <ContextMenuItem
            disabled={locked}
            onSelect={() => setLibraryOpen(true)}
          >
            <Plus className="size-4" />
            {t("missionControl.addWidget")}
          </ContextMenuItem>
          <ContextMenuItem onSelect={state.refreshAll}>
            <RefreshCw className="size-4" />
            {t("missionControl.context.refreshAll")}
          </ContextMenuItem>
          <ContextMenuItem
            data-testid="mission-control-arrange-layout"
            disabled={locked || resolved.length === 0}
            onSelect={state.handleArrangeLayout}
          >
            <LayoutGrid className="size-4" />
            {t("missionControl.context.arrangeLayout")}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            data-testid="mission-control-toggle-lock"
            onSelect={state.handleToggleLocked}
          >
            {locked ? (
              <LockOpen className="size-4" />
            ) : (
              <Lock className="size-4" />
            )}
            {locked
              ? t("missionControl.context.unlock")
              : t("missionControl.context.lock")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <MissionControlLibraryDialog
        items={libraryItems}
        onAdd={(widgetId) => {
          state.handleAdd(widgetId);
          setLibraryOpen(false);
        }}
        onOpenChange={setLibraryOpen}
        open={libraryOpen}
      />
      <MissionControlSettingsSheet
        onOpenChange={(open) => {
          if (!open) {
            setSettingsInstanceId(null);
          }
        }}
        updateParams={(patch) => {
          if (settingsInstanceId !== null) {
            state.handleUpdateParams(settingsInstanceId, patch);
          }
        }}
        widget={
          settingsWidget?.registration?.settingsComponent
            ? settingsWidget
            : null
        }
      />
    </div>
  );
}

export const missionControlPanelKit = {
  component: MissionControlPanel,
  icon: LayoutDashboard,
  kind: "web",
} as const;
