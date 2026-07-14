import type {
  WorkbenchGridSize,
  WorkbenchPanelWidgetEntry,
} from "@shared/contracts/workbench.ts";
import { useCallback, useMemo, useState } from "react";
import type { EventCallback, LayoutItem } from "react-grid-layout";
import {
  MARGIN,
  ROW_HEIGHT,
  type SizeDeclaration,
} from "./workbench-grid-geometry.ts";
import {
  deriveOrderedWorkbenchLayout,
  moveWorkbenchEntry,
  resolveWorkbenchInsertionIndex,
  workbenchLayoutRows,
} from "./workbench-ordered-layout.ts";
import {
  alignTransientGridLayout,
  workbenchPreviewOffset,
} from "./workbench-rgl-adapter.ts";

type LayoutPreview =
  | {
      activeInstanceId: string;
      kind: "drag";
      source: readonly WorkbenchPanelWidgetEntry[];
      targetIndex: number;
      widgets: WorkbenchPanelWidgetEntry[];
    }
  | {
      activeInstanceId: string;
      kind: "resize";
      source: readonly WorkbenchPanelWidgetEntry[];
      widgets: WorkbenchPanelWidgetEntry[];
    };

interface GridInteractionsOptions {
  cols: number;
  getSizeDeclaration(instanceId: string): SizeDeclaration | undefined;
  onReorder(instanceId: string, targetIndex: number): void;
  onResize(instanceId: string, size: WorkbenchGridSize): void;
  trailingEntry: WorkbenchPanelWidgetEntry;
  trailingStatic: boolean;
  viewportWidth: number;
  widgets: readonly WorkbenchPanelWidgetEntry[];
}

function gridRowsHeight(rows: number): number {
  if (rows <= 0) return 0;
  return rows * ROW_HEIGHT + (rows - 1) * MARGIN[1];
}

function withTransientSize(
  entries: readonly WorkbenchPanelWidgetEntry[],
  item: LayoutItem
): WorkbenchPanelWidgetEntry[] {
  return entries.map((entry) =>
    entry.id === item.i ? { ...entry, h: item.h, w: item.w } : entry
  );
}

function markTrailingStatic(
  layout: readonly LayoutItem[],
  trailingId: string,
  trailingStatic: boolean
): LayoutItem[] {
  if (!trailingStatic) return [...layout];
  return layout.map((item) =>
    item.i === trailingId ? { ...item, static: true } : item
  );
}

export function useWorkbenchGridInteractions({
  cols,
  getSizeDeclaration,
  onReorder,
  onResize,
  trailingEntry,
  trailingStatic,
  viewportWidth,
  widgets,
}: GridInteractionsOptions) {
  const [layoutPreview, setLayoutPreview] = useState<LayoutPreview | null>(
    null
  );
  const currentLayoutPreview =
    layoutPreview?.source === widgets ? layoutPreview : null;
  // 调整尺寸会改变网格几何；拖拽只改变阅读顺序。活动拖拽期间继续给
  // RGL 稳定的基础布局，避免受控 layout 和 RGL 内部 layout 互相覆盖。
  const renderedWidgets =
    currentLayoutPreview?.kind === "resize"
      ? currentLayoutPreview.widgets
      : widgets;
  const renderedLayout = useMemo(
    () =>
      markTrailingStatic(
        deriveOrderedWorkbenchLayout([...renderedWidgets, trailingEntry], {
          cols,
          getSizeDeclaration,
        }),
        trailingEntry.id,
        trailingStatic
      ),
    [cols, getSizeDeclaration, renderedWidgets, trailingEntry, trailingStatic]
  );
  const dragPreviewLayout = useMemo(() => {
    if (currentLayoutPreview?.kind !== "drag") return null;
    return markTrailingStatic(
      deriveOrderedWorkbenchLayout(
        [...currentLayoutPreview.widgets, trailingEntry],
        { cols, getSizeDeclaration }
      ),
      trailingEntry.id,
      trailingStatic
    );
  }, [
    cols,
    currentLayoutPreview,
    getSizeDeclaration,
    trailingEntry,
    trailingStatic,
  ]);
  const dragPreviewOffsets = useMemo(() => {
    const offsets = new Map<string, { x: number; y: number }>();
    if (!dragPreviewLayout || currentLayoutPreview?.kind !== "drag") {
      return offsets;
    }
    const previewById = new Map(
      dragPreviewLayout.map((item) => [item.i, item])
    );
    for (const baseItem of renderedLayout) {
      if (baseItem.i === currentLayoutPreview.activeInstanceId) continue;
      const previewItem = previewById.get(baseItem.i);
      if (!previewItem) continue;
      const offset = workbenchPreviewOffset(baseItem, previewItem, {
        cols,
        viewportWidth,
      });
      if (offset) offsets.set(baseItem.i, offset);
    }
    return offsets;
  }, [
    cols,
    currentLayoutPreview,
    dragPreviewLayout,
    renderedLayout,
    viewportWidth,
  ]);
  const dragPreviewHeight = dragPreviewLayout
    ? gridRowsHeight(
        Math.max(
          workbenchLayoutRows(renderedLayout),
          workbenchLayoutRows(dragPreviewLayout)
        )
      )
    : null;
  const resizePreview =
    layoutPreview?.kind === "resize" &&
    widgets.some((entry) => entry.id === layoutPreview.activeInstanceId)
      ? {
          instanceId: layoutPreview.activeInstanceId,
          size: layoutPreview.widgets.find(
            (entry) => entry.id === layoutPreview.activeInstanceId
          ),
        }
      : null;
  const resolveInsertionIndex = useCallback(
    (activeItem: LayoutItem) =>
      resolveWorkbenchInsertionIndex(widgets, {
        activeItem,
        cols,
        getSizeDeclaration,
        instanceId: activeItem.i,
      }),
    [cols, getSizeDeclaration, widgets]
  );
  const handleDragMove = useCallback<EventCallback>(
    (_layout, _oldItem, activeItem) => {
      if (!activeItem) return;
      const targetIndex = resolveInsertionIndex(activeItem);
      if (targetIndex < 0) return;
      setLayoutPreview((current) => {
        if (
          current?.kind === "drag" &&
          current.source === widgets &&
          current.activeInstanceId === activeItem.i &&
          current.targetIndex === targetIndex
        ) {
          return current;
        }
        return {
          activeInstanceId: activeItem.i,
          kind: "drag",
          source: widgets,
          targetIndex,
          widgets: moveWorkbenchEntry(widgets, activeItem.i, targetIndex),
        };
      });
    },
    [resolveInsertionIndex, widgets]
  );
  const handleDragStop = useCallback<EventCallback>(
    (transientLayout, _oldItem, activeItem) => {
      if (activeItem) {
        const targetIndex = resolveInsertionIndex(activeItem);
        if (targetIndex >= 0) {
          const nextWidgets = moveWorkbenchEntry(
            widgets,
            activeItem.i,
            targetIndex
          );
          const canonicalLayout = deriveOrderedWorkbenchLayout(
            [...nextWidgets, trailingEntry],
            { cols, getSizeDeclaration }
          );
          // RGL 会在回调返回后把 transientLayout 写回内部状态。先将其
          // 对齐到同一个有序结果，覆盖“顺序未变化但指针落在别处”的情况。
          alignTransientGridLayout(transientLayout, canonicalLayout);
          onReorder(activeItem.i, targetIndex);
        }
      }
      setLayoutPreview(null);
    },
    [
      cols,
      getSizeDeclaration,
      onReorder,
      resolveInsertionIndex,
      trailingEntry,
      widgets,
    ]
  );
  const handleResizeMove = useCallback<EventCallback>(
    (_layout, _oldItem, activeItem) => {
      if (!activeItem) return;
      setLayoutPreview({
        activeInstanceId: activeItem.i,
        kind: "resize",
        source: widgets,
        widgets: withTransientSize(widgets, activeItem),
      });
    },
    [widgets]
  );
  const handleResizeStop = useCallback<EventCallback>(
    (_layout, _oldItem, activeItem) => {
      if (activeItem) {
        onResize(activeItem.i, { h: activeItem.h, w: activeItem.w });
      }
      setLayoutPreview(null);
    },
    [onResize]
  );

  return {
    dragPreviewHeight,
    dragPreviewOffsets,
    handleDragMove,
    handleDragStop,
    handleResizeMove,
    handleResizeStop,
    renderedLayout,
    resizePreview,
  };
}
