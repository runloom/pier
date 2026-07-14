// RGL v2 CSS（v2 合并了 react-resizable 样式，只需一个 CSS 文件）
import "react-grid-layout/css/styles.css";
import "./workbench-resize-handle.css";
import { Badge } from "@pier/ui/badge.tsx";
import type {
  WorkbenchGridSize,
  WorkbenchPanelWidgetEntry,
} from "@shared/contracts/workbench.ts";
import {
  HOST_MAX_WIDGET_SIZE,
  HOST_MIN_WIDGET_SIZE,
  widgetEntryWidgetId,
} from "@shared/contracts/workbench.ts";
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
  getPluginWorkbenchWidgetRegistrations,
  getPluginWorkbenchWidgetRevision,
  subscribePluginWorkbenchWidgetRegistry,
} from "@/lib/plugins/plugin-workbench-widget-registry.ts";
import { readVersionedSnapshot } from "@/lib/util/read-versioned-snapshot.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import {
  CORE_WORKBENCH_WIDGET_COMPONENTS,
  CORE_WORKBENCH_WIDGETS,
} from "./core-workbench-widgets.ts";
import { usePanelVisible } from "./use-panel-visible.ts";
import { useWorkbenchGridInteractions } from "./use-workbench-grid-interactions.ts";
import {
  findWidgetDeclaration,
  useWorkbenchPanelState,
} from "./use-workbench-panel-state.ts";
import { WorkbenchAddCard } from "./workbench-add-card.tsx";
import { useWorkbenchContextMenu } from "./workbench-context-menu.ts";
import { MARGIN, ROW_HEIGHT } from "./workbench-grid-geometry.ts";
import { applyKeyboardLayoutChange } from "./workbench-keyboard-layout.ts";
import { buildWorkbenchLibraryItems } from "./workbench-library.ts";
import { WorkbenchLibraryDialog } from "./workbench-library-dialog.tsx";
import { resolveWorkbenchWidgets } from "./workbench-merge.ts";
import { resolveResponsiveGridCols } from "./workbench-ordered-layout.ts";
import {
  WORKBENCH_GRID_CONTAINER_PADDING,
  WORKBENCH_ORDERED_GRID_COMPACTOR,
  workbenchPreviewTransform,
} from "./workbench-rgl-adapter.ts";
import { WorkbenchSettingsDialog } from "./workbench-settings-dialog.tsx";
import { WorkbenchWidgetCard } from "./workbench-widget-card.tsx";

const ADD_TILE_ID = "workbench-add";
const ADD_TILE_ENTRY: WorkbenchPanelWidgetEntry = {
  h: 1,
  id: ADD_TILE_ID,
  w: 2,
};
const ADD_TILE_DECLARATION = {
  maxSize: { h: 1, w: 2 },
  minSize: { h: 1, w: 1 },
};

export function WorkbenchPanel(props: IDockviewPanelProps) {
  const t = useT();
  const panelDescriptor = useMemo(
    () => ({
      display: {
        long: t("workbench.panelTitle"),
        short: t("workbench.panelTitleShort"),
      },
    }),
    [t]
  );
  usePanelDescriptor(props.api, panelDescriptor);

  const widgetRevision = useSyncExternalStore(
    subscribePluginWorkbenchWidgetRegistry,
    getPluginWorkbenchWidgetRevision,
    getPluginWorkbenchWidgetRevision
  );
  const plugins = usePluginRegistryStore((store) => store.plugins);
  const state = useWorkbenchPanelState(props.params, props.api, plugins);
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

  const widgetRegistrations = useMemo(
    () =>
      readVersionedSnapshot(
        widgetRevision,
        () => new Map(getPluginWorkbenchWidgetRegistrations())
      ),
    [widgetRevision]
  );
  const locale = i18next.language || "en";
  const resolved = useMemo(
    () =>
      resolveWorkbenchWidgets(
        optimisticParams,
        CORE_WORKBENCH_WIDGETS,
        plugins,
        widgetRegistrations,
        CORE_WORKBENCH_WIDGET_COMPONENTS,
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
      buildWorkbenchLibraryItems({
        addedCounts,
        coreComponentMap: CORE_WORKBENCH_WIDGET_COMPONENTS,
        coreWidgets: CORE_WORKBENCH_WIDGETS,
        locale,
        plugins,
        translate: t,
        widgetRegistrations,
      }),
    [addedCounts, locale, plugins, t, widgetRegistrations]
  );
  const settingsWidget =
    resolved.find((widget) => widget.instanceId === settingsInstanceId) ?? null;
  const nativeMenu = useWorkbenchContextMenu({
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
    resizePreview,
  } = useWorkbenchGridInteractions({
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
        ...root.querySelectorAll("[data-workbench-instance-id]"),
      ].find(
        (candidate) =>
          candidate instanceof HTMLElement &&
          candidate.dataset.workbenchInstanceId === state.highlightId
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
            ? "workbench.widget.resized"
            : "workbench.widget.moved",
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
        "[&_.react-grid-item.react-draggable-dragging]:z-30",
        "[&_.react-grid-item.react-draggable-dragging_[data-slot=card]]:shadow-lg",
        "[&_.react-grid-item.resizing_[data-slot=card]]:ring-2 [&_.react-grid-item.resizing_[data-slot=card]]:ring-ring/50",
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
          aria-label={t("workbench.context.canvasLabel")}
          className="relative min-h-full min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          data-responsive-cols={cols}
          data-testid="workbench-grid-wrapper"
          onContextMenu={nativeMenu.onContextMenu}
          onKeyDown={nativeMenu.onKeyDown}
          ref={gridWrapperRef}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: focus is required for the grid Shift+F10 native context-menu contract
          tabIndex={0}
        >
          {resolved.length === 0 ? (
            <WorkbenchAddCard isEmpty onBrowse={() => setLibraryOpen(true)} />
          ) : (
            <GridLayout
              compactor={WORKBENCH_ORDERED_GRID_COMPACTOR}
              dragConfig={{
                cancel:
                  "button:not(.workbench-widget-drag-handle), a, input, textarea, select, [role='menuitem'], [data-no-drag]",
                enabled: true,
                handle: ".workbench-widget-drag-handle",
              }}
              gridConfig={{
                cols,
                containerPadding: WORKBENCH_GRID_CONTAINER_PADDING,
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
                const size: WorkbenchGridSize = {
                  h: item?.h ?? 3,
                  w: item?.w ?? 4,
                };
                return (
                  <div
                    data-highlighted={widget.instanceId === state.highlightId}
                    data-workbench-instance-id={widget.instanceId}
                    key={widget.instanceId}
                  >
                    <div
                      className="relative h-full transition-transform duration-150"
                      data-workbench-preview-instance-id={widget.instanceId}
                      style={workbenchPreviewTransform(
                        dragPreviewOffsets.get(widget.instanceId)
                      )}
                    >
                      <WorkbenchWidgetCard
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
                      {resizePreview?.instanceId === widget.instanceId &&
                      resizePreview.size ? (
                        <Badge
                          aria-hidden="true"
                          className="pointer-events-none absolute right-3 bottom-3 z-20 tabular-nums"
                          data-testid="workbench-resize-size"
                          size="xs"
                          variant="secondary"
                        >
                          {resizePreview.size.w} × {resizePreview.size.h}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              <div className="h-full" key={ADD_TILE_ID}>
                <div
                  className="h-full transition-transform duration-150"
                  data-workbench-preview-instance-id={ADD_TILE_ID}
                  style={workbenchPreviewTransform(
                    dragPreviewOffsets.get(ADD_TILE_ID)
                  )}
                >
                  <WorkbenchAddCard
                    isEmpty={false}
                    onBrowse={() => setLibraryOpen(true)}
                  />
                </div>
              </div>
            </GridLayout>
          )}
        </section>
      </div>
      <div aria-live="polite" className="sr-only">
        <span key={layoutAnnouncement.sequence}>
          {layoutAnnouncement.message}
        </span>
      </div>
      <WorkbenchLibraryDialog
        items={libraryItems}
        onAdd={(widgetId) => {
          state.handleAdd(widgetId);
          setLibraryOpen(false);
        }}
        onOpenChange={setLibraryOpen}
        open={libraryOpen}
      />
      <WorkbenchSettingsDialog
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

export const workbenchPanelKit = {
  component: WorkbenchPanel,
  defaultTitle: "Workbench",
  icon: LayoutDashboard,
  id: "workbench",
  kind: "web",
} as const;
