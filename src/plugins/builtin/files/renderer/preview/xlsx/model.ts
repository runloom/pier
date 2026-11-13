import * as XLSX from "xlsx";
import { formatXlsxCell, type XlsxCell } from "./format.ts";
import { clipXlsxRange } from "./limits.ts";
import type { SerializedXlsxSheet } from "./protocol.ts";

function mergedCoveredCells(sheet: XLSX.WorkSheet): Set<string> {
  const covered = new Set<string>();
  for (const merge of sheet["!merges"] ?? []) {
    for (let row = merge.s.r; row <= merge.e.r; row += 1) {
      for (let column = merge.s.c; column <= merge.e.c; column += 1) {
        if (row === merge.s.r && column === merge.s.c) {
          continue;
        }
        covered.add(XLSX.utils.encode_cell({ c: column, r: row }));
      }
    }
  }
  return covered;
}

export function buildXlsxSheets(
  workbook: XLSX.WorkBook
): SerializedXlsxSheet[] {
  const sheets: SerializedXlsxSheet[] = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) {
      continue;
    }
    const reference = sheet["!fullref"] ?? sheet["!ref"];
    const clipped = clipXlsxRange(
      reference ? XLSX.utils.decode_range(reference) : undefined
    );
    const covered = mergedCoveredCells(sheet);
    const rows: SerializedXlsxSheet["rows"] = [];
    for (let rowIndex = 0; rowIndex < clipped.rowCount; rowIndex += 1) {
      const row: XlsxCell[] = [];
      for (
        let columnIndex = 0;
        columnIndex < clipped.columnCount;
        columnIndex += 1
      ) {
        const address = XLSX.utils.encode_cell({
          c: clipped.range.s.c + columnIndex,
          r: clipped.range.s.r + rowIndex,
        });
        row.push(
          formatXlsxCell(covered.has(address) ? undefined : sheet[address])
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
    });
  }
  return sheets;
}
