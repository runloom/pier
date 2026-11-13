import { useCallback, useEffect, useState } from "react";
import type { FilesTranslate } from "../../i18n.ts";
import { DocumentPreviewFrame } from "../document/shell.tsx";
import {
  DocumentErrorState,
  DocumentLoadingState,
} from "../document/states.tsx";
import type {
  DocumentPreviewContext,
  DocumentRenderError,
} from "../document/types.ts";
import { useDocumentExternalLink } from "../document/use-external-link.ts";
import { clampPdfPageNumber, clampPdfZoom } from "./layout.ts";
import { PdfPage } from "./page.tsx";
import { PdfToolbar } from "./toolbar.tsx";
import { usePdfDocument } from "./use-document.ts";
import "./pdf-text-layer.css";

export default function FilePdfPreview(props: {
  bytes: Uint8Array;
  context: Pick<
    DocumentPreviewContext,
    "dialogs" | "externalNavigation" | "notifications"
  >;
  fileName: string;
  onOpenInDefaultApp?: (() => void) | undefined;
  onRetry: () => void;
  t: FilesTranslate;
}) {
  const { bytes, context, fileName, onOpenInDefaultApp, onRetry, t } = props;
  const state = usePdfDocument(bytes);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [renderAttempt, setRenderAttempt] = useState(0);
  const [renderFailure, setRenderFailure] = useState<{
    error: DocumentRenderError;
    key: string;
  } | null>(null);
  const handleExternalLink = useDocumentExternalLink({ context, t });
  const totalPages = state.status === "ready" ? state.pdf.numPages : 1;
  const safePageNumber = clampPdfPageNumber(pageNumber, totalPages);
  // A failure belongs to the exact page/zoom/attempt that produced it; a
  // different render key automatically retires stale error state.
  const renderKey = `${state.status}:${safePageNumber}:${zoom}:${renderAttempt}`;
  const renderError =
    renderFailure?.key === renderKey ? renderFailure.error : null;
  const handleRenderError = useCallback(
    () => setRenderFailure({ error: "render-failed", key: renderKey }),
    [renderKey]
  );

  useEffect(() => {
    setPageNumber((current) => clampPdfPageNumber(current, totalPages));
  }, [totalPages]);

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
  if (renderError) {
    return (
      <DocumentPreviewFrame t={t}>
        <DocumentErrorState
          error={renderError}
          {...(onOpenInDefaultApp ? { onOpenInDefaultApp } : {})}
          onRetry={() => {
            setRenderFailure(null);
            setRenderAttempt((attempt) => attempt + 1);
          }}
          t={t}
        />
      </DocumentPreviewFrame>
    );
  }

  return (
    <DocumentPreviewFrame
      className="overflow-auto bg-muted/40"
      {...(onOpenInDefaultApp ? { onOpenInDefaultApp } : {})}
      t={t}
      toolbar={
        <PdfToolbar
          onPageChange={setPageNumber}
          onZoomChange={(next) => setZoom(clampPdfZoom(next))}
          pageNumber={safePageNumber}
          t={t}
          totalPages={state.pdf.numPages}
          zoom={zoom}
        />
      }
    >
      <div className="flex min-h-full justify-center p-4">
        <PdfPage
          fileName={fileName}
          key={renderAttempt}
          onExternalLink={handleExternalLink}
          onNavigatePage={(pageIndex) => setPageNumber(pageIndex + 1)}
          onRenderError={handleRenderError}
          pageNumber={safePageNumber}
          pdf={state.pdf}
          t={t}
          zoom={zoom}
        />
      </div>
    </DocumentPreviewFrame>
  );
}
