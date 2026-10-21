import { Button } from "@pier/ui/button.tsx";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { FileWarning, Plus, Table2 } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FilesTranslate } from "../../i18n.ts";
import { CsvGrid } from "./grid.tsx";
import { useCsvHeaderState } from "./header-state.ts";
import { csvColumnLetter, csvRawHeaderLabels } from "./model.ts";
import { parseCsvWithDetection } from "./parser.ts";
import {
  type CsvFileSettings,
  csvColumnStructureKey,
  readCsvColumnWidths,
  readCsvSettings,
  writeCsvColumnWidths,
  writeCsvSettings,
} from "./preferences.ts";
import { type CsvActiveCell, useCsvEditor } from "./use-csv-editor.ts";

const CSV_EDIT_MAX_BYTES = 2 * 1024 * 1024;
const CSV_EDIT_MAX_ROWS = 20_000;
const CSV_EDIT_MAX_CELLS = 100_000;
const CSV_PREVIEW_MAX_ROWS = 100_000;
const WIDTH_WRITE_DEBOUNCE_MS = 250;

export interface CsvPreviewProps {
  documentId: string;
  /** Document is still loading; an empty buffer is not an empty file yet. */
  loading?: boolean | undefined;
  onOpenSource?: (() => void) | undefined;
  panelKey: string;
  path?: string | undefined;
  readOnly: boolean;
  t?: FilesTranslate | undefined;
  value: string;
}

export function CsvPreview({
  documentId,
  loading = false,
  onOpenSource,
  panelKey,
  path,
  readOnly,
  t,
  value,
}: CsvPreviewProps) {
  const [settings, setSettings] = useState<CsvFileSettings>(() =>
    readCsvSettings(documentId)
  );
  const [activeCell, setActiveCell] = useState<CsvActiveCell | null>(null);
  const activeCellResetRef = useRef(false);
  const settingsDocumentRef = useRef(documentId);
  const settingsResetRef = useRef(false);
  const widthTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  useEffect(() => {
    if (settingsDocumentRef.current === documentId) {
      return;
    }
    settingsDocumentRef.current = documentId;
    setSettings(readCsvSettings(documentId));
    setActiveCell(null);
  }, [documentId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the table shape changes.
  useEffect(() => {
    if (!settingsResetRef.current) {
      settingsResetRef.current = true;
      return;
    }
    setActiveCell(null);
  }, [settings.delimiter, settings.header]);

  const table = useMemo(
    () =>
      parseCsvWithDetection(
        value,
        path,
        settings.delimiter === "auto" ? undefined : settings.delimiter
      ),
    [path, settings.delimiter, value]
  );
  const header = settings.header;
  // biome-ignore lint/correctness/useExhaustiveDependencies: structural edits invalidate the old active cell.
  useEffect(() => {
    if (!activeCellResetRef.current) {
      activeCellResetRef.current = true;
      return;
    }
    setActiveCell(null);
  }, [table.columnCount, table.rows.length]);
  const rawHeaderLabels = useMemo(
    () => csvRawHeaderLabels(table, header),
    [header, table]
  );
  const structureKey = useMemo(
    () => csvColumnStructureKey(table.columnCount, rawHeaderLabels),
    [rawHeaderLabels, table.columnCount]
  );
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
    () => readCsvColumnWidths(documentId, structureKey) ?? {}
  );

  useEffect(() => {
    setColumnWidths(readCsvColumnWidths(documentId, structureKey) ?? {});
  }, [documentId, structureKey]);

  useEffect(
    () => () => {
      clearTimeout(widthTimerRef.current);
    },
    []
  );

  const handleColumnWidthsChange = useCallback(
    (next: Record<string, number>) => {
      setColumnWidths(next);
      clearTimeout(widthTimerRef.current);
      widthTimerRef.current = setTimeout(() => {
        widthTimerRef.current = undefined;
        writeCsvColumnWidths({ documentId, structureKey, widths: next });
      }, WIDTH_WRITE_DEBOUNCE_MS);
    },
    [documentId, structureKey]
  );

  const isLargeForEdit =
    value.length > CSV_EDIT_MAX_BYTES ||
    table.rows.length > CSV_EDIT_MAX_ROWS ||
    table.rows.length * Math.max(1, table.columnCount) > CSV_EDIT_MAX_CELLS;
  const isTooLargeForGrid = table.rows.length > CSV_PREVIEW_MAX_ROWS;
  const editable = !(readOnly || isLargeForEdit) && table.error === null;
  const newColumnLabel =
    t?.("filePanel.csv.newColumn", "Column {{name}}", {
      name: csvColumnLetter(table.columnCount),
    }) ?? `Column ${csvColumnLetter(table.columnCount)}`;
  const editor = useCsvEditor({
    activeCell,
    documentId,
    header,
    newColumnLabel,
    readOnly: !editable,
    table,
  });

  const updateSettings = useCallback(
    (next: CsvFileSettings) => {
      setSettings(next);
      writeCsvSettings(documentId, next);
    },
    [documentId]
  );

  const dataRowCount = Math.max(0, table.rows.length - (header ? 1 : 0));
  const canShowTableChrome =
    !loading && table.error === null && !isTooLargeForGrid;
  const registerHeader = useCsvHeaderState((state) => state.register);
  const unregisterHeader = useCsvHeaderState((state) => state.unregister);
  useEffect(() => {
    if (!canShowTableChrome) {
      unregisterHeader(panelKey);
      return;
    }
    const hasActiveCell =
      activeCell !== null &&
      activeCell.row < table.rows.length &&
      activeCell.column < table.columnCount;
    registerHeader(panelKey, {
      canRedo: editor.canRedo,
      canUndo: editor.canUndo,
      columnCount: table.columnCount,
      delimiter: settings.delimiter,
      deleteActiveColumn: editor.deleteActiveColumn,
      deleteActiveRow: editor.deleteActiveRow,
      editable,
      hasActiveCell,
      header,
      insertColumnLeft: () =>
        editor.insertColumn(
          hasActiveCell ? activeCell.column : table.columnCount
        ),
      insertColumnRight: () =>
        editor.insertColumn(
          hasActiveCell ? activeCell.column + 1 : table.columnCount
        ),
      insertRowAbove: () =>
        editor.insertRow(hasActiveCell ? activeCell.row : table.rows.length),
      insertRowBelow: () =>
        editor.insertRow(
          hasActiveCell ? activeCell.row + 1 : table.rows.length
        ),
      previewOnly: !(readOnly || editable),
      redo: editor.redo,
      rowCount: dataRowCount,
      setDelimiter: (delimiter) => updateSettings({ ...settings, delimiter }),
      setHeader: (next) => updateSettings({ ...settings, header: next }),
      undo: editor.undo,
    });
  }, [
    activeCell,
    dataRowCount,
    editable,
    editor,
    header,
    panelKey,
    readOnly,
    canShowTableChrome,
    registerHeader,
    settings,
    table.columnCount,
    table.rows.length,
    unregisterHeader,
    updateSettings,
  ]);
  useEffect(
    () => () => {
      unregisterHeader(panelKey);
    },
    [panelKey, unregisterHeader]
  );

  const handleKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "z"
      ) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, [contenteditable='true']")
      ) {
        return;
      }
      event.preventDefault();
      if (event.shiftKey) {
        editor.redo();
      } else {
        editor.undo();
      }
    },
    [editor]
  );

  const openSourceButton = onOpenSource ? (
    <Button onClick={onOpenSource} size="xs" type="button" variant="outline">
      {t?.("filePanel.csv.openSource", "Open source") ?? "Open source"}
    </Button>
  ) : null;

  if (loading) {
    return (
      <div
        aria-busy="true"
        aria-label={
          t?.("filePanel.csv.loading", "Loading table") ?? "Loading table"
        }
        className="h-full space-y-2 p-4"
        data-slot="file-csv-preview-loading"
        role="status"
      >
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  if (table.error) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileWarning />
          </EmptyMedia>
          <EmptyTitle>
            {t?.("filePanel.csv.parseFailed", "Couldn't read this table") ??
              "Couldn't read this table"}
          </EmptyTitle>
          <EmptyDescription>
            {t?.(
              "filePanel.csv.parseLocation",
              "Line {{line}}, column {{column}}",
              {
                column: table.error.column,
                line: table.error.line,
              }
            ) ?? `Line ${table.error.line}, column ${table.error.column}`}
          </EmptyDescription>
        </EmptyHeader>
        {openSourceButton ? (
          <EmptyContent>{openSourceButton}</EmptyContent>
        ) : null}
      </Empty>
    );
  }

  if (isTooLargeForGrid) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Table2 />
          </EmptyMedia>
          <EmptyTitle>
            {t?.(
              "filePanel.csv.tooLarge",
              "This table is too large to preview"
            ) ?? "This table is too large to preview"}
          </EmptyTitle>
          <EmptyDescription>
            {t?.(
              "filePanel.csv.tooLargeHint",
              "Open the source file to inspect it."
            ) ?? "Open the source file to inspect it."}
          </EmptyDescription>
        </EmptyHeader>
        {openSourceButton ? (
          <EmptyContent>{openSourceButton}</EmptyContent>
        ) : null}
      </Empty>
    );
  }

  if (table.rows.length === 0) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Table2 />
          </EmptyMedia>
          <EmptyTitle>
            {t?.("filePanel.csv.empty", "This file has no rows") ??
              "This file has no rows"}
          </EmptyTitle>
          <EmptyDescription>
            {t?.(
              "filePanel.csv.emptyHint",
              "Add a row to start editing, or open the source file."
            ) ?? "Add a row to start editing, or open the source file."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex items-center gap-2">
            {editable ? (
              <Button onClick={editor.addRow} size="xs" type="button">
                <Plus data-icon="inline-start" />
                {t?.("filePanel.csv.addRow", "Add row") ?? "Add row"}
              </Button>
            ) : null}
            {openSourceButton}
          </div>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="h-full min-h-0" onKeyDownCapture={handleKeyDownCapture}>
      <CsvGrid
        columnWidths={columnWidths}
        header={header}
        key={`${documentId}:${settings.delimiter}:${header ? "header" : "data"}:${table.columnCount}`}
        onActiveCellChange={setActiveCell}
        onColumnWidthsChange={handleColumnWidthsChange}
        onDeleteColumn={editor.deleteColumnAt}
        onDeleteRow={editor.deleteRowAt}
        onEdit={editor.applyEdits}
        onInsertColumn={editor.insertColumn}
        onInsertRow={editor.insertRow}
        readOnly={!editable}
        t={t}
        table={table}
      />
    </div>
  );
}
