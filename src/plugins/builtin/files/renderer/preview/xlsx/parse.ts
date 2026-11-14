import * as XLSX from "xlsx";
import { XLSX_LIMITS } from "./limits.ts";
import { buildXlsxSheets } from "./model.ts";
import type { SerializedXlsxSheet } from "./protocol.ts";

const READ_OPTIONS = {
  bookVBA: false,
  cellFormula: false,
  cellHTML: false,
  cellStyles: false,
  sheetRows: XLSX_LIMITS.maxRows + 1,
  type: "array" as const,
  WTF: false,
};

/**
 * SheetJS `sheetRows` always counts from row 0, so a sheet whose used range
 * starts lower than the first parse window loses every cell while `!fullref`
 * still advertises the full range. Re-parse only those sheets with a window
 * that reaches from row 0 to the end of the visible clip.
 */
function repairOffsetSheets(
  bytes: Uint8Array,
  workbook: XLSX.WorkBook
): Set<string> {
  const offsetTruncated = new Set<string>();
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    const fullReference = sheet?.["!fullref"];
    const visibleReference = sheet?.["!ref"];
    if (!(fullReference && visibleReference)) {
      continue;
    }
    const fullRange = XLSX.utils.decode_range(fullReference);
    const visibleRange = XLSX.utils.decode_range(visibleReference);
    const desiredEndRow = fullRange.s.r + XLSX_LIMITS.maxRows - 1;
    if (desiredEndRow <= visibleRange.e.r) {
      continue;
    }
    if (fullRange.s.r > XLSX_LIMITS.maxParseStartRow) {
      offsetTruncated.add(name);
      continue;
    }
    const reparsed = XLSX.read(bytes, {
      ...READ_OPTIONS,
      sheetRows: fullRange.s.r + XLSX_LIMITS.maxRows + 1,
      sheets: [name],
    });
    const repaired = reparsed.Sheets[name];
    if (repaired) {
      workbook.Sheets[name] = repaired;
    }
  }
  return offsetTruncated;
}

export function parseXlsxWorkbook(bytes: Uint8Array): SerializedXlsxSheet[] {
  const workbook = XLSX.read(bytes, READ_OPTIONS);
  const offsetTruncatedSheetNames = repairOffsetSheets(bytes, workbook);
  return buildXlsxSheets(workbook, { offsetTruncatedSheetNames });
}
