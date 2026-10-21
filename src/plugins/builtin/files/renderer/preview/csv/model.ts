import type { CsvTable } from "./parser.ts";

export interface CsvGridRow {
  /** Stable table row index (including the header row). */
  id: number;
  /** `c0`, `c1`, ... values; react-data-grid reads row[column.key]. */
  [key: string]: string | number;
}

export function csvColumnLetter(index: number): string {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

export function csvRawHeaderLabels(table: CsvTable, header: boolean): string[] {
  if (!header) {
    return [];
  }
  const headerRow = table.rows[0];
  return Array.from(
    { length: table.columnCount },
    (_, index) => headerRow?.cells[index]?.value ?? ""
  );
}

export function csvDisplayColumnLabels(rawLabels: readonly string[]): string[] {
  const used = new Set<string>();
  return rawLabels.map((raw, index) => {
    const base = raw.trim() || csvColumnLetter(index);
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    let suffix = 2;
    while (used.has(`${base} (${suffix})`)) {
      suffix += 1;
    }
    const label = `${base} (${suffix})`;
    used.add(label);
    return label;
  });
}

export function csvGridRows(
  table: CsvTable,
  header: boolean,
  columnCount: number
): CsvGridRow[] {
  const start = header ? 1 : 0;
  return table.rows.slice(start).map((row, index) => {
    const tableRowIndex = index + start;
    const gridRow: CsvGridRow = { id: tableRowIndex };
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      gridRow[`c${columnIndex}`] = row.cells[columnIndex]?.value ?? "";
    }
    return gridRow;
  });
}

export function csvMatrixFromRows(
  table: CsvTable,
  header: boolean,
  rows: readonly CsvGridRow[],
  columnCount: number
): string[][] {
  const matrix = rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) =>
      String(row[`c${index}`] ?? "")
    )
  );
  if (!header) {
    return matrix;
  }
  const headerRow = table.rows[0];
  const headerCells = Array.from(
    { length: columnCount },
    (_, index) => headerRow?.cells[index]?.value ?? ""
  );
  return [headerCells, ...matrix];
}
