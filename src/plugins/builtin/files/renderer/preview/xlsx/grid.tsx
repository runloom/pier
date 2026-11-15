import {
  type Column,
  type ColumnWidths,
  DataGrid,
  type PositionChangeArgs,
} from "react-data-grid";
import "react-data-grid/lib/styles.css";
import {
  type ClipboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FilesTranslate } from "../../i18n.ts";
import { csvColumnLetter } from "../csv/model.ts";
import {
  FILLER_COLUMN_KEY_PREFIX,
  FILLER_ROW_COUNT,
  fillerColumns,
} from "./filler.ts";
import type { XlsxCell } from "./format.ts";
import {
  BASE_CHARACTER_WIDTH_PX,
  BASE_COLUMN_MAX_WIDTH,
  BASE_COLUMN_WIDTH,
  COLUMN_CONTENT_INSET_PX,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  textDisplayWidth,
  XLSX_ROW_HEIGHT_PX,
} from "./layout.ts";
import type { SerializedXlsxSheet } from "./protocol.ts";

const ROW_NUMBER_COLUMN_KEY = "__row";
const ROW_NUMBER_COLUMN_WIDTH = 56;
/** Content-based width estimates only look at the head of the sheet. */
const AUTO_WIDTH_SAMPLE_ROWS = 200;

/** Real data columns are keyed `c<index>`; filler columns are not data. */
const DATA_COLUMN_KEY_PATTERN = /^c(\d+)$/u;

function dataCellColumnIndex(key: string): number | null {
  const match = DATA_COLUMN_KEY_PATTERN.exec(key);
  if (!match) {
    return null;
  }
  const index = Number(match[1]);
  return Number.isSafeInteger(index) ? index : null;
}

interface XlsxGridRow {
  cells: readonly XlsxCell[];
  height: number;
  id: number;
  wrap: boolean;
}

export function XlsxGrid(props: {
  columnWidths: Record<string, number>;
  onColumnWidthsChange: (widths: Record<string, number>) => void;
  sheet: SerializedXlsxSheet;
  t: FilesTranslate;
}) {
  const { columnWidths, onColumnWidthsChange, sheet, t } = props;
  const [active, setActive] = useState<{ key: string; rowIdx: number } | null>(
    null
  );
  const rowHeightsByRow = useMemo(() => {
    const heights = new Map<number, number>();
    for (const entry of sheet.rowHeights) {
      heights.set(entry.row, entry.height);
    }
    return heights;
  }, [sheet.rowHeights]);
  const rows = useMemo<XlsxGridRow[]>(() => {
    const dataRows = sheet.rows.map((cells, index) => {
      const height = Math.max(
        XLSX_ROW_HEIGHT_PX,
        rowHeightsByRow.get(index) ?? XLSX_ROW_HEIGHT_PX
      );
      return {
        cells,
        height,
        id: index,
        wrap: height > XLSX_ROW_HEIGHT_PX,
      };
    });
    const fillerRows = Array.from({ length: FILLER_ROW_COUNT }, (_, index) => ({
      cells: [],
      height: XLSX_ROW_HEIGHT_PX,
      id: sheet.rows.length + index,
      wrap: false,
    }));
    return [...dataRows, ...fillerRows];
  }, [rowHeightsByRow, sheet.rows]);
  // A stable identity keeps react-data-grid from rebuilding the O(rows)
  // row-position map on every click or column drag.
  const rowHeight = useCallback((row: XlsxGridRow) => row.height, []);
  // A cell picked in one worksheet must not follow the user to another sheet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sheet identity is the reset trigger; the effect only clears state.
  useEffect(() => {
    setActive(null);
  }, [sheet]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ scrollbarWidth: 0, width: 0 });
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const updateLayout = () => {
      const grid = element.querySelector<HTMLElement>('[role="grid"]');
      // Filler columns must stop at the real content box; a vertical
      // scrollbar would otherwise push the sheet into horizontal scroll.
      const scrollbarWidth = grid
        ? Math.max(0, grid.offsetWidth - grid.clientWidth)
        : 0;
      const width = element.clientWidth;
      setLayout((current) =>
        current.scrollbarWidth === scrollbarWidth && current.width === width
          ? current
          : { scrollbarWidth, width }
      );
    };
    updateLayout();
    const observer = new ResizeObserver(updateLayout);
    observer.observe(element);
    const grid = element.querySelector<HTMLElement>('[role="grid"]');
    if (grid) {
      observer.observe(grid);
    }
    return () => observer.disconnect();
  }, []);

  const spansByRow = useMemo(() => {
    const spans = new Map<number, Map<number, number>>();
    for (const merge of sheet.merges) {
      let rowSpans = spans.get(merge.row);
      if (!rowSpans) {
        rowSpans = new Map<number, number>();
        spans.set(merge.row, rowSpans);
      }
      rowSpans.set(merge.column, merge.columnSpan);
    }
    return spans;
  }, [sheet.merges]);

  const autoBaseWidths = useMemo(() => {
    const sampleRows = Math.min(sheet.rows.length, AUTO_WIDTH_SAMPLE_ROWS);
    return Array.from({ length: sheet.columnCount }, (_, index) => {
      let widest = 0;
      for (let rowIndex = 0; rowIndex < sampleRows; rowIndex += 1) {
        widest = Math.max(
          widest,
          textDisplayWidth(sheet.rows[rowIndex]?.[index]?.text ?? "")
        );
      }
      return Math.min(
        BASE_COLUMN_MAX_WIDTH,
        Math.max(
          BASE_COLUMN_WIDTH,
          widest * BASE_CHARACTER_WIDTH_PX + COLUMN_CONTENT_INSET_PX
        )
      );
    });
  }, [sheet.columnCount, sheet.rows]);

  const gridColumnWidths = useMemo<ColumnWidths>(
    () =>
      new Map(
        Object.entries(columnWidths).map(([key, width]) => [
          key,
          { type: "resized" as const, width },
        ])
      ),
    [columnWidths]
  );
  const handleColumnWidthsChange = useCallback(
    (widths: ColumnWidths) => {
      const next: Record<string, number> = {};
      for (const [key, value] of widths) {
        if (
          key !== ROW_NUMBER_COLUMN_KEY &&
          !key.startsWith(FILLER_COLUMN_KEY_PREFIX)
        ) {
          next[key] = Math.round(value.width);
        }
      }
      onColumnWidthsChange(next);
    },
    [onColumnWidthsChange]
  );

  // Document `!cols` widths win over estimates; estimates only fill in when
  // the workbook carries no usable widths. Once a sheet has document or
  // persisted widths, the rest stop scaling so resizing the panel cannot
  // reflow columns the document (or the user) set.
  const columns = useMemo<Column<XlsxGridRow>[]>(() => {
    const availableWidth = Math.max(
      0,
      layout.width - ROW_NUMBER_COLUMN_WIDTH - layout.scrollbarWidth
    );
    const baseTotal = autoBaseWidths.reduce((total, width) => total + width, 0);
    const hasDocumentWidths = sheet.columnWidthsPx.some(
      (width) => width !== null
    );
    const fitScale =
      Object.keys(columnWidths).length === 0 &&
      !hasDocumentWidths &&
      availableWidth > 0 &&
      baseTotal > 0
        ? Math.max(1, availableWidth / baseTotal)
        : 1;
    const autoWidth = (index: number) =>
      Math.min(
        BASE_COLUMN_MAX_WIDTH,
        Math.max(
          BASE_COLUMN_WIDTH,
          Math.floor((autoBaseWidths[index] ?? BASE_COLUMN_WIDTH) * fitScale)
        )
      );
    const rowNumberColumn: Column<XlsxGridRow> = {
      cellClass: "pier-csv-rownum",
      editable: false,
      frozen: true,
      key: ROW_NUMBER_COLUMN_KEY,
      maxWidth: ROW_NUMBER_COLUMN_WIDTH,
      minWidth: ROW_NUMBER_COLUMN_WIDTH,
      name: "",
      renderCell: ({ rowIdx }) => (
        <span className="block h-full w-full text-right tabular-nums">
          {sheet.startRow + rowIdx + 1}
        </span>
      ),
      resizable: false,
      width: ROW_NUMBER_COLUMN_WIDTH,
    };
    const dataWidths = Array.from({ length: sheet.columnCount }, (_, index) =>
      Math.round(
        columnWidths[`c${index}`] ??
          sheet.columnWidthsPx[index] ??
          autoWidth(index)
      )
    );
    const dataColumns = dataWidths.map(
      (width, index): Column<XlsxGridRow> => ({
        colSpan: (args) =>
          args.type === "ROW"
            ? spansByRow.get(args.row.id)?.get(index)
            : undefined,
        editable: false,
        key: `c${index}`,
        maxWidth: MAX_COLUMN_WIDTH,
        minWidth: MIN_COLUMN_WIDTH,
        name: csvColumnLetter(sheet.startColumn + index),
        renderCell: ({ row }) => {
          const cell = row.cells[index];
          return (
            <span
              className={
                row.wrap
                  ? "block h-full w-full whitespace-pre-wrap break-words"
                  : "block h-full w-full overflow-hidden text-ellipsis whitespace-nowrap"
              }
              style={{ textAlign: cell?.align ?? "left" }}
            >
              {cell?.text ?? ""}
            </span>
          );
        },
        resizable: true,
        width,
      })
    );
    const dataWidth = dataWidths.reduce((total, width) => total + width, 0);
    return [
      rowNumberColumn,
      ...dataColumns,
      ...fillerColumns<XlsxGridRow>(
        availableWidth - dataWidth,
        sheet.startColumn + sheet.columnCount
      ),
    ];
  }, [
    autoBaseWidths,
    columnWidths,
    layout,
    sheet.columnCount,
    sheet.columnWidthsPx,
    sheet.startColumn,
    sheet.startRow,
    spansByRow,
  ]);

  const handleActivePositionChange = useCallback(
    (args: PositionChangeArgs<XlsxGridRow>) => {
      const key = args.column?.key;
      setActive(
        key && key !== ROW_NUMBER_COLUMN_KEY
          ? { key, rowIdx: args.rowIdx }
          : null
      );
    },
    []
  );

  const handleCopy = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (!active) {
        return;
      }
      const columnIndex = dataCellColumnIndex(active.key);
      // Filler rows/columns and blank cells are not document data. Writing an
      // empty string would wipe the system clipboard, so let native copy pass.
      if (
        columnIndex === null ||
        columnIndex >= sheet.columnCount ||
        active.rowIdx >= sheet.rows.length
      ) {
        return;
      }
      const row = rows[active.rowIdx];
      if (!row) {
        return;
      }
      const text = row.cells[columnIndex]?.text ?? "";
      if (text === "") {
        return;
      }
      event.clipboardData.setData("text/plain", text);
      event.preventDefault();
      event.stopPropagation();
    },
    [active, rows, sheet.columnCount, sheet.rows.length]
  );

  return (
    <div
      className="h-full min-h-0 w-full"
      onCopy={handleCopy}
      ref={containerRef}
    >
      <DataGrid
        aria-label={t(
          "filePanel.documentPreview.xlsx.sheetLabel",
          "Sheet {name}",
          { name: sheet.name }
        )}
        className="pier-csv-grid h-full w-full"
        columns={columns}
        columnWidths={gridColumnWidths}
        defaultColumnOptions={{
          maxWidth: MAX_COLUMN_WIDTH,
          minWidth: MIN_COLUMN_WIDTH,
          resizable: true,
        }}
        headerRowHeight={XLSX_ROW_HEIGHT_PX}
        onActivePositionChange={handleActivePositionChange}
        onColumnWidthsChange={handleColumnWidthsChange}
        rowHeight={rowHeight}
        rowKeyGetter={(row) => row.id}
        rows={rows}
        style={{ blockSize: "100%", inlineSize: "100%" }}
      />
    </div>
  );
}
