import * as XLSX from "xlsx";
import { formatXlsxCell, type XlsxCell } from "./format.ts";
import { clipXlsxRange, XLSX_LIMITS } from "./limits.ts";
import type { SerializedXlsxSheet } from "./protocol.ts";

/** XLSX column indices never exceed 16383, so this stride keeps keys unique. */
const COVERED_CELL_KEY_STRIDE = 16_384;

/**
 * Addresses covered by a merge other than its top-left anchor, clipped to the
 * rendered range first. Enumerating the whole merge rectangle would allocate
 * billions of entries for a sheet-sized merge.
 */
function mergedCoveredCells(
  sheet: XLSX.WorkSheet,
  range: { e: { c: number; r: number }; s: { c: number; r: number } }
): Set<number> {
  const covered = new Set<number>();
  if (range.e.r < range.s.r || range.e.c < range.s.c) {
    return covered;
  }
  for (const merge of sheet["!merges"] ?? []) {
    const startRow = Math.max(merge.s.r, range.s.r);
    const endRow = Math.min(merge.e.r, range.e.r);
    const startColumn = Math.max(merge.s.c, range.s.c);
    const endColumn = Math.min(merge.e.c, range.e.c);
    for (let row = startRow; row <= endRow; row += 1) {
      const rowBase = row * COVERED_CELL_KEY_STRIDE;
      for (let column = startColumn; column <= endColumn; column += 1) {
        if (row === merge.s.r && column === merge.s.c) {
          continue;
        }
        covered.add(rowBase + column);
      }
    }
  }
  return covered;
}

export interface BuildXlsxSheetsOptions {
  /** Workbook-wide serialized-cell budget; defaults to the shared limit. */
  maxWorkbookCells?: number;
  /** Sheets whose used range starts beyond the parse window. */
  offsetTruncatedSheetNames?: ReadonlySet<string>;
}

export function buildXlsxSheets(
  workbook: XLSX.WorkBook,
  options: BuildXlsxSheetsOptions = {}
): SerializedXlsxSheet[] {
  const sheets: SerializedXlsxSheet[] = [];
  const offsetTruncated =
    options.offsetTruncatedSheetNames ?? new Set<string>();
  let remainingCells = options.maxWorkbookCells ?? XLSX_LIMITS.maxWorkbookCells;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) {
      continue;
    }
    const reference = sheet["!fullref"] ?? sheet["!ref"];
    const clipped = clipXlsxRange(
      reference ? XLSX.utils.decode_range(reference) : undefined,
      remainingCells
    );
    if (offsetTruncated.has(name)) {
      sheets.push({
        columnCount: clipped.columnCount,
        fullColumnCount: clipped.fullColumnCount,
        fullRowCount: clipped.fullRowCount,
        name,
        rowCount: 0,
        rows: [],
        startColumn: clipped.range.s.c,
        startRow: clipped.range.s.r,
        truncated: true,
        truncatedReason: "offset",
      });
      continue;
    }
    remainingCells -= clipped.rowCount * clipped.columnCount;
    const covered = mergedCoveredCells(sheet, clipped.range);
    const rows: SerializedXlsxSheet["rows"] = [];
    for (let rowIndex = 0; rowIndex < clipped.rowCount; rowIndex += 1) {
      const row: XlsxCell[] = [];
      const globalRow = clipped.range.s.r + rowIndex;
      const rowBase = globalRow * COVERED_CELL_KEY_STRIDE;
      for (
        let columnIndex = 0;
        columnIndex < clipped.columnCount;
        columnIndex += 1
      ) {
        const globalColumn = clipped.range.s.c + columnIndex;
        const address = XLSX.utils.encode_cell({
          c: globalColumn,
          r: globalRow,
        });
        row.push(
          formatXlsxCell(
            covered.has(rowBase + globalColumn) ? undefined : sheet[address]
          )
        );
      }
      rows.push(row);
    }
    sheets.push({
      columnCount: clipped.columnCount,
      fullColumnCount: clipped.fullColumnCount,
      fullRowCount: clipped.fullRowCount,
      name,
      rowCount: clipped.rowCount,
      rows,
      startColumn: clipped.range.s.c,
      startRow: clipped.range.s.r,
      truncated: clipped.truncated,
      truncatedReason: clipped.truncatedReason,
    });
  }
  return sheets;
}
