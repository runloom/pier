import { ChevronDown, Copy, Minus, Plus } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { Button } from "../button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../dropdown-menu.tsx";
import { MAX_ZOOM, MIN_ZOOM, PRESET_ZOOM_LEVELS } from "./canvas-math.ts";
import { useImagePreviewPortalContainer } from "./portal-scope.ts";

/** Shared zoom-pill copy. Camera surfaces also pass `fit`. */
export interface ImagePreviewZoomLabels {
  actualSize: string;
  controlsLabel: string;
  copyImage?: string;
  fit?: string;
  zoomIn: string;
  zoomLevel: string;
  zoomOut: string;
}

export interface ImagePreviewCanvasLabels extends ImagePreviewZoomLabels {
  fit: string;
  loadFailedDescription: string;
  loadFailedTitle: string;
  loading: string;
  viewerLabel: string;
}

function ToolbarRule(): ReactNode {
  return (
    <div aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border/60" />
  );
}

function formatZoomPercent(level: number): string {
  return `${Math.round(level * 100)}%`;
}

/**
 * Shared preview zoom pill (image / mermaid / canvas world / markdown reading).
 * Always bottom-right; comment n/N stays bottom-center.
 * Camera surfaces keep Fit + PRESET_ZOOM_LEVELS; reading zoom passes discrete
 * presets and `includeFit={false}`.
 */
export function ImagePreviewControls({
  effectiveZoom,
  includeFit = true,
  labels,
  maxZoom = MAX_ZOOM,
  minZoom = MIN_ZOOM,
  onCopyImage,
  onZoomChange,
  onZoomIn,
  onZoomOut,
  presets = PRESET_ZOOM_LEVELS,
  start,
  zoom,
}: {
  effectiveZoom: number;
  /** Camera menus include Fit; markdown reading scale does not. */
  includeFit?: boolean;
  labels: ImagePreviewZoomLabels;
  maxZoom?: number | undefined;
  minZoom?: number | undefined;
  /** When provided (with `labels.copyImage`), appends a copy-image button. */
  onCopyImage?: () => Promise<void>;
  onZoomChange: (zoom: number | "fit") => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  presets?: readonly number[];
  /** Leading cluster in the same pill (optional, e.g. copy lives at the end). */
  start?: ReactNode;
  zoom: number | "fit";
}) {
  const [copying, setCopying] = useState(false);
  // Portal into the pinned color-mode overlay (when hosted inside one) so the
  // zoom preset menu inherits the scoped tokens instead of the app theme.
  const portalContainer = useImagePreviewPortalContainer();
  const handleCopy = useCallback(async () => {
    if (copying || !onCopyImage) {
      return;
    }
    setCopying(true);
    try {
      await onCopyImage();
    } finally {
      setCopying(false);
    }
  }, [copying, onCopyImage]);
  const zoomLabel =
    zoom === "fit"
      ? (labels.fit ?? formatZoomPercent(effectiveZoom))
      : formatZoomPercent(zoom);
  const menuLevels = presets.filter(
    (level) => level >= minZoom && level <= maxZoom
  );
  const showCopy = Boolean(onCopyImage && labels.copyImage);
  const showFit = includeFit && Boolean(labels.fit);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-end px-3 pt-2 pb-4">
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: stop empty-click dismiss on toolbar */}
      <div
        aria-label={labels.controlsLabel}
        // Opaque fill. Backdrop blur samples the transparent WebContentsView
        // and leaves Ghostty afterimages while the panel resizes.
        className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border/60 bg-background p-1 shadow-sm"
        data-slot="image-preview-controls"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        role="toolbar"
      >
        {start ? (
          <>
            {start}
            <ToolbarRule />
          </>
        ) : null}
        <Button
          aria-label={labels.zoomOut}
          disabled={effectiveZoom <= minZoom}
          onClick={onZoomOut}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Minus data-icon />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={`${labels.zoomLevel}: ${zoomLabel}`}
              size="sm"
              type="button"
              variant="ghost"
            >
              <span className="min-w-10 font-mono tabular-nums">
                {zoomLabel}
              </span>
              <ChevronDown data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="center"
            className="min-w-44"
            container={portalContainer}
            side="top"
          >
            <DropdownMenuRadioGroup
              onValueChange={(value) =>
                onZoomChange(value === "fit" ? "fit" : Number(value))
              }
              value={zoom === "fit" ? "fit" : String(zoom)}
            >
              {showFit ? (
                <DropdownMenuRadioItem value="fit">
                  {labels.fit}
                </DropdownMenuRadioItem>
              ) : null}
              {menuLevels.map((level) => (
                <DropdownMenuRadioItem key={level} value={String(level)}>
                  {formatZoomPercent(level)}
                  {level === 1 ? (
                    <DropdownMenuShortcut className="pr-6">
                      {labels.actualSize}
                    </DropdownMenuShortcut>
                  ) : null}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          aria-label={labels.zoomIn}
          disabled={effectiveZoom >= maxZoom}
          onClick={onZoomIn}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Plus data-icon />
        </Button>
        {showCopy ? (
          <>
            <ToolbarRule />
            <Button
              aria-label={labels.copyImage}
              disabled={copying}
              onClick={handleCopy}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Copy data-icon />
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
