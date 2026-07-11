// RGL v2 CSS（v2 合并了 react-resizable 样式，只需一个 CSS 文件）
import "react-grid-layout/css/styles.css";
import type {
  MissionControlGridSize,
  MissionControlPanelWidgetEntry,
} from "@shared/contracts/mission-control.ts";
import {
  HOST_MAX_WIDGET_SIZE,
  HOST_MIN_WIDGET_SIZE,
  widgetEntryWidgetId,
} from "@shared/contracts/mission-control.ts";
import type { IDockviewPanelProps } from "dockview-react";
import i18next from "i18next";
import { LayoutDashboard } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import GridLayout from "react-grid-layout";
import { useContainerSize } from "@/hooks/use-container-size.ts";
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
import { useMissionControlContextMenu } from "./mission-control-context-menu.ts";
import { MARGIN, ROW_HEIGHT } from "./mission-control-grid-geometry.ts";
import { applyKeyboardLayoutChange } from "./mission-control-keyboard-layout.ts";
import { buildMissionControlLibraryItems } from "./mission-control-library.ts";
import { MissionControlLibraryDialog } from "./mission-control-library-dialog.tsx";
import { resolveMissionControlWidgets } from "./mission-control-merge.ts";
import { resolveResponsiveGridCols } from "./mission-control-ordered-layout.ts";
import {
  MISSION_CONTROL_GRID_CONTAINER_PADDING,
  MISSION_CONTROL_ORDERED_GRID_COMPACTOR,
  missionControlPreviewTransform,
} from "./mission-control-rgl-adapter.ts";
import { MissionControlSettingsDialog } from "./mission-control-settings-dialog.tsx";
import { MissionControlWidgetCard } from "./mission-control-widget-card.tsx";
import { useMissionControlGridInteractions } from "./use-mission-control-grid-interactions.ts";
import {
  findWidgetDeclaration,
  useMissionControlPanelState,
} from "./use-mission-control-panel-state.ts";
import { usePanelVisible } from "./use-panel-visible.ts";

const ADD_TILE_ID = "mission-control-add";
const ADD_TILE_ENTRY: MissionControlPanelWidgetEntry = {
  h: 1,
  id: ADD_TILE_ID,
  w: 2,
};
const ADD_TILE_DECLARATION = {
  maxSize: { h: 1, w: 2 },
  minSize: { h: 1, w: 1 },
};

export function MissionControlPanel(props: IDockviewPanelProps) {
  const t = useT();
  usePanelDescriptor(props.api, {
    display: {
      long: t("missionControl.panelTitle"),
      short: t("missionControl.panelTitleShort"),
    },
  });

  const widgetRevision = useSyncExternalStore(
    subscribePluginMissionControlWidgetRegistry,
    getPluginMissionControlWidgetRevision,
    getPluginMissionControlWidgetRevision
  );
  const plugins = usePluginRegistryStore((store) => store.plugins);
  const state = useMissionControlPanelState(props.params, props.api, plugins);
  const { optimisticParams } = state;
  const [containerRef, viewport] = useContainerSize();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [settingsInstanceId, setSettingsInstanceId] = useState<string | null>(
    null
  );
  const [layoutAnnouncement, setLayoutAnnouncement] = useState({
    message: "",
    sequence: 0,
  });
  const visible = usePanelVisible(props.api);
  const gridWrapperRef = useRef<HTMLElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: widgetRevision invalidates the registry's mutable Map
  const widgetRegistrations = useMemo(
    () => new Map(getPluginMissionControlWidgetRegistrations()),
    [widgetRevision]
  );
  const locale = i18next.language || "en";
  const resolved = useMemo(
    () =>
      resolveMissionControlWidgets(
        optimisticParams,
        CORE_MISSION_CONTROL_WIDGETS,
        plugins,
        widgetRegistrations,
        CORE_MISSION_CONTROL_WIDGET_COMPONENTS,
        locale
      ),
    [optimisticParams, plugins, widgetRegistrations, locale]
  );
  const addedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of optimisticParams.widgets) {
      const widgetId = widgetEntryWidgetId(entry);
      counts.set(widgetId, (counts.get(widgetId) ?? 0) + 1);
    }
    return counts;
  }, [optimisticParams.widgets]);
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
  const settingsWidget =
    resolved.find((widget) => widget.instanceId === settingsInstanceId) ?? null;
  const nativeMenu = useMissionControlContextMenu({
    hasWidgets: resolved.length > 0,
    onAddWidget: () => setLibraryOpen(true),
    onRefreshAll: state.refreshAll,
  });

  const cols = resolveResponsiveGridCols(viewport.width);
  const declarationsByInstanceId = useMemo(
    () =>
      new Map(
        optimisticParams.widgets.map((entry) => [
          entry.id,
          findWidgetDeclaration(widgetEntryWidgetId(entry), plugins),
        ])
      ),
    [optimisticParams.widgets, plugins]
  );
  const getSizeDeclaration = useCallback(
    (instanceId: string) =>
      instanceId === ADD_TILE_ID
        ? ADD_TILE_DECLARATION
        : declarationsByInstanceId.get(instanceId),
    [declarationsByInstanceId]
  );
  const {
    dragPreviewHeight,
    dragPreviewOffsets,
    handleDragMove,
    handleDragStop,
    handleResizeMove,
    handleResizeStop,
    renderedLayout,
  } = useMissionControlGridInteractions({
    cols,
    getSizeDeclaration,
    onReorder: state.handleReorder,
    onResize: state.handleResize,
    trailingEntry: ADD_TILE_ENTRY,
    trailingStatic: true,
    viewportWidth: viewport.width,
    widgets: optimisticParams.widgets,
  });

  useEffect(() => {
    if (state.highlightId === null) return;
    const frame = window.requestAnimationFrame(() => {
      const root = gridWrapperRef.current;
      if (!root) return;
      const item = [
        ...root.querySelectorAll("[data-mission-control-instance-id]"),
      ].find(
        (candidate) =>
          candidate instanceof HTMLElement &&
          candidate.dataset.missionControlInstanceId === state.highlightId
      );
      const card = item?.querySelector("[data-slot='card']");
      if (card instanceof HTMLElement) {
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [state.highlightId]);

  const announceLayoutChange = useCallback(
    (kind: "move" | "resize", title: string) => {
      setLayoutAnnouncement((current) => ({
        message: t(
          kind === "resize"
            ? "missionControl.widget.resized"
            : "missionControl.widget.moved",
          { title }
        ),
        sequence: current.sequence + 1,
      }));
    },
    [t]
  );
  const handleLayoutKeyDown = useCallback(
    (
      event: KeyboardEvent<HTMLButtonElement>,
      instanceId: string,
      title: string
    ) => {
      const entry = optimisticParams.widgets.find(
        (candidate) => candidate.id === instanceId
      );
      if (!entry) return;
      const declaration = findWidgetDeclaration(
        widgetEntryWidgetId(entry),
        plugins
      );
      const change = applyKeyboardLayoutChange(
        optimisticParams.widgets,
        instanceId,
        event.key,
        event.shiftKey,
        {
          max: declaration?.maxSize ?? HOST_MAX_WIDGET_SIZE,
          min: declaration?.minSize ?? HOST_MIN_WIDGET_SIZE,
        }
      );
      if (!change) return;
      if (change.kind === "move") {
        const targetIndex = change.widgets.findIndex(
          (candidate) => candidate.id === instanceId
        );
        state.handleReorder(instanceId, targetIndex);
      } else {
        const resized = change.widgets.find(
          (candidate) => candidate.id === instanceId
        );
        if (resized) {
          state.handleResize(instanceId, { h: resized.h, w: resized.w });
        }
      }
      announceLayoutChange(change.kind, title);
    },
    [
      announceLayoutChange,
      optimisticParams.widgets,
      plugins,
      state.handleReorder,
      state.handleResize,
    ]
  );

  return (
    <div
      className={[
        "flex h-full min-h-0 min-w-0 flex-col bg-surface-canvas",
        "[&_.react-grid-item.react-draggable-dragging]:transition-none [&_.react-grid-item.resizing]:transition-none [&_.react-grid-item]:transition-[transform,width,height] [&_.react-grid-item]:duration-150",
        "[&_.react-grid-placeholder]:rounded-xl! [&_.react-grid-placeholder]:bg-primary/10! [&_.react-grid-placeholder]:opacity-100!",
        "[&_.react-grid-item:hover_.react-resizable-handle]:opacity-100 [&_.react-resizable-handle]:opacity-40",
        "[&_.react-grid-item.react-draggable-dragging]:z-30",
        "[&_.react-grid-item.react-draggable-dragging_[data-slot=card]]:shadow-lg",
        "[&_[data-highlighted=true]_[data-slot=card]]:ring-2 [&_[data-highlighted=true]_[data-slot=card]]:ring-primary/50",
      ].join(" ")}
    >
      <div
        className="h-full min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-3 [scrollbar-gutter:stable]"
        data-scrollbar="stable"
        ref={containerRef}
      >
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: the grid captures pointer and keyboard context-menu gestures */}
        <section
          aria-label={t("missionControl.context.canvasLabel")}
          className="min-h-full min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          data-responsive-cols={cols}
          data-testid="mission-control-grid-wrapper"
          onContextMenu={nativeMenu.onContextMenu}
          onKeyDown={nativeMenu.onKeyDown}
          ref={gridWrapperRef}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: focus is required for the grid Shift+F10 native context-menu contract
          tabIndex={0}
        >
          <GridLayout
            compactor={MISSION_CONTROL_ORDERED_GRID_COMPACTOR}
            dragConfig={{
              cancel:
                "button:not(.mission-control-widget-drag-handle), a, input, textarea, select, [role='menuitem'], [data-no-drag]",
              enabled: true,
              handle: ".mission-control-widget-drag-handle",
            }}
            gridConfig={{
              cols,
              containerPadding: MISSION_CONTROL_GRID_CONTAINER_PADDING,
              margin: MARGIN,
              rowHeight: ROW_HEIGHT,
            }}
            layout={renderedLayout}
            onDrag={handleDragMove}
            onDragStop={handleDragStop}
            onLayoutChange={() => undefined}
            onResize={handleResizeMove}
            onResizeStop={handleResizeStop}
            resizeConfig={{ enabled: true, handles: ["se"] }}
            {...(dragPreviewHeight === null
              ? {}
              : { style: { height: `${dragPreviewHeight}px` } })}
            width={Math.max(1, viewport.width)}
          >
            {resolved.map((widget) => {
              const item = renderedLayout.find(
                (candidate) => candidate.i === widget.instanceId
              );
              const size: MissionControlGridSize = {
                h: item?.h ?? 3,
                w: item?.w ?? 4,
              };
              return (
                <div
                  data-highlighted={widget.instanceId === state.highlightId}
                  data-mission-control-instance-id={widget.instanceId}
                  key={widget.instanceId}
                >
                  <div
                    className="h-full transition-transform duration-150"
                    data-mission-control-preview-instance-id={widget.instanceId}
                    style={missionControlPreviewTransform(
                      dragPreviewOffsets.get(widget.instanceId)
                    )}
                  >
                    <MissionControlWidgetCard
                      onDuplicate={() =>
                        state.handleDuplicate(widget.instanceId)
                      }
                      onLayoutKeyDown={(event, title) =>
                        handleLayoutKeyDown(event, widget.instanceId, title)
                      }
                      onOpenSettings={() =>
                        setSettingsInstanceId(widget.instanceId)
                      }
                      onRefresh={() => state.refreshOne(widget.instanceId)}
                      onRemove={() => state.handleRemove(widget.instanceId)}
                      refreshToken={state.refreshTokens[widget.instanceId] ?? 0}
                      size={size}
                      updateParams={(patch) =>
                        state.handleUpdateParams(widget.instanceId, patch)
                      }
                      visible={visible}
                      widget={widget}
                    />
                  </div>
                </div>
              );
            })}
            <div className="h-full" key={ADD_TILE_ID}>
              <div
                className="h-full transition-transform duration-150"
                data-mission-control-preview-instance-id={ADD_TILE_ID}
                style={missionControlPreviewTransform(
                  dragPreviewOffsets.get(ADD_TILE_ID)
                )}
              >
                <MissionControlAddCard
                  isEmpty={resolved.length === 0}
                  onBrowse={() => setLibraryOpen(true)}
                />
              </div>
            </div>
          </GridLayout>
        </section>
      </div>
      <div aria-live="polite" className="sr-only">
        <span key={layoutAnnouncement.sequence}>
          {layoutAnnouncement.message}
        </span>
      </div>
      <MissionControlLibraryDialog
        items={libraryItems}
        onAdd={(widgetId) => {
          state.handleAdd(widgetId);
          setLibraryOpen(false);
        }}
        onOpenChange={setLibraryOpen}
        open={libraryOpen}
      />
      <MissionControlSettingsDialog
        onOpenChange={(open) => {
          if (!open) setSettingsInstanceId(null);
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
  defaultTitle: "Mission Control",
  icon: LayoutDashboard,
  id: "mission-control",
  kind: "web",
} as const;
