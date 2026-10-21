import type { CsvDelimiter, CsvTable } from "./parser.ts";

export interface CsvEdit {
  /** Raw source slice start. */
  from: number;
  /** Raw source slice end (exclusive). */
  insert: string;
  to: number;
}

export interface CsvEditRecord {
  /** Exact buffer after the forward edit; guards undo against external writes. */
  afterText: string;
  /** Exact buffer before the forward edit; guards redo against external writes. */
  beforeText: string;
  edits: CsvEdit[];
  inverse: CsvEdit[];
}

export function serializeCsvCell(
  value: string,
  delimiter: CsvDelimiter,
  preferQuoted = false
): string {
  const needsQuote =
    preferQuoted ||
    value.includes(delimiter) ||
    value.includes('"') ||
    /[\r\n]/u.test(value) ||
    /^\s|\s$/u.test(value);
  if (!needsQuote) {
    return value;
  }
  return `"${value.replaceAll('"', '""')}"`;
}

export function serializeCsvRow(
  values: readonly string[],
  delimiter: CsvDelimiter
): string {
  return values
    .map((value) => serializeCsvCell(value, delimiter))
    .join(delimiter);
}

/**
 * Ascending, non-overlapping edits. Stable sort preserves list order for
 * multiple zero-width inserts at the same offset (cell append + new rows).
 */
function orderedCsvEdits(edits: readonly CsvEdit[]): CsvEdit[] {
  const ordered = [...edits].sort(
    (left, right) => left.from - right.from || left.to - right.to
  );
  const accepted: CsvEdit[] = [];
  let cursor = 0;
  for (const edit of ordered) {
    if (edit.to < edit.from || edit.from < cursor) {
      // Invalid or overlapping edits are programming errors; skip the unsafe
      // one rather than corrupting unrelated bytes.
      continue;
    }
    accepted.push(edit);
    cursor = edit.to;
  }
  return accepted;
}

/** Apply non-overlapping edits in one forward pass. */
export function applyCsvEdits(text: string, edits: readonly CsvEdit[]): string {
  const ordered = orderedCsvEdits(edits);
  if (ordered.length === 0) {
    return text;
  }
  const parts: string[] = [];
  let cursor = 0;
  for (const edit of ordered) {
    parts.push(text.slice(cursor, edit.from), edit.insert);
    cursor = edit.to;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}

/**
 * Invert edits in post-edit coordinates. Forward edits are sorted ascending;
 * each prior length change shifts the inverse position of the next edit.
 */
export function invertCsvEdits(
  text: string,
  edits: readonly CsvEdit[]
): CsvEdit[] {
  let shift = 0;
  return orderedCsvEdits(edits).map((edit) => {
    const from = edit.from + shift;
    const inverse = {
      from,
      insert: text.slice(edit.from, edit.to),
      to: from + edit.insert.length,
    };
    shift += edit.insert.length - (edit.to - edit.from);
    return inverse;
  });
}

export function csvCellEdit(
  table: CsvTable,
  rowIndex: number,
  columnIndex: number,
  value: string
): CsvEdit[] {
  const row = table.rows[rowIndex];
  if (!row) {
    return [];
  }
  const cell = row.cells[columnIndex];
  if (cell) {
    if (cell.value === value) {
      return [];
    }
    const insert = serializeCsvCell(value, table.delimiter, cell.quoted);
    const current = table.text.slice(cell.start, cell.end);
    return insert === current
      ? []
      : [{ from: cell.start, insert, to: cell.end }];
  }
  if (value === "") {
    return [];
  }
  const missing = columnIndex - row.cells.length + 1;
  if (missing < 1) {
    return [];
  }
  return [
    {
      from: row.end,
      insert: `${table.delimiter.repeat(missing)}${serializeCsvCell(value, table.delimiter)}`,
      to: row.end,
    },
  ];
}

export function csvRowInsertEdit(
  table: CsvTable,
  atIndex: number,
  values: readonly string[]
): CsvEdit[] {
  const eol = table.eol || "\n";
  const rowText = serializeCsvRow(values, table.delimiter);
  const text = table.text;
  if (atIndex < table.rows.length) {
    const position = table.rows[atIndex]?.start ?? text.length;
    return [{ from: position, insert: `${rowText}${eol}`, to: position }];
  }
  if (text.length === 0) {
    // A blank line is a real one-column row; an empty insert is a no-op.
    return [{ from: 0, insert: rowText || eol, to: 0 }];
  }
  if (text.endsWith("\n") || text.endsWith("\r")) {
    return [{ from: text.length, insert: `${rowText}${eol}`, to: text.length }];
  }
  // A trailing EOL does not create a row on parse; a blank one-column row
  // needs the separator and the blank line (`a` -> `a\n\n`).
  return [
    {
      from: text.length,
      insert: rowText ? `${eol}${rowText}` : `${eol}${eol}`,
      to: text.length,
    },
  ];
}

export function csvRowDeleteEdit(table: CsvTable, rowIndex: number): CsvEdit[] {
  const row = table.rows[rowIndex];
  if (!row) {
    return [];
  }
  if (row.eol !== "") {
    return [{ from: row.start, insert: "", to: row.eolEnd }];
  }
  if (rowIndex === 0) {
    return [{ from: row.start, insert: "", to: row.end }];
  }
  const previous = table.rows[rowIndex - 1];
  return [
    {
      from: previous?.eolStart ?? row.start,
      insert: "",
      to: row.end,
    },
  ];
}

export function csvColumnInsertEdit(
  table: CsvTable,
  atIndex: number,
  headerValue = ""
): CsvEdit[] {
  const edits: CsvEdit[] = [];
  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
    const row = table.rows[rowIndex];
    if (!row) {
      continue;
    }
    const value = rowIndex === 0 ? headerValue : "";
    const serialized = serializeCsvCell(value, table.delimiter);
    const cell = row.cells[atIndex];
    if (cell) {
      edits.push({
        from: cell.start,
        insert: `${serialized}${table.delimiter}`,
        to: cell.start,
      });
      continue;
    }
    const missing = atIndex - row.cells.length + 1;
    if (missing < 1) {
      continue;
    }
    edits.push({
      from: row.end,
      insert: `${table.delimiter.repeat(missing)}${serialized}`,
      to: row.end,
    });
  }
  return edits;
}

export function csvColumnDeleteEdit(
  table: CsvTable,
  columnIndex: number
): CsvEdit[] {
  const edits: CsvEdit[] = [];
  for (const row of table.rows) {
    const cell = row.cells[columnIndex];
    if (!cell) {
      continue;
    }
    if (row.cells.length === 1) {
      edits.push({ from: cell.start, insert: "", to: cell.end });
      continue;
    }
    const nextCell = row.cells[columnIndex + 1];
    if (nextCell) {
      edits.push({ from: cell.start, insert: "", to: nextCell.start });
      continue;
    }
    const previousCell = row.cells[columnIndex - 1];
    edits.push({
      from: previousCell?.end ?? cell.start,
      insert: "",
      to: cell.end,
    });
  }
  return edits;
}

/**
 * Convert the grid's edited matrix back into minimal text splices. Existing
 * cells are patched in place; only cells past a ragged row's length are
 * appended, and added/removed rows are serialized as whole rows.
 */
export function csvMatrixEdits(
  table: CsvTable,
  matrix: readonly (readonly string[])[]
): CsvEdit[] {
  const edits: CsvEdit[] = [];
  const sharedRows = Math.min(matrix.length, table.rows.length);
  for (let rowIndex = 0; rowIndex < sharedRows; rowIndex += 1) {
    const row = table.rows[rowIndex];
    const values = matrix[rowIndex] ?? [];
    if (!row) {
      continue;
    }
    const sharedCells = Math.min(values.length, row.cells.length);
    for (let columnIndex = 0; columnIndex < sharedCells; columnIndex += 1) {
      const cell = row.cells[columnIndex];
      const value = values[columnIndex] ?? "";
      if (!cell || cell.value === value) {
        continue;
      }
      edits.push(...csvCellEdit(table, rowIndex, columnIndex, value));
    }
    if (values.length > row.cells.length) {
      const tail = values.slice(row.cells.length);
      let lastNonEmpty = -1;
      for (let index = 0; index < tail.length; index += 1) {
        if (tail[index] !== "") {
          lastNonEmpty = index;
        }
      }
      if (lastNonEmpty >= 0) {
        const appended = tail
          .slice(0, lastNonEmpty + 1)
          .map((value) => serializeCsvCell(value, table.delimiter))
          .join(table.delimiter);
        edits.push({
          from: row.end,
          insert: `${table.delimiter}${appended}`,
          to: row.end,
        });
      }
    }
  }
  if (matrix.length > table.rows.length) {
    const eol = table.eol || "\n";
    const appendedRows = matrix
      .slice(table.rows.length)
      .map((values) => serializeCsvRow(values, table.delimiter))
      .join(eol);
    if (table.text.length === 0) {
      edits.push({ from: 0, insert: appendedRows, to: 0 });
    } else if (table.text.endsWith("\n") || table.text.endsWith("\r")) {
      edits.push({
        from: table.text.length,
        insert: `${appendedRows}${eol}`,
        to: table.text.length,
      });
    } else {
      edits.push({
        from: table.text.length,
        insert: `${eol}${appendedRows}`,
        to: table.text.length,
      });
    }
  } else if (matrix.length < table.rows.length) {
    for (
      let rowIndex = table.rows.length - 1;
      rowIndex >= matrix.length;
      rowIndex -= 1
    ) {
      edits.push(...csvRowDeleteEdit(table, rowIndex));
    }
  }
  return edits;
}
