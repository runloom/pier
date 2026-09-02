import {
  type CSSProperties,
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
import { hitColumnBoundary } from "./table-resize-hit.ts";
import {
  clampColumnWidth,
  isTableWidthsStorageKey,
  readTableWidths,
  resetTableWidths,
  TABLE_MAX_COLUMN_WIDTH_PX,
  TABLE_MIN_COLUMN_WIDTH_PX,
  TABLE_WIDTHS_CHANGED_EVENT,
  writeTableColumnWidths,
} from "./table-width-preferences.ts";

export interface TableColumnResizeHeadProps {
  onDoubleClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

export interface TableColumnResizeWrapProps {
  onLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

/** 全列指示线几何：x 覆盖被拖列右缘边框像素；top/height 取自表格矩形。 */
export interface DragLineGeometry {
  height: number;
  top: number;
  x: number;
}

export interface TableColumnResizeState {
  colgroup: ReactNode;
  dragLine: DragLineGeometry | null;
  headProps: (columnIndex: number) => TableColumnResizeHeadProps;
  /**
   * 自定义宽度存在时锁定 fixed 布局；全列覆盖时表宽 = Σ列宽（TanStack /
   * Notion 模型），拖某列只改该列、其余列宽保持不变。undefined = auto 自适应。
   */
  tableStyle: CSSProperties | undefined;
  /** null = 表格处于 auto 自适应（无任何自定义宽度） */
  widths: Record<string, number> | null;
  wrapProps: TableColumnResizeWrapProps;
}

interface DragSession {
  columnIndex: number;
  columnLeft: number;
  current: Record<string, number>;
  dirty: boolean;
  frozen: Record<string, number>;
  onKeyDown: (event: KeyboardEvent) => void;
  pointerId: number;
  preDragWidths: Record<string, number> | null;
  sourcePath: string;
  startWidth: number;
  startX: number;
  widthsKey: string;
}

/** 存储是否覆盖了每一列（旧版本只存被拖过的列，属于部分覆盖）。 */
function isCompleteCoverage(
  widths: Record<string, number>,
  columnCount: number
): boolean {
  if (columnCount <= 0) return false;
  for (let index = 0; index < columnCount; index++) {
    if (!widths[String(index)]) return false;
  }
  return true;
}

function clearDragChrome(wrap: HTMLDivElement | null): void {
  if (!wrap) return;
  delete wrap.dataset.mdDragStartX;
  wrap.removeAttribute("data-md-resizing");
  wrap.style.cursor = "";
}

export function useTableColumnResize(input: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  tableRef: React.RefObject<HTMLTableElement | null>;
  sourcePath: string | undefined;
  widthsKey: string;
  columnCount: number;
}): TableColumnResizeState {
  const { containerRef, tableRef, sourcePath, widthsKey, columnCount } = input;
  const resizable = Boolean(sourcePath) && widthsKey.length > 0;
  const [widths, setWidths] = useState<Record<string, number> | null>(() =>
    sourcePath ? readTableWidths(sourcePath, widthsKey) : null
  );
  const [dragLine, setDragLine] = useState<DragLineGeometry | null>(null);
  const widthsRef = useRef(widths);
  widthsRef.current = widths;
  const sourcePathRef = useRef(sourcePath);
  sourcePathRef.current = sourcePath;
  const widthsKeyRef = useRef(widthsKey);
  widthsKeyRef.current = widthsKey;
  const sessionRef = useRef<DragSession | null>(null);

  const persistAll = useCallback(
    (path: string, key: string, nextWidths: Record<string, number>) => {
      writeTableColumnWidths({
        sourcePath: path,
        widthsKey: key,
        widths: nextWidths,
      });
    },
    []
  );

  const resetTable = useCallback(() => {
    if (!sourcePath) return;
    resetTableWidths(sourcePath, widthsKey);
  }, [sourcePath, widthsKey]);

  const endDrag = useCallback(
    (mode: "commit" | "cancel" | "abort") => {
      const session = sessionRef.current;
      if (!session) return;
      sessionRef.current = null;
      window.removeEventListener("keydown", session.onKeyDown, true);
      const wrap = containerRef.current;
      if (wrap?.hasPointerCapture(session.pointerId)) {
        wrap.releasePointerCapture(session.pointerId);
      }
      clearDragChrome(wrap);
      setDragLine(null);
      if (mode === "commit") {
        if (
          session.dirty &&
          sourcePathRef.current === session.sourcePath &&
          widthsKeyRef.current === session.widthsKey
        ) {
          persistAll(session.sourcePath, session.widthsKey, session.current);
        }
        return;
      }
      if (mode === "cancel") setWidths(session.preDragWidths);
    },
    [containerRef, persistAll]
  );

  // 身份变化：重读存储并中止进行中拖拽（不落盘）。同窗 CustomEvent + 跨窗 storage。
  useEffect(() => {
    endDrag("abort");
    setWidths(
      sourcePath && widthsKey.length > 0
        ? readTableWidths(sourcePath, widthsKey)
        : null
    );
    if (!sourcePath) return;
    const sync = () => {
      if (sessionRef.current) return;
      setWidths(readTableWidths(sourcePath, widthsKey));
    };
    const onStorage = (event: StorageEvent) => {
      if (!isTableWidthsStorageKey(event.key)) return;
      sync();
    };
    window.addEventListener(TABLE_WIDTHS_CHANGED_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(TABLE_WIDTHS_CHANGED_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, [endDrag, sourcePath, widthsKey]);

  // 卸载时若拖拽仍 dirty，提交（lostpointercapture 可能赶不上 unmount）。
  useEffect(() => () => endDrag("commit"), [endDrag]);

  /**
   * 首次自定义前的冻结快照：colgroup 必须全列显式，auto→fixed 切换才不会
   * 让未拖过的列被 fixed 算法均分重排（业界同款教训：tiptap#5435 未拖列
   * 缺 <col> 宽导致整表跳动；TanStack 每列恒有 size）。已全列覆盖时直接
   * 返回现存宽度（引用相等 = 无需再冻结）。
   */
  const frozenColumnWidths = useCallback((): Record<string, number> => {
    const current = widthsRef.current;
    if (current && isCompleteCoverage(current, columnCount)) return current;
    const headerCells = tableRef.current?.querySelectorAll("thead th");
    const snapshot: Record<string, number> = {};
    for (let index = 0; index < columnCount; index++) {
      const cell = headerCells?.[index];
      snapshot[String(index)] = clampColumnWidth(
        cell instanceof HTMLElement
          ? cell.getBoundingClientRect().width
          : TABLE_MIN_COLUMN_WIDTH_PX
      );
    }
    return snapshot;
  }, [columnCount, tableRef]);

  const measureLine = useCallback(
    (columnLeft: number, widthPx: number): DragLineGeometry => {
      const wrap = containerRef.current;
      const table = tableRef.current;
      const wrapRect = wrap?.getBoundingClientRect();
      const tableRect = table?.getBoundingClientRect();
      return {
        height: tableRect?.height ?? 0,
        top: tableRect && wrapRect ? tableRect.top - wrapRect.top : 0,
        // 1px 线覆盖被拖列右缘边框像素（border 画在 [right-1, right]）。
        x: columnLeft + widthPx - 1,
      };
    },
    [containerRef, tableRef]
  );

  /** 列左缘 = 表格左缘 + Σ 前序冻结列宽：拖拽全程稳定。 */
  const columnLeftFor = useCallback(
    (frozen: Record<string, number>, columnIndex: number): number => {
      const wrap = containerRef.current;
      const tableRect = tableRef.current?.getBoundingClientRect();
      const wrapRect = wrap?.getBoundingClientRect();
      let left =
        (tableRect && wrapRect ? tableRect.left - wrapRect.left : 0) +
        (wrap?.scrollLeft ?? 0);
      for (let index = 0; index < columnIndex; index++) {
        left += frozen[String(index)] ?? 0;
      }
      return left;
    },
    [containerRef, tableRef]
  );

  const wrapProps = useMemo<TableColumnResizeWrapProps>(
    () => ({
      onPointerDown: (event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if (event.isPrimary === false) return;
        // 并发指针（触控板第二指、笔+鼠）不得覆盖进行中的拖拽会话，
        // 否则旧 session 的 window 级 Escape 监听会泄漏。
        if (sessionRef.current) return;
        if (!(resizable && sourcePathRef.current)) return;
        const wrap = containerRef.current;
        const hit = hitColumnBoundary(event);
        if (!hit || wrap === null) return;
        wrap.setPointerCapture(event.pointerId);
        const frozen = frozenColumnWidths();
        const startWidth =
          frozen[String(hit.columnIndex)] ?? TABLE_MIN_COLUMN_WIDTH_PX;
        const columnLeft = columnLeftFor(frozen, hit.columnIndex);
        const onKeyDown = (keyEvent: KeyboardEvent) => {
          if (keyEvent.key !== "Escape") return;
          keyEvent.preventDefault();
          endDrag("cancel");
        };
        window.addEventListener("keydown", onKeyDown, true);
        sessionRef.current = {
          columnIndex: hit.columnIndex,
          columnLeft,
          current: frozen,
          dirty: false,
          frozen,
          onKeyDown,
          pointerId: event.pointerId,
          preDragWidths: widthsRef.current,
          sourcePath: sourcePathRef.current,
          startWidth,
          startX: event.clientX,
          widthsKey: widthsKeyRef.current,
        };
        wrap.setAttribute("data-md-resizing", "");
        setDragLine(measureLine(columnLeft, startWidth));
      },
      onPointerMove: (event) => {
        const wrap = containerRef.current;
        if (!wrap) return;
        const session = sessionRef.current;
        if (!session) {
          if (resizable) {
            wrap.style.cursor = hitColumnBoundary(event) ? "col-resize" : "";
          }
          return;
        }
        if (event.pointerId !== session.pointerId) return;
        const newWidth = clampColumnWidth(
          session.startWidth + event.clientX - session.startX
        );
        if (Math.abs(newWidth - session.startWidth) < 1 && !session.dirty) {
          setDragLine(measureLine(session.columnLeft, newWidth));
          return;
        }
        // 硬不变量：每次都写完整冻结快照 ∪ 被拖列，禁止局部对象
        // （否则 fixed 布局均分重排，tiptap#5435 同病）。
        const next = {
          ...session.frozen,
          [String(session.columnIndex)]: newWidth,
        };
        session.current = next;
        session.dirty = true;
        setWidths(next);
        setDragLine(measureLine(session.columnLeft, newWidth));
      },
      onLostPointerCapture: (event) => {
        const session = sessionRef.current;
        if (session && event.pointerId !== session.pointerId) return;
        endDrag("commit");
      },
      onPointerCancel: (event) => {
        const session = sessionRef.current;
        if (session && event.pointerId !== session.pointerId) return;
        endDrag("cancel");
      },
    }),
    [
      columnLeftFor,
      containerRef,
      endDrag,
      frozenColumnWidths,
      measureLine,
      resizable,
    ]
  );

  const headProps = useCallback(
    (columnIndex: number): TableColumnResizeHeadProps => ({
      onDoubleClick: (event: ReactMouseEvent<HTMLDivElement>) => {
        event.stopPropagation();
        resetTable();
      },
      onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        if (!sourcePath) return;
        // 指针拖拽进行中禁止键盘落盘：否则 Escape 只回滚内存，
        // 键盘那一笔已写进存储且被 sync 门闩挡住无法纠正。
        if (sessionRef.current) return;
        const frozen = frozenColumnWidths();
        const current =
          frozen[String(columnIndex)] ?? TABLE_MIN_COLUMN_WIDTH_PX;
        const delta = event.key === "ArrowLeft" ? -16 : 16;
        persistAll(sourcePath, widthsKey, {
          ...frozen,
          [String(columnIndex)]: clampColumnWidth(current + delta),
        });
      },
    }),
    [frozenColumnWidths, persistAll, resetTable, sourcePath, widthsKey]
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

  const tableStyle = useMemo<CSSProperties | undefined>(() => {
    if (!widths || Object.keys(widths).length === 0) return;
    if (!isCompleteCoverage(widths, columnCount)) {
      return {
        maxWidth: "none",
        tableLayout: "fixed",
        width: "100%",
      };
    }
    let sum = 0;
    for (let index = 0; index < columnCount; index++) {
      sum += widths[String(index)] ?? 0;
    }
    return { maxWidth: "none", tableLayout: "fixed", width: sum };
  }, [columnCount, widths]);

  return { widths, colgroup, headProps, tableStyle, wrapProps, dragLine };
}

/**
 * 透明热区叠在 th 右缘 border 上，hover/focus 时边框线亮起。
 * 指针拖拽由 wrap 级委托处理（整条竖分割线都可拖，不止表头）；
 * 把手保留键盘（方向键 ±16px）与双击整表恢复自适应的可达路径。
 */
export function TableColumnResizeHandle(props: {
  ariaLabel: string;
  /** auto 自适应态的 aria-valuetext（如「自动宽度」）。 */
  autoValueText: string;
  head: (columnIndex: number) => TableColumnResizeHeadProps;
  columnIndex: number;
  /**
   * 当前列宽（px）；无自定义宽度时 undefined —— valuenow 回退最小值仅为满足
   * separator 必填约束，实际语义由 aria-valuetext 覆盖为「自动宽度」。
   */
  width: number | undefined;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: interactive column-resize grab handle; no native element combines separator semantics with pointer drag.
    <div
      {...props.head(props.columnIndex)}
      aria-label={props.ariaLabel}
      aria-orientation="vertical"
      aria-valuemax={TABLE_MAX_COLUMN_WIDTH_PX}
      aria-valuemin={TABLE_MIN_COLUMN_WIDTH_PX}
      aria-valuenow={props.width ?? TABLE_MIN_COLUMN_WIDTH_PX}
      {...(props.width === undefined
        ? { "aria-valuetext": props.autoValueText }
        : {})}
      className="md-col-resizer"
      role="separator"
      tabIndex={0}
    />
  );
}
