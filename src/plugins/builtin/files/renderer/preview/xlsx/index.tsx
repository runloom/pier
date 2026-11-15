import { Alert, AlertTitle } from "@pier/ui/alert.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FilesTranslate } from "../../i18n.ts";
import { DocumentPreviewFrame } from "../document/shell.tsx";
import {
  DocumentErrorState,
  DocumentLoadingState,
} from "../document/states.tsx";
import type { DocumentRenderError } from "../document/types.ts";
import { XlsxGrid } from "./grid.tsx";
import { XLSX_PARSE_TIMEOUT_MS } from "./limits.ts";
import {
  readXlsxColumnWidths,
  writeXlsxColumnWidths,
  xlsxColumnStructureKey,
} from "./preferences.ts";
import type { SerializedXlsxSheet } from "./protocol.ts";
import { SheetTabs } from "./sheet-tabs.tsx";
import { createXlsxWorker } from "./worker-client.ts";

let nextXlsxRequestId = 1;

const XLSX_WIDTH_WRITE_DEBOUNCE_MS = 250;

type XlsxState =
  | { error: null; sheets: null; status: "loading" }
  | { error: null; sheets: SerializedXlsxSheet[]; status: "ready" }
  | {
      error: Extract<DocumentRenderError, "parse-failed" | "zip-limit">;
      sheets: null;
      status: "error";
    };

export default function FileXlsxPreview(props: {
  bytes: Uint8Array;
  documentId: string;
  fileName: string;
  onOpenInDefaultApp?: (() => void) | undefined;
  onRetry: () => void;
  t: FilesTranslate;
}) {
  const { bytes, documentId, onOpenInDefaultApp, onRetry, t } = props;
  const [state, setState] = useState<XlsxState>({
    error: null,
    sheets: null,
    status: "loading",
  });
  const [selected, setSelected] = useState(0);
  const activeSheet =
    state.status === "ready"
      ? state.sheets[Math.min(selected, state.sheets.length - 1)]
      : undefined;
  const structureKey = activeSheet
    ? xlsxColumnStructureKey(activeSheet.name, activeSheet.columnCount)
    : null;
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const widthTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const pendingWidthsRef = useRef<{
    documentId: string;
    structureKey: string;
    widths: Record<string, number>;
  } | null>(null);

  const flushPendingWidths = useCallback(() => {
    const pending = pendingWidthsRef.current;
    if (!pending) {
      return;
    }
    pendingWidthsRef.current = null;
    writeXlsxColumnWidths(pending);
  }, []);

  // Widths belong to one worksheet shape. Read on sheet/key change and flush
  // the previous sheet's pending write first, so quickly switching sheets
  // cannot drop the resize the user just made.
  useEffect(() => {
    setColumnWidths(
      structureKey ? (readXlsxColumnWidths(documentId, structureKey) ?? {}) : {}
    );
    return () => {
      if (widthTimerRef.current !== undefined) {
        clearTimeout(widthTimerRef.current);
        widthTimerRef.current = undefined;
      }
      flushPendingWidths();
    };
  }, [documentId, flushPendingWidths, structureKey]);

  const handleColumnWidthsChange = useCallback(
    (next: Record<string, number>) => {
      setColumnWidths(next);
      if (!structureKey) {
        return;
      }
      pendingWidthsRef.current = {
        documentId,
        structureKey,
        widths: next,
      };
      if (widthTimerRef.current !== undefined) {
        clearTimeout(widthTimerRef.current);
      }
      widthTimerRef.current = setTimeout(() => {
        widthTimerRef.current = undefined;
        flushPendingWidths();
      }, XLSX_WIDTH_WRITE_DEBOUNCE_MS);
    },
    [documentId, flushPendingWidths, structureKey]
  );

  useEffect(() => {
    const worker = createXlsxWorker();
    let cancelled = false;
    const requestId = nextXlsxRequestId;
    nextXlsxRequestId += 1;
    setState({ error: null, sheets: null, status: "loading" });
    setSelected(0);

    const timer = setTimeout(() => {
      worker.terminate();
      if (!cancelled) {
        setState({ error: "parse-failed", sheets: null, status: "error" });
      }
    }, XLSX_PARSE_TIMEOUT_MS);

    worker.onmessage = (event) => {
      const response = event.data;
      if (cancelled || response.id !== requestId) {
        return;
      }
      clearTimeout(timer);
      if (response.kind === "ok") {
        setState({ error: null, sheets: response.sheets, status: "ready" });
      } else {
        setState({ error: response.code, sheets: null, status: "error" });
      }
    };
    worker.onerror = () => {
      clearTimeout(timer);
      if (!cancelled) {
        setState({ error: "parse-failed", sheets: null, status: "error" });
      }
    };
    worker.postMessage({ bytes: bytes.slice().buffer, id: requestId });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      worker.terminate();
    };
  }, [bytes]);

  if (state.status === "loading") {
    return (
      <DocumentPreviewFrame t={t}>
        <DocumentLoadingState t={t} />
      </DocumentPreviewFrame>
    );
  }
  if (state.status === "error") {
    return (
      <DocumentPreviewFrame t={t}>
        <DocumentErrorState
          error={state.error}
          {...(onOpenInDefaultApp ? { onOpenInDefaultApp } : {})}
          onRetry={onRetry}
          t={t}
        />
      </DocumentPreviewFrame>
    );
  }

  const sheetIndex = Math.min(selected, state.sheets.length - 1);
  const sheet = activeSheet;
  if (!sheet) {
    return (
      <DocumentPreviewFrame t={t}>
        <DocumentErrorState
          error="parse-failed"
          {...(onOpenInDefaultApp ? { onOpenInDefaultApp } : {})}
          onRetry={onRetry}
          t={t}
        />
      </DocumentPreviewFrame>
    );
  }

  return (
    <DocumentPreviewFrame
      className="overflow-hidden"
      fidelityNote={t(
        "filePanel.documentPreview.fidelity.xlsx",
        "Read-only preview. Formulas are shown as values; formatting may differ."
      )}
      footer={
        <SheetTabs
          activeIndex={sheetIndex}
          names={state.sheets.map((candidate) => candidate.name)}
          onSelect={setSelected}
          t={t}
        />
      }
      notice={
        sheet.truncated ? (
          <Alert
            data-slot="document-preview-xlsx-truncated"
            layout="infobar"
            variant="warning"
          >
            <AlertTitle>
              {sheet.truncatedReason === "offset"
                ? t(
                    "filePanel.documentPreview.xlsx.offsetTruncated",
                    "This sheet's used range starts below the preview row limit, so it can't be shown here. Open in the default app for the full sheet."
                  )
                : t(
                    "filePanel.documentPreview.xlsx.truncated",
                    "Showing {rows} rows × {columns} columns ({cells} cells). Open in the default app for the full sheet.",
                    {
                      cells: sheet.rowCount * sheet.columnCount,
                      columns: sheet.columnCount,
                      rows: sheet.rowCount,
                    }
                  )}
            </AlertTitle>
          </Alert>
        ) : null
      }
      {...(onOpenInDefaultApp ? { onOpenInDefaultApp } : {})}
      t={t}
    >
      <XlsxGrid
        columnWidths={columnWidths}
        onColumnWidthsChange={handleColumnWidthsChange}
        sheet={sheet}
        t={t}
      />
    </DocumentPreviewFrame>
  );
}
