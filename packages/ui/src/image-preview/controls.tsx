import { ChevronDown, Minus, Plus } from "lucide-react";
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

export interface ImagePreviewCanvasLabels {
  actualSize: string;
  controlsLabel: string;
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
  onZoomChange: (zoom: number | "fit") => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  zoom: number | "fit";
}) {
  const zoomLabel = zoom === "fit" ? labels.fit : `${Math.round(zoom * 100)}%`;
  const presets = PRESET_ZOOM_LEVELS.filter((level) => level <= maxZoom);

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
          <DropdownMenuContent align="center" className="min-w-44" side="top">
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
      </div>
    </div>
  );
}
