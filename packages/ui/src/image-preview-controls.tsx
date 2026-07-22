import { ChevronDown, Minus, Plus } from "lucide-react";
import { Button } from "./button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./dropdown-menu.tsx";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  PRESET_ZOOM_LEVELS,
} from "./image-preview-canvas-math.ts";

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
  onZoomChange,
  onZoomIn,
  onZoomOut,
  zoom,
}: {
  effectiveZoom: number;
  labels: ImagePreviewCanvasLabels;
  onZoomChange: (zoom: number | "fit") => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  zoom: number | "fit";
}) {
  const zoomLabel = zoom === "fit" ? labels.fit : `${Math.round(zoom * 100)}%`;

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
          disabled={effectiveZoom <= MIN_ZOOM}
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
            className="z-[110] min-w-44"
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
              {PRESET_ZOOM_LEVELS.map((level) => (
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
          disabled={effectiveZoom >= MAX_ZOOM}
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
