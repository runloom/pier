import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@pier/ui/dropdown-menu.tsx";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Column,
  type ColumnWidths,
  DataGrid,
  type DataGridHandle,
  type RowsChangeData,
} from "react-data-grid";
import "react-data-grid/lib/styles.css";
import { Trash2 } from "lucide-react";
import type { FilesTranslate } from "../../i18n.ts";
import { CsvCellEditor } from "./cell-editor.tsx";
import { type CsvEdit, csvCellEdit, csvMatrixEdits } from "./edit.ts";
import {
  type CsvGridRow,
  csvColumnLetter,
  csvDisplayColumnLabels,
  csvGridRows,
  csvMatrixFromRows,
} from "./model.ts";
import type { CsvTable } from "./parser.ts";
import "./csv-grid.css";

export const CSV_ROW_HEIGHT_PX = 28;
const ROW_NUMBER_COLUMN_KEY = "__row";
const ROW_NUMBER_COLUMN_WIDTH = 56;
const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 480;
/** Trailing empty rows so the sheet fills the viewport like a spreadsheet. */
const VIRTUAL_ROW_COUNT = 200;

export interface CsvGridProps {
  columnWidths: Record<string, number>;
  header: boolean;
  onActiveCellChange: (cell: { column: number; row: number } | null) => void;
  onColumnWidthsChange: (widths: Record<string, number>) => void;
  onDeleteColumn: (columnIndex: number) => void;
  onDeleteRow: (rowIndex: number) => void;
  onEdit: (edits: readonly CsvEdit[]) => void;
  onInsertColumn: (atIndex: number) => void;
  onInsertRow: (atIndex: number) => void;
  readOnly: boolean;
  t: FilesTranslate | undefined;
  table: CsvTable;
}

export function CsvGrid({
  columnWidths,
  header,
  onActiveCellChange,
  onColumnWidthsChange,
  onDeleteColumn,
  onDeleteRow,
  onEdit,
  onInsertColumn,
  onInsertRow,
  readOnly,
  t,
  table,
}: CsvGridProps) {
  const rawHeaderLabels = useMemo(
    () =>
      header
        ? Array.from(
            { length: table.columnCount },
            (_, index) => table.rows[0]?.cells[index]?.value ?? ""
          )
        : [],
    [header, table]
  );
  const displayLabels = useMemo(
    () => csvDisplayColumnLabels(rawHeaderLabels),
    [rawHeaderLabels]
  );
  const dataRows = useMemo(
    () => csvGridRows(table, header, table.columnCount),
    [header, table]
  );
  const rows = useMemo(() => {
    const virtualRows: CsvGridRow[] = [];
    for (let index = 0; index < VIRTUAL_ROW_COUNT; index += 1) {
      const row: CsvGridRow = { id: table.rows.length + index };
      for (
        let columnIndex = 0;
        columnIndex < table.columnCount;
        columnIndex += 1
      ) {
        row[`c${columnIndex}`] = "";
      }
      virtualRows.push(row);
    }
    return [...dataRows, ...virtualRows];
  }, [dataRows, table.columnCount, table.rows.length]);
  const rowOffset = header ? 1 : 0;
  const gridRef = useRef<DataGridHandle>(null);
  const initialCellSetRef = useRef(false);
  type HeaderMenu =
    | { kind: "column"; index: number; x: number; y: number }
    | { kind: "row"; index: number; x: number; y: number };
  const [headerMenu, setHeaderMenu] = useState<HeaderMenu | null>(null);
  const openHeaderMenu = useCallback(
    (event: React.MouseEvent, kind: "column" | "row", index: number) => {
      event.preventDefault();
      event.stopPropagation();
      setHeaderMenu({ index, kind, x: event.clientX, y: event.clientY });
    },
    []
  );
  useEffect(() => {
    if (
      initialCellSetRef.current ||
      dataRows.length === 0 ||
      table.columnCount === 0
    ) {
      return;
    }
    initialCellSetRef.current = true;
    gridRef.current?.setActivePosition(
      { idx: 1, rowIdx: 0 },
      { shouldFocus: false }
    );
    onActiveCellChange({ column: 0, row: rowOffset });
  }, [dataRows.length, onActiveCellChange, rowOffset, table.columnCount]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const updateWidth = () => setContainerWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
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
        if (key !== ROW_NUMBER_COLUMN_KEY) {
          next[key] = Math.round(value.width);
        }
      }
      onColumnWidthsChange(next);
    },
    [onColumnWidthsChange]
  );

  const columns = useMemo<Column<CsvGridRow>[]>(() => {
    const hasPersistedWidths = Object.keys(columnWidths).length > 0;
    const baseWidths = displayLabels.map((label) =>
      Math.min(320, Math.max(96, (label?.length ?? 4) * 8 + 32))
    );
    const baseTotal = baseWidths.reduce((total, width) => total + width, 0);
    const availableWidth = Math.max(
      0,
      containerWidth - ROW_NUMBER_COLUMN_WIDTH
    );
    const fitScale =
      !hasPersistedWidths && availableWidth > 0 && baseTotal > 0
        ? Math.max(1, availableWidth / baseTotal)
        : 1;
    const rowNumberColumn: Column<CsvGridRow> = {
      cellClass: "pier-csv-rownum",
      editable: false,
      frozen: true,
      key: ROW_NUMBER_COLUMN_KEY,
      maxWidth: ROW_NUMBER_COLUMN_WIDTH,
      minWidth: ROW_NUMBER_COLUMN_WIDTH,
      name: "",
      renderCell: ({ rowIdx }) => {
        const tableRow = rowIdx + rowOffset;
        return (
          // biome-ignore lint/a11y/noNoninteractiveElementInteractions: spreadsheet row header is a composite grid target.
          // biome-ignore lint/a11y/noStaticElementInteractions: spreadsheet row header is a composite grid target.
          <span
            className="block h-full w-full text-right tabular-nums"
            onContextMenu={
              tableRow < table.rows.length
                ? (event) => openHeaderMenu(event, "row", tableRow)
                : undefined
            }
          >
            {tableRow + 1}
          </span>
        );
      },
      resizable: false,
      width: ROW_NUMBER_COLUMN_WIDTH,
    };
    const dataColumns = Array.from(
      { length: table.columnCount },
      (_, index): Column<CsvGridRow> => {
        const key = `c${index}`;
        const letter = csvColumnLetter(index);
        const label = displayLabels[index] ?? letter;
        return {
          editable: !readOnly,
          key,
          maxWidth: MAX_COLUMN_WIDTH,
          minWidth: MIN_COLUMN_WIDTH,
          name: label,
          renderHeaderCell: () => {
            return (
              // biome-ignore lint/a11y/noNoninteractiveElementInteractions: spreadsheet column header is a composite grid target.
              // biome-ignore lint/a11y/noStaticElementInteractions: spreadsheet column header is a composite grid target.
              <span
                className="flex h-full w-full min-w-0 items-center gap-2"
                onContextMenu={(event) =>
                  openHeaderMenu(event, "column", index)
                }
              >
                <span className="text-muted-foreground text-xs tabular-nums">
                  {letter}
                </span>
                {label === letter ? null : (
                  <span className="truncate">{label}</span>
                )}
              </span>
            );
          },
          renderEditCell: readOnly ? undefined : CsvCellEditor,
          resizable: true,
          width:
            columnWidths[key] ??
            Math.min(
              320,
              Math.max(
                MIN_COLUMN_WIDTH,
                Math.floor((baseWidths[index] ?? 160) * fitScale)
              )
            ),
        };
      }
    );
    return [rowNumberColumn, ...dataColumns];
  }, [
    columnWidths,
    containerWidth,
    displayLabels,
    openHeaderMenu,
    readOnly,
    rowOffset,
    table.columnCount,
    table.rows.length,
  ]);

  const handleRowsChange = useCallback(
    (nextRows: CsvGridRow[], data: RowsChangeData<CsvGridRow>) => {
      const rowCountUnchanged = nextRows.length === rows.length;
      if (rowCountUnchanged && data.indexes.length === 1) {
        const gridRowIndex = data.indexes[0];
        const nextRow =
          gridRowIndex === undefined ? undefined : nextRows[gridRowIndex];
        const tableRowIndex = (gridRowIndex ?? -1) + rowOffset;
        if (
          nextRow &&
          tableRowIndex >= 0 &&
          tableRowIndex < table.rows.length
        ) {
          const edits = Array.from(
            { length: table.columnCount },
            (_, columnIndex) =>
              csvCellEdit(
                table,
                tableRowIndex,
                columnIndex,
                String(nextRow[`c${columnIndex}`] ?? "")
              )
          ).flat();
          onEdit(edits);
          return;
        }
      }
      const matrix = csvMatrixFromRows(
        table,
        header,
        nextRows,
        table.columnCount
      );
      // Trailing empty rows are display-only until the user types in one.
      const minRows = table.rows.length;
      let lastRow = matrix.length - 1;
      while (
        lastRow >= minRows &&
        matrix[lastRow]?.every((value) => value === "")
      ) {
        lastRow -= 1;
      }
      const trimmed =
        lastRow < matrix.length - 1 ? matrix.slice(0, lastRow + 1) : matrix;
      onEdit(csvMatrixEdits(table, trimmed));
    },
    [header, onEdit, rowOffset, rows.length, table]
  );

  const handleActivePositionChange = useCallback(
    (args: { column?: { key: string } | undefined; rowIdx: number }) => {
      const key = args.column?.key;
      if (!key || key === ROW_NUMBER_COLUMN_KEY || args.rowIdx < 0) {
        onActiveCellChange(null);
        return;
      }
      const columnIndex = Number(key.slice(1));
      if (!Number.isSafeInteger(columnIndex)) {
        onActiveCellChange(null);
        return;
      }
      const tableRow = args.rowIdx + rowOffset;
      onActiveCellChange({
        column: columnIndex,
        row: tableRow,
      });
    },
    [onActiveCellChange, rowOffset]
  );

  return (
    <div className="h-full min-h-0 w-full" ref={containerRef}>
      <DataGrid
        aria-label={t?.("filePanel.csv.tableLabel", "CSV table") ?? "CSV table"}
        className="pier-csv-grid h-full w-full"
        columns={columns}
        columnWidths={gridColumnWidths}
        defaultColumnOptions={{
          maxWidth: MAX_COLUMN_WIDTH,
          minWidth: MIN_COLUMN_WIDTH,
          resizable: true,
        }}
        headerRowHeight={CSV_ROW_HEIGHT_PX}
        onActivePositionChange={handleActivePositionChange}
        onColumnWidthsChange={handleColumnWidthsChange}
        onRowsChange={readOnly ? undefined : handleRowsChange}
        ref={gridRef}
        rowHeight={CSV_ROW_HEIGHT_PX}
        rowKeyGetter={(row) => row.id}
        rows={rows}
        style={{ blockSize: "100%", inlineSize: "100%" }}
      />
      {headerMenu ? (
        <DropdownMenu
          onOpenChange={(open) => {
            if (!open) {
              setHeaderMenu(null);
            }
          }}
          open
        >
          <DropdownMenuTrigger asChild>
            <span
              aria-hidden="true"
              className="pointer-events-none fixed size-px"
              style={{ left: headerMenu.x, top: headerMenu.y }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-52" side="bottom">
            <DropdownMenuLabel>
              {headerMenu.kind === "row"
                ? (t?.("filePanel.csv.rowNumber", "Row {{number}}", {
                    number: headerMenu.index + 1,
                  }) ?? `Row ${headerMenu.index + 1}`)
                : (t?.("filePanel.csv.columnNumber", "Column {{letter}}", {
                    letter: csvColumnLetter(headerMenu.index),
                  }) ?? `Column ${csvColumnLetter(headerMenu.index)}`)}
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={readOnly}
                onSelect={() => {
                  if (headerMenu.kind === "row") {
                    onInsertRow(headerMenu.index);
                  } else {
                    onInsertColumn(headerMenu.index);
                  }
                  setHeaderMenu(null);
                }}
              >
                {headerMenu.kind === "row"
                  ? t?.("filePanel.csv.insertRowAbove", "Insert row above")
                  : t?.("filePanel.csv.insertColumnLeft", "Insert column left")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={readOnly}
                onSelect={() => {
                  if (headerMenu.kind === "row") {
                    onInsertRow(headerMenu.index + 1);
                  } else {
                    onInsertColumn(headerMenu.index + 1);
                  }
                  setHeaderMenu(null);
                }}
              >
                {headerMenu.kind === "row"
                  ? t?.("filePanel.csv.insertRowBelow", "Insert row below")
                  : t?.(
                      "filePanel.csv.insertColumnRight",
                      "Insert column right"
                    )}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={readOnly}
                onSelect={() => {
                  if (headerMenu.kind === "row") {
                    onDeleteRow(headerMenu.index);
                  } else {
                    onDeleteColumn(headerMenu.index);
                  }
                  setHeaderMenu(null);
                }}
              >
                <Trash2 data-icon="inline-start" />
                {headerMenu.kind === "row"
                  ? t?.("filePanel.csv.deleteRow", "Delete row")
                  : t?.("filePanel.csv.deleteColumn", "Delete column")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
