export const XLSX_LIMITS = {
  maxCells: 500_000,
  maxColumns: 256,
  maxRows: 50_000,
} as const;

export const XLSX_PARSE_TIMEOUT_MS = 20_000;

export interface XlsxClippedRange {
  columnCount: number;
  fullColumnCount: number;
  fullRowCount: number;
  range: { e: { c: number; r: number }; s: { c: number; r: number } };
  rowCount: number;
  truncated: boolean;
}

export function clipXlsxRange(
  range:
    | { e: { c: number; r: number }; s: { c: number; r: number } }
    | undefined
): XlsxClippedRange {
  if (!range) {
    return {
      columnCount: 0,
      fullColumnCount: 0,
      fullRowCount: 0,
      range: { e: { c: -1, r: -1 }, s: { c: 0, r: 0 } },
      rowCount: 0,
      truncated: false,
    };
  }
  const fullRowCount = Math.max(0, range.e.r - range.s.r + 1);
  const fullColumnCount = Math.max(0, range.e.c - range.s.c + 1);
  let rowCount = Math.min(fullRowCount, XLSX_LIMITS.maxRows);
  const columnCount = Math.min(fullColumnCount, XLSX_LIMITS.maxColumns);
  if (rowCount * columnCount > XLSX_LIMITS.maxCells) {
    rowCount = Math.max(1, Math.floor(XLSX_LIMITS.maxCells / columnCount));
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
    truncated: rowCount < fullRowCount || columnCount < fullColumnCount,
  };
}
