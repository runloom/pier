import {
  readStoredColumnWidths,
  writeStoredColumnWidths,
} from "../shared/preferences.ts";

const WIDTHS_PREFIX = "pier.files.xlsx.columnWidths.v1:";
const KEY_SEPARATOR = "\u001f";

/**
 * Widths belong to a worksheet shape, not the whole workbook: switching
 * sheets must not reuse another sheet's columns, and a changed column count
 * invalidates stale widths. Sheet names cannot contain `:` but the document id
 * may, so the structure key uses the same unit separator as CSV.
 */
export function xlsxColumnStructureKey(
  sheetName: string,
  columnCount: number
): string {
  return `${sheetName}${KEY_SEPARATOR}${columnCount}`;
}

function widthsKey(documentId: string, structureKey: string): string {
  return `${WIDTHS_PREFIX}${documentId}${KEY_SEPARATOR}${structureKey}`;
}

export function readXlsxColumnWidths(
  documentId: string,
  structureKey: string
): Record<string, number> | null {
  return readStoredColumnWidths(widthsKey(documentId, structureKey));
}

export function writeXlsxColumnWidths(input: {
  documentId: string;
  structureKey: string;
  widths: Record<string, number>;
}): void {
  writeStoredColumnWidths(
    widthsKey(input.documentId, input.structureKey),
    input.widths
  );
}
