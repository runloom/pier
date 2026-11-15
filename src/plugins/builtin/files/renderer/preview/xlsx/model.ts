import * as XLSX from "xlsx";
import { formatXlsxCell, type XlsxCell } from "./format.ts";
import {
  estimatedMultiLineRowHeightPx,
  MAX_COLUMN_WIDTH,
  MAX_ROW_HEIGHT_PX,
  MIN_COLUMN_WIDTH,
  XLSX_ROW_HEIGHT_PX,
} from "./layout.ts";
import { clipXlsxRange, XLSX_LIMITS } from "./limits.ts";
import type { SerializedXlsxMerge, SerializedXlsxSheet } from "./protocol.ts";

/** XLSX column indices never exceed 16383, so this stride keeps keys unique. */
const COVERED_CELL_KEY_STRIDE = 16_384;
/** SheetJS parses the XML `customWidth` flag onto the column object. */
interface XlsxDocumentColumn extends XLSX.ColInfo {
  customwidth?: boolean | number | string;
}

function documentColumnWidth(column: XLSX.ColInfo | undefined): number | null {
  if (!column) {
    return null;
  }
  const { wpx, wch, width } = column;
  let pixels: number | null = null;
  if (typeof wpx === "number" && Number.isFinite(wpx) && wpx > 0) {
    pixels = wpx;
  } else if (typeof wch === "number" && Number.isFinite(wch) && wch > 0) {
    pixels = wch * 7 + 5;
  } else if (typeof width === "number" && Number.isFinite(width) && width > 0) {
    pixels = width * 7 + 5;
  }
  if (pixels === null) {
    return null;
  }
  return Math.min(
    MAX_COLUMN_WIDTH,
    Math.max(MIN_COLUMN_WIDTH, Math.round(pixels))
  );
}

function hasCustomWidth(column: XLSX.ColInfo | undefined): boolean {
  if (!column) {
    return false;
  }
  const value = (column as XlsxDocumentColumn).customwidth;
  return value === true || value === 1 || value === "1" || value === "true";
}

/**
 * Document `!cols` widths for the rendered columns. A single uniform width is
 * how exporters describe the default column, so it is not a layout intent;
 * only explicit custom widths or a varied set are honored.
 */
function documentColumnWidths(
  sheet: XLSX.WorkSheet,
  range: { e: { c: number; r: number }; s: { c: number; r: number } }
): Array<number | null> {
  const columnCount = Math.max(0, range.e.c - range.s.c + 1);
  const columns = sheet["!cols"] as XlsxDocumentColumn[] | undefined;
  const rendered = Array.from(
    { length: columnCount },
    (_, index) => columns?.[range.s.c + index]
  );
  const widths = rendered.map((column) => documentColumnWidth(column));
  const present = widths.filter((width): width is number => width !== null);
  if (present.length === 0) {
    return widths;
  }
  const explicit = rendered.some((column) => hasCustomWidth(column));
  const uniform = present.every((width) => width === present[0]);
  return explicit || !uniform ? widths : widths.map(() => null);
}

/**
 * Converts one document row height to CSS pixels.
 *
 * Excel stores `ht` in points. SheetJS exposes it as both `hpt` and `hpx`,
 * but its `pt2px` helper divides by `PPI = 96`, so the conversion is an
 * identity and `hpx` is still the point value. Rendering `hpx` directly makes
 * every row 25% too short and clips wrapped text, so the point value is
 * converted here. Custom heights also get one pixel of breathing room: the
 * grid row spends a pixel on its border, while wrapped content needs full
 * line-height multiples.
 */
function documentRowHeightPx(row: XLSX.RowInfo | undefined): number | null {
  if (!row) {
    return null;
  }
  const points = row.hpt;
  let pixels: number;
  if (typeof points === "number" && Number.isFinite(points) && points > 0) {
    pixels = Math.ceil((points * 4) / 3);
  } else {
    const fallback = row.hpx;
    if (
      typeof fallback !== "number" ||
      !Number.isFinite(fallback) ||
      fallback <= 0
    ) {
      return null;
    }
    pixels = Math.round(fallback);
  }
  const withBorder = pixels > XLSX_ROW_HEIGHT_PX ? pixels + 1 : pixels;
  return Math.min(MAX_ROW_HEIGHT_PX, Math.max(XLSX_ROW_HEIGHT_PX, withBorder));
}

/**
 * Row heights relative to the rendered range. Document heights win; rows
 * without one but with embedded line breaks get an estimated height so the
 * text wraps like Excel's auto-fit instead of collapsing into one line.
 */
function serializedRowHeights(
  sheet: XLSX.WorkSheet,
  range: { e: { c: number; r: number }; s: { c: number; r: number } },
  rows: readonly XlsxCell[][],
  columnWidthsPx: readonly (number | null)[]
): SerializedXlsxSheet["rowHeights"] {
  const rowCount = Math.max(0, range.e.r - range.s.r + 1);
  const documentRows = sheet["!rows"];
  const heights: SerializedXlsxSheet["rowHeights"] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const documentHeight = documentRowHeightPx(
      documentRows?.[range.s.r + index]
    );
    if (documentHeight !== null) {
      heights.push({ height: documentHeight, row: index });
      continue;
    }
    const estimated = estimatedMultiLineRowHeightPx(
      rows[index] ?? [],
      columnWidthsPx
    );
    if (estimated > XLSX_ROW_HEIGHT_PX) {
      heights.push({ height: estimated, row: index });
    }
  }
  return heights;
}

/**
 * Horizontal merges whose anchor is inside the rendered range. Vertical merges
 * (rowSpan) are not representable in react-data-grid, so they keep the
 * top-left-value behavior instead of inventing a second grid.
 */
function horizontalMerges(
  sheet: XLSX.WorkSheet,
  range: { e: { c: number; r: number }; s: { c: number; r: number } }
): SerializedXlsxMerge[] {
  const merges: SerializedXlsxMerge[] = [];
  if (range.e.r < range.s.r || range.e.c < range.s.c) {
    return merges;
  }
  for (const merge of sheet["!merges"] ?? []) {
    if (merge.s.r < range.s.r || merge.s.r > range.e.r) {
      continue;
    }
    if (merge.s.c < range.s.c || merge.s.c > range.e.c) {
      continue;
    }
    const columnSpan = Math.min(merge.e.c, range.e.c) - merge.s.c + 1;
    if (columnSpan < 2) {
      continue;
    }
    merges.push({
      column: merge.s.c - range.s.c,
      columnSpan,
      row: merge.s.r - range.s.r,
    });
  }
  return merges;
}

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
    const columnWidthsPx = documentColumnWidths(sheet, clipped.range);
    if (offsetTruncated.has(name)) {
      sheets.push({
        columnCount: clipped.columnCount,
        columnWidthsPx,
        fullColumnCount: clipped.fullColumnCount,
        fullRowCount: clipped.fullRowCount,
        merges: [],
        name,
        rowCount: 0,
        rowHeights: [],
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
      columnWidthsPx,
      fullColumnCount: clipped.fullColumnCount,
      fullRowCount: clipped.fullRowCount,
      merges: horizontalMerges(sheet, clipped.range),
      name,
      rowCount: clipped.rowCount,
      rowHeights: serializedRowHeights(
        sheet,
        clipped.range,
        rows,
        columnWidthsPx
      ),
      rows,
      startColumn: clipped.range.s.c,
      startRow: clipped.range.s.r,
      truncated: clipped.truncated,
      truncatedReason: clipped.truncatedReason,
    });
  }
  return sheets;
}
