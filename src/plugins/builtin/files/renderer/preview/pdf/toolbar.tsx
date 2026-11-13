import { Button } from "@pier/ui/button.tsx";
import {
  ChevronLeft,
  ChevronRight,
  MoveHorizontal,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { FilesTranslate } from "../../i18n.ts";
import { PDF_MAX_ZOOM, PDF_MIN_ZOOM } from "./layout.ts";

export function PdfToolbar(props: {
  onPageChange: (page: number) => void;
  onZoomChange: (zoom: number) => void;
  pageNumber: number;
  t: FilesTranslate;
  totalPages: number;
  zoom: number;
}) {
  const { onPageChange, onZoomChange, pageNumber, t, totalPages, zoom } = props;
  const canGoBack = pageNumber > 1;
  const canGoForward = pageNumber < totalPages;
  return (
    <div
      aria-label={t(
        "filePanel.documentPreview.pdf.toolbarLabel",
        "PDF controls"
      )}
      className="flex h-7 w-full items-center gap-1"
      role="toolbar"
    >
      <Button
        aria-label={t(
          "filePanel.documentPreview.pdf.previousPage",
          "Previous page"
        )}
        disabled={!canGoBack}
        onClick={() => onPageChange(pageNumber - 1)}
        size="icon"
        type="button"
        variant="ghost"
      >
        <ChevronLeft aria-hidden data-icon />
      </Button>
      <span className="min-w-16 text-center text-xs tabular-nums">
        {t("filePanel.documentPreview.pdf.pageOf", "{page} / {total}", {
          page: pageNumber,
          total: totalPages,
        })}
      </span>
      <Button
        aria-label={t("filePanel.documentPreview.pdf.nextPage", "Next page")}
        disabled={!canGoForward}
        onClick={() => onPageChange(pageNumber + 1)}
        size="icon"
        type="button"
        variant="ghost"
      >
        <ChevronRight aria-hidden data-icon />
      </Button>
      <span aria-hidden className="mx-1 h-4 w-px bg-border" />
      <Button
        aria-label={t("filePanel.documentPreview.pdf.zoomOut", "Zoom out")}
        disabled={zoom <= PDF_MIN_ZOOM}
        onClick={() => onZoomChange(zoom / 1.25)}
        size="icon"
        type="button"
        variant="ghost"
      >
        <ZoomOut aria-hidden data-icon />
      </Button>
      <span className="min-w-12 text-center text-xs tabular-nums">
        {Math.round(zoom * 100)}%
      </span>
      <Button
        aria-label={t("filePanel.documentPreview.pdf.zoomIn", "Zoom in")}
        disabled={zoom >= PDF_MAX_ZOOM}
        onClick={() => onZoomChange(zoom * 1.25)}
        size="icon"
        type="button"
        variant="ghost"
      >
        <ZoomIn aria-hidden data-icon />
      </Button>
      <Button
        aria-label={t("filePanel.documentPreview.pdf.fitWidth", "Fit width")}
        aria-pressed={zoom === 1}
        onClick={() => onZoomChange(1)}
        size="icon"
        type="button"
        variant="ghost"
      >
        <MoveHorizontal aria-hidden data-icon />
      </Button>
    </div>
  );
}
