import { useCallback, useEffect, useRef, useState } from "react";
import { updateDocumentContents } from "../../document/store.ts";
import {
  applyCsvEdits,
  type CsvEdit,
  type CsvEditRecord,
  csvColumnDeleteEdit,
  csvColumnInsertEdit,
  csvRowDeleteEdit,
  csvRowInsertEdit,
  invertCsvEdits,
} from "./edit.ts";
import type { CsvTable } from "./parser.ts";

const MAX_HISTORY = 100;
const MAX_HISTORY_BYTES = 16 * 1024 * 1024;

function historyBytes(records: readonly CsvEditRecord[]): number {
  let bytes = 0;
  for (const record of records) {
    bytes += record.beforeText.length + record.afterText.length;
  }
  return bytes;
}

export interface CsvActiveCell {
  /** Table row index, including the header row. */
  column: number;
  row: number;
}

export interface CsvEditor {
  addColumn(): void;
  addRow(): void;
  applyEdits(edits: readonly CsvEdit[]): void;
  canRedo: boolean;
  canUndo: boolean;
  deleteActiveColumn(): void;
  deleteActiveRow(): void;
  deleteColumnAt(columnIndex: number): void;
  deleteRowAt(rowIndex: number): void;
  insertColumn(atIndex: number): void;
  insertRow(atIndex: number): void;
  redo(): void;
  undo(): void;
}

export function useCsvEditor(input: {
  activeCell: CsvActiveCell | null;
  documentId: string;
  header: boolean;
  newColumnLabel: string;
  readOnly: boolean;
  table: CsvTable;
}): CsvEditor {
  const { activeCell, documentId, header, newColumnLabel, readOnly, table } =
    input;
  const undoStack = useRef<CsvEditRecord[]>([]);
  const redoStack = useRef<CsvEditRecord[]>([]);
  const lastDocumentRef = useRef<string | null>(null);
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (lastDocumentRef.current === documentId) {
      return;
    }
    lastDocumentRef.current = documentId;
    undoStack.current = [];
    redoStack.current = [];
    setVersion((current) => current + 1);
  }, [documentId]);

  const apply = useCallback(
    (edits: readonly CsvEdit[]) => {
      if (readOnly || edits.length === 0) {
        return;
      }
      const current = table.text;
      const next = applyCsvEdits(current, edits);
      if (next === current) {
        return;
      }
      undoStack.current.push({
        afterText: next,
        beforeText: current,
        edits: [...edits],
        inverse: invertCsvEdits(current, edits),
      });
      while (
        undoStack.current.length > MAX_HISTORY ||
        (undoStack.current.length > 1 &&
          historyBytes(undoStack.current) > MAX_HISTORY_BYTES)
      ) {
        undoStack.current.shift();
      }
      redoStack.current = [];
      setVersion((value) => value + 1);
      updateDocumentContents(documentId, next);
    },
    [documentId, readOnly, table.text]
  );

  const undo = useCallback(() => {
    const record = undoStack.current.pop();
    if (!record) {
      return;
    }
    const current = table.text;
    if (current !== record.afterText) {
      undoStack.current = [];
      redoStack.current = [];
      setVersion((value) => value + 1);
      return;
    }
    const next = applyCsvEdits(current, record.inverse);
    redoStack.current.push(record);
    setVersion((value) => value + 1);
    updateDocumentContents(documentId, next);
  }, [documentId, table.text]);

  const redo = useCallback(() => {
    const record = redoStack.current.pop();
    if (!record) {
      return;
    }
    const current = table.text;
    if (current !== record.beforeText) {
      undoStack.current = [];
      redoStack.current = [];
      setVersion((value) => value + 1);
      return;
    }
    const next = applyCsvEdits(current, record.edits);
    undoStack.current.push(record);
    setVersion((value) => value + 1);
    updateDocumentContents(documentId, next);
  }, [documentId, table.text]);

  const insertRow = useCallback(
    (atIndex: number) => {
      const values = Array.from(
        { length: Math.max(1, table.columnCount) },
        () => ""
      );
      apply(csvRowInsertEdit(table, atIndex, values));
    },
    [apply, table]
  );

  const insertColumn = useCallback(
    (atIndex: number) => {
      if (table.rows.length === 0) {
        return;
      }
      apply(csvColumnInsertEdit(table, atIndex, header ? newColumnLabel : ""));
    },
    [apply, header, newColumnLabel, table]
  );

  const addRow = useCallback(() => {
    insertRow(table.rows.length);
  }, [insertRow, table.rows.length]);

  const addColumn = useCallback(() => {
    insertColumn(table.columnCount);
  }, [insertColumn, table.columnCount]);

  const deleteRowAt = useCallback(
    (rowIndex: number) => {
      apply(csvRowDeleteEdit(table, rowIndex));
    },
    [apply, table]
  );

  const deleteColumnAt = useCallback(
    (columnIndex: number) => {
      apply(csvColumnDeleteEdit(table, columnIndex));
    },
    [apply, table]
  );

  const deleteActiveRow = useCallback(() => {
    if (!activeCell) {
      return;
    }
    deleteRowAt(activeCell.row);
  }, [activeCell, deleteRowAt]);

  const deleteActiveColumn = useCallback(() => {
    if (!activeCell) {
      return;
    }
    deleteColumnAt(activeCell.column);
  }, [activeCell, deleteColumnAt]);

  return {
    addColumn,
    addRow,
    applyEdits: apply,
    canRedo: redoStack.current.length > 0,
    canUndo: undoStack.current.length > 0,
    deleteActiveColumn,
    deleteActiveRow,
    deleteColumnAt,
    deleteRowAt,
    insertColumn,
    insertRow,
    redo,
    undo,
  };
}
