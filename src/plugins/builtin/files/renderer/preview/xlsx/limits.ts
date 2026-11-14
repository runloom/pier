export const XLSX_LIMITS = {
  maxCells: 500_000,
  maxColumns: 256,
  /**
   * SheetJS parses rows from row 0. A used range that starts below this row
   * would force the worker to materialize the whole leading blank band, so
   * such sheets are reported as offset-truncated instead.
   */
  maxParseStartRow: 100_000,
  maxRows: 50_000,
  /** Workbook-wide serialized-cell budget; per-sheet limits alone multiply. */
  maxWorkbookCells: 1_000_000,
} as const;

export const XLSX_PARSE_TIMEOUT_MS = 20_000;

export type XlsxTruncationReason = "cells" | "columns" | "offset" | "rows";

export interface XlsxClippedRange {
  columnCount: number;
  fullColumnCount: number;
  fullRowCount: number;
  range: { e: { c: number; r: number }; s: { c: number; r: number } };
  rowCount: number;
  truncated: boolean;
  truncatedReason: XlsxTruncationReason | null;
}

export function clipXlsxRange(
  range:
    | { e: { c: number; r: number }; s: { c: number; r: number } }
    | undefined,
  availableCells: number = XLSX_LIMITS.maxCells
): XlsxClippedRange {
  if (!range) {
    return {
      columnCount: 0,
      fullColumnCount: 0,
      fullRowCount: 0,
      range: { e: { c: -1, r: -1 }, s: { c: 0, r: 0 } },
      rowCount: 0,
      truncated: false,
      truncatedReason: null,
    };
  }
  const fullRowCount = Math.max(0, range.e.r - range.s.r + 1);
  const fullColumnCount = Math.max(0, range.e.c - range.s.c + 1);
  let rowCount = Math.min(fullRowCount, XLSX_LIMITS.maxRows);
  const columnCount = Math.min(fullColumnCount, XLSX_LIMITS.maxColumns);
  const cellBudget = Math.max(
    0,
    Math.min(XLSX_LIMITS.maxCells, Math.floor(availableCells))
  );
  const rowsAllowedByCells =
    columnCount > 0 ? Math.floor(cellBudget / columnCount) : 0;
  let truncatedReason: XlsxTruncationReason | null = null;
  if (rowCount > rowsAllowedByCells) {
    rowCount = rowsAllowedByCells;
    truncatedReason = "cells";
  }
  if (columnCount < fullColumnCount) {
    truncatedReason = "columns";
  } else if (truncatedReason === null && rowCount < fullRowCount) {
    truncatedReason = "rows";
  }
  return {
    columnCount,
    fullColumnCount,
    fullRowCount,
    range: {
      e: { c: range.s.c + columnCount - 1, r: range.s.r + rowCount - 1 },
      s: { c: range.s.c, r: range.s.r },
    },
    rowCount,
    truncated: truncatedReason !== null,
    truncatedReason,
  };
}
