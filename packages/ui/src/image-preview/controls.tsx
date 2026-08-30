import { ChevronDown, Copy, Minus, Plus } from "lucide-react";
import { useCallback, useState } from "react";
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

export interface ImagePreviewCanvasLabels {
  actualSize: string;
  controlsLabel: string;
  copyImage?: string;
  fit: string;
  loadFailedDescription: string;
  loadFailedTitle: string;
  loading: string;
  viewerLabel: string;
  zoomIn: string;
  zoomLevel: string;
  zoomOut: string;
}

export function ImagePreviewControls({
  effectiveZoom,
  labels,
  maxZoom = MAX_ZOOM,
  minZoom = MIN_ZOOM,
  onCopyImage,
  onZoomChange,
  onZoomIn,
  onZoomOut,
  zoom,
}: {
  effectiveZoom: number;
  labels: ImagePreviewCanvasLabels;
  /** Defaults to image-preview MAX_ZOOM (8). Mermaid stage passes 4. */
  maxZoom?: number | undefined;
  /** Defaults to image-preview MIN_ZOOM (0.1). Mermaid stage passes 0.12. */
  minZoom?: number | undefined;
  /** When provided (with `labels.copyImage`), appends a copy-image button. */
  onCopyImage?: () => Promise<void>;
  onZoomChange: (zoom: number | "fit") => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
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
  const zoomLabel = zoom === "fit" ? labels.fit : `${Math.round(zoom * 100)}%`;
  const presets = PRESET_ZOOM_LEVELS.filter((level) => level <= maxZoom);
  const showCopy = Boolean(onCopyImage && labels.copyImage);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-3 pt-2 pb-4">
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: stop empty-click dismiss on toolbar */}
      <div
        aria-label={labels.controlsLabel}
        className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border/60 bg-background/90 p-1 shadow-sm backdrop-blur-sm"
        data-slot="image-preview-controls"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        role="toolbar"
      >
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
              <DropdownMenuRadioItem value="fit">
                {labels.fit}
              </DropdownMenuRadioItem>
              {presets.map((level) => (
                <DropdownMenuRadioItem key={level} value={String(level)}>
                  {level * 100}%
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
            <div
              aria-hidden="true"
              className="mx-0.5 h-5 w-px shrink-0 bg-border/60"
            />
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
