import {
  type Column,
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
import type { XlsxCell } from "./format.ts";
import type { SerializedXlsxSheet } from "./protocol.ts";

export const XLSX_ROW_HEIGHT_PX = 28;
const ROW_NUMBER_COLUMN_KEY = "__row";
const ROW_NUMBER_COLUMN_WIDTH = 56;
const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 480;
const BASE_COLUMN_WIDTH = 96;
const BASE_COLUMN_MAX_WIDTH = 320;

interface XlsxGridRow {
  cells: readonly XlsxCell[];
  id: number;
}

export function xlsxCellText(
  row: XlsxGridRow | undefined,
  key: string
): string {
  if (!(row && key.startsWith("c"))) {
    return "";
  }
  const index = Number(key.slice(1));
  return Number.isSafeInteger(index) ? (row.cells[index]?.text ?? "") : "";
}

export function XlsxGrid(props: {
  sheet: SerializedXlsxSheet;
  t: FilesTranslate;
}) {
  const { sheet, t } = props;
  const [active, setActive] = useState<{ key: string; rowIdx: number } | null>(
    null
  );
  const rows = useMemo<XlsxGridRow[]>(
    () => sheet.rows.map((cells, index) => ({ cells, id: index })),
    [sheet.rows]
  );
  // A cell picked in one worksheet must not follow the user to another sheet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sheet identity is the reset trigger; the effect only clears state.
  useEffect(() => {
    setActive(null);
  }, [sheet]);
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

  // Same geometry as the CSV preview: estimate a base width per column, then
  // scale the set to fill the panel. Sheet `!cols` hints are not trusted here
  // because exported workbooks often omit them and the 120px fallback leaves
  // most of a wide panel empty.
  const columns = useMemo<Column<XlsxGridRow>[]>(() => {
    const availableWidth = Math.max(
      0,
      containerWidth - ROW_NUMBER_COLUMN_WIDTH
    );
    const baseTotal = BASE_COLUMN_WIDTH * Math.max(1, sheet.columnCount);
    const fitScale =
      availableWidth > 0 ? Math.max(1, availableWidth / baseTotal) : 1;
    const width = Math.min(
      BASE_COLUMN_MAX_WIDTH,
      Math.max(MIN_COLUMN_WIDTH, Math.floor(BASE_COLUMN_WIDTH * fitScale))
    );
    return [
      {
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
      },
      ...Array.from(
        { length: sheet.columnCount },
        (_, index): Column<XlsxGridRow> => ({
          editable: false,
          key: `c${index}`,
          maxWidth: MAX_COLUMN_WIDTH,
          minWidth: MIN_COLUMN_WIDTH,
          name: csvColumnLetter(sheet.startColumn + index),
          renderCell: ({ row }) => {
            const cell = row.cells[index];
            return (
              <span
                className="block h-full w-full overflow-hidden text-ellipsis whitespace-nowrap"
                style={{ textAlign: cell?.align ?? "left" }}
              >
                {cell?.text ?? ""}
              </span>
            );
          },
          resizable: false,
          width,
        })
      ),
    ];
  }, [containerWidth, sheet.columnCount, sheet.startColumn, sheet.startRow]);

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
      const row = rows[active.rowIdx];
      // Column headers report rowIdx -1; never clear the clipboard for them.
      if (!row) {
        return;
      }
      event.clipboardData.setData("text/plain", xlsxCellText(row, active.key));
      event.preventDefault();
      event.stopPropagation();
    },
    [active, rows]
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
        headerRowHeight={XLSX_ROW_HEIGHT_PX}
        onActivePositionChange={handleActivePositionChange}
        rowHeight={XLSX_ROW_HEIGHT_PX}
        rowKeyGetter={(row) => row.id}
        rows={rows}
        style={{ blockSize: "100%", inlineSize: "100%" }}
      />
    </div>
  );
}
