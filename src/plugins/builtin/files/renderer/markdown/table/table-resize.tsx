import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clampColumnWidth,
  readTableWidths,
  resetTableColumnWidth,
  TABLE_MIN_COLUMN_WIDTH_PX,
  TABLE_WIDTHS_CHANGED_EVENT,
  writeTableColumnWidth,
} from "./table-width-preferences.ts";

/** 竖分割线的拖拽命中带（分割线两侧各此像素）。 */
const RESIZE_HIT_TOLERANCE_PX = 6;

export interface TableColumnResizeHeadProps {
  onDoubleClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

export interface TableColumnResizeWrapProps {
  onLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

/** 全列指示线几何：x = 列左缘 + clamp 后宽度；top/height 取自表格矩形。 */
export interface DragLineGeometry {
  height: number;
  top: number;
  x: number;
}

export interface TableColumnResizeState {
  colgroup: ReactNode;
  dragLine: DragLineGeometry | null;
  headProps: (columnIndex: number) => TableColumnResizeHeadProps;
  /** null = 表格处于 auto 自适应（无任何自定义宽度） */
  widths: Record<string, number> | null;
  wrapProps: TableColumnResizeWrapProps;
}

export function useTableColumnResize(input: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  tableRef: React.RefObject<HTMLTableElement | null>;
  sourcePath: string | undefined;
  contentHash: string;
  columnCount: number;
}): TableColumnResizeState {
  const { containerRef, tableRef, sourcePath, contentHash, columnCount } =
    input;
  const resizable = Boolean(sourcePath) && contentHash.length > 0;
  const [widths, setWidths] = useState<Record<string, number> | null>(() =>
    sourcePath ? readTableWidths(sourcePath, contentHash) : null
  );
  const [dragLine, setDragLine] = useState<DragLineGeometry | null>(null);
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  // Sync from cross-instance writes (other preview tabs, storage events).
  useEffect(() => {
    if (!sourcePath) return;
    const sync = () => setWidths(readTableWidths(sourcePath, contentHash));
    window.addEventListener(TABLE_WIDTHS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(TABLE_WIDTHS_CHANGED_EVENT, sync);
  }, [sourcePath, contentHash]);

  const persist = useCallback(
    (columnIndex: number, widthPx: number) => {
      if (!sourcePath) return;
      writeTableColumnWidth({ sourcePath, contentHash, columnIndex, widthPx });
    },
    [sourcePath, contentHash]
  );

  const resetColumn = useCallback(
    (columnIndex: number) => {
      if (!sourcePath) return;
      resetTableColumnWidth(sourcePath, contentHash, columnIndex);
    },
    [sourcePath, contentHash]
  );

  /** 命中测试：指针是否落在某单元格右缘分割线的命中带内。 */
  const hitColumnBoundary = useCallback(
    (
      event: ReactPointerEvent<HTMLDivElement>
    ): { cell: HTMLTableCellElement; columnIndex: number } | null => {
      const target = event.target;
      if (!(target instanceof Element)) return null;
      // 表头把手全域即命中：把手横跨边框两侧（right: -5px），抓外侧一半时
      // 指针已越过 th 右缘，几何带测试会漏掉它（表头"有时拖不动"的根因）。
      const handle = target.closest(".md-col-resizer");
      if (handle?.parentElement instanceof HTMLTableCellElement) {
        const th = handle.parentElement;
        if (th.cellIndex >= 0) return { cell: th, columnIndex: th.cellIndex };
      }
      const cell = target.closest("td, th");
      if (!(cell instanceof HTMLTableCellElement)) return null;
      const columnIndex = cell.cellIndex;
      if (columnIndex < 0) return null;
      const rect = cell.getBoundingClientRect();
      // 右缘命中带（格内）。
      const fromRight = rect.right - event.clientX;
      if (fromRight >= 0 && fromRight <= RESIZE_HIT_TOLERANCE_PX) {
        return { cell, columnIndex };
      }
      // 左缘命中带（非首列）：分割线归属前一列的右缘，使命中带对边框对称。
      const fromLeft = event.clientX - rect.left;
      if (
        columnIndex > 0 &&
        fromLeft >= 0 &&
        fromLeft <= RESIZE_HIT_TOLERANCE_PX
      ) {
        const prev = cell.previousElementSibling;
        if (prev instanceof HTMLTableCellElement && prev.cellIndex >= 0) {
          return { cell: prev, columnIndex: prev.cellIndex };
        }
      }
      return null;
    },
    []
  );

  const measureLine = useCallback(
    (columnLeft: number, widthPx: number): DragLineGeometry => {
      const wrap = containerRef.current;
      const table = tableRef.current;
      const wrapRect = wrap?.getBoundingClientRect();
      const tableRect = table?.getBoundingClientRect();
      return {
        height: tableRect?.height ?? 0,
        // 线几何取自表格矩形：精确贴合表格高度，不含滚动条槽。
        top: tableRect && wrapRect ? tableRect.top - wrapRect.top : 0,
        x: columnLeft + widthPx,
      };
    },
    [containerRef, tableRef]
  );

  const wrapProps = useMemo<TableColumnResizeWrapProps>(
    () => ({
      onPointerDown: (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if (!resizable) return;
        const wrap = containerRef.current;
        const hit = hitColumnBoundary(event);
        if (!hit || wrap === null) return;
        wrap.setPointerCapture(event.pointerId);
        const { cell, columnIndex } = hit;
        const wrapRect = wrap.getBoundingClientRect();
        const cellRect = cell.getBoundingClientRect();
        const startWidth =
          widthsRef.current?.[String(columnIndex)] ??
          cellRect.width ??
          TABLE_MIN_COLUMN_WIDTH_PX;
        const columnLeft = cellRect.left - wrapRect.left + wrap.scrollLeft;
        // 拖拽状态存 wrap dataset（closure-free，跨 re-render 稳定）。
        wrap.dataset.mdDragStartX = String(event.clientX);
        wrap.dataset.mdDragStartWidth = String(startWidth);
        wrap.dataset.mdDragColumn = String(columnIndex);
        wrap.dataset.mdDragColumnLeft = String(columnLeft);
        // 拖拽期间抑制 th:has 边框高亮（CSS 读此属性），只留全列指示线。
        wrap.setAttribute("data-md-resizing", "");
        setDragLine(measureLine(columnLeft, startWidth));
      },
      onPointerMove: (event) => {
        const wrap = containerRef.current;
        if (!wrap) return;
        const {
          mdDragStartX,
          mdDragStartWidth,
          mdDragColumn,
          mdDragColumnLeft,
        } = wrap.dataset;
        if (mdDragStartX === undefined) {
          // 非拖拽：整条竖分割线 hover 命中时给 col-resize 光标。
          if (resizable) {
            wrap.style.cursor = hitColumnBoundary(event) ? "col-resize" : "";
          }
          return;
        }
        const startWidth = Number(mdDragStartWidth);
        if (!Number.isFinite(startWidth)) return;
        // 线与边框同源：columnLeft + clamp 后宽度，触底/渲染滞后不分叉。
        const newWidth = clampColumnWidth(
          startWidth + event.clientX - Number(mdDragStartX)
        );
        persist(Number(mdDragColumn), newWidth);
        setDragLine(measureLine(Number(mdDragColumnLeft), newWidth));
      },
      onLostPointerCapture: () => {
        const wrap = containerRef.current;
        if (!wrap) return;
        delete wrap.dataset.mdDragStartX;
        delete wrap.dataset.mdDragStartWidth;
        delete wrap.dataset.mdDragColumn;
        delete wrap.dataset.mdDragColumnLeft;
        wrap.removeAttribute("data-md-resizing");
        wrap.style.cursor = "";
        setDragLine(null);
      },
    }),
    [containerRef, hitColumnBoundary, measureLine, persist, resizable]
  );

  const headProps = useCallback(
    (columnIndex: number): TableColumnResizeHeadProps => ({
      onDoubleClick: (event: ReactMouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
        resetColumn(columnIndex);
      },
      onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        // 无存储宽度时以渲染宽度为种子（与拖拽起点同源），否则键盘路径
        // 在首次使用时静默无效。
        const current =
          widthsRef.current?.[String(columnIndex)] ??
          event.currentTarget.closest("th")?.getBoundingClientRect().width ??
          TABLE_MIN_COLUMN_WIDTH_PX;
        const delta = event.key === "ArrowLeft" ? -16 : 16;
        persist(columnIndex, clampColumnWidth(current + delta));
      },
    }),
    [persist, resetColumn]
  );

  const colgroup = useMemo(() => {
    if (!widths || Object.keys(widths).length === 0) return null;
    return (
      <colgroup>
        {Array.from({ length: columnCount }, (_, index) => (
          <col
            // biome-ignore lint/suspicious/noArrayIndexKey: 列序即身份,colgroup 只读且随 widths 整体重建。
            key={index}
            style={
              widths[String(index)]
                ? { width: widths[String(index)] }
                : undefined
            }
          />
        ))}
      </colgroup>
    );
  }, [columnCount, widths]);

  return { widths, colgroup, headProps, wrapProps, dragLine };
}

/**
 * 透明热区叠在 th 右缘 border 上，hover/focus 时边框线亮起。
 * 指针拖拽由 wrap 级委托处理（整条竖分割线都可拖，不止表头）；
 * 把手保留键盘（方向键 ±16px）与双击重置的可达路径。
 */
export function TableColumnResizeHandle(props: {
  ariaLabel: string;
  head: (columnIndex: number) => TableColumnResizeHeadProps;
  columnIndex: number;
  /** 当前列宽（px）；无自定义宽度时 undefined，回退最小宽度。 */
  width: number | undefined;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: interactive column-resize grab handle; no native element combines separator semantics with pointer drag.
    <div
      {...props.head(props.columnIndex)}
      aria-label={props.ariaLabel}
      aria-orientation="vertical"
      aria-valuemin={TABLE_MIN_COLUMN_WIDTH_PX}
      aria-valuenow={props.width ?? TABLE_MIN_COLUMN_WIDTH_PX}
      className="md-col-resizer"
      role="separator"
      tabIndex={0}
    />
  );
}
