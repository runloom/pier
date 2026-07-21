import { ChevronDown, ImageOff, ZoomIn, ZoomOut } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type SyntheticEvent,
  useCallback,
  useState,
} from "react";
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./empty.tsx";
import { Skeleton } from "./skeleton.tsx";
import { cn } from "./utils.ts";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.1;
const PRESET_ZOOM_LEVELS = [0.25, 0.5, 1, 2, 4] as const;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(1))));
}

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

export interface ImagePreviewCanvasProps {
  alt: string;
  className?: string;
  labels: ImagePreviewCanvasLabels;
  /** When true, show the loading skeleton overlay (src may already be set). */
  loading?: boolean;
  /** Fired when the empty viewport chrome is clicked (not the image). */
  onEmptyClick?: () => void;
  onError?: (event: SyntheticEvent<HTMLImageElement>) => void;
  onLoad?: (event: SyntheticEvent<HTMLImageElement>) => void;
  src: string | null;
  /** Force the empty/error empty-state even when src is set. */
  status?: "error" | "loading" | "ready";
}

/**
 * Presentational zoomable image canvas.
 *
 * Layout: full-bleed viewport with a compact floating toolbar pinned to the
 * bottom center (does not reserve a footer strip; does not move with zoom).
 * Callers own ticket/URL lifecycle.
 */
export function ImagePreviewCanvas({
  alt,
  className,
  labels,
  loading = false,
  onEmptyClick,
  onError,
  onLoad,
  src,
  status,
}: ImagePreviewCanvasProps) {
  const [zoom, setZoom] = useState<number | "fit">("fit");
  let resolvedStatus: "error" | "loading" | "ready";
  if (status) {
    resolvedStatus = status;
  } else if (loading || !src) {
    resolvedStatus = "loading";
  } else {
    resolvedStatus = "ready";
  }

  const adjustZoom = useCallback((delta: number) => {
    setZoom((current) => clampZoom((current === "fit" ? 1 : current) + delta));
  }, []);
  const toggleZoom = useCallback(() => {
    setZoom((current) => (current === "fit" ? 1 : "fit"));
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        adjustZoom(ZOOM_STEP);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        adjustZoom(-ZOOM_STEP);
      } else if (event.key === "0") {
        event.preventDefault();
        setZoom(1);
      }
    },
    [adjustZoom]
  );

  const handleViewportClick = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (event.target === event.currentTarget) {
        onEmptyClick?.();
      }
    },
    [onEmptyClick]
  );

  const loadingIndicator =
    resolvedStatus === "loading" ? (
      <div
        className="absolute inset-3 flex items-center justify-center"
        role="status"
      >
        <span className="sr-only">{labels.loading}</span>
        <Skeleton className="h-2/3 w-2/3 max-w-2xl" />
      </div>
    ) : null;

  if (resolvedStatus === "loading" && !src) {
    return (
      // biome-ignore lint/a11y/noNoninteractiveElementInteractions: empty stage click closes preview
      // biome-ignore lint/a11y/useKeyWithClickEvents: Esc closes via host; click is pointer-only dismiss
      <section
        aria-busy="true"
        aria-label={labels.viewerLabel}
        className={cn(
          "relative flex min-h-0 flex-1 items-center justify-center bg-muted/20 p-3",
          className
        )}
        onClick={handleViewportClick}
      >
        {loadingIndicator}
      </section>
    );
  }

  if (!(src && resolvedStatus !== "error")) {
    return (
      // biome-ignore lint/a11y/noNoninteractiveElementInteractions: empty stage click closes preview
      // biome-ignore lint/a11y/noStaticElementInteractions: empty stage click closes preview
      // biome-ignore lint/a11y/useKeyWithClickEvents: Esc closes via host; click is pointer-only dismiss
      <div
        className={cn(
          "flex min-h-0 flex-1 items-center justify-center",
          className
        )}
        onClick={handleViewportClick}
      >
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ImageOff />
            </EmptyMedia>
            <EmptyTitle>{labels.loadFailedTitle}</EmptyTitle>
            <EmptyDescription>{labels.loadFailedDescription}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const zoomLabel = zoom === "fit" ? labels.fit : `${Math.round(zoom * 100)}%`;
  const showLoading = resolvedStatus === "loading";

  return (
    <div className={cn("relative min-h-0 flex-1 bg-background", className)}>
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: focusable canvas exposes documented zoom shortcuts */}
      <section
        aria-busy={showLoading}
        aria-label={labels.viewerLabel}
        className="absolute inset-0 flex items-center justify-center overflow-auto bg-background p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset"
        data-slot="image-preview-viewport"
        onClick={handleViewportClick}
        onDoubleClick={toggleZoom}
        onKeyDown={handleKeyDown}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: canvas accepts zoom shortcuts when focused
        tabIndex={0}
      >
        {loadingIndicator}
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: load failures are scoped to the preview URL */}
        <img
          alt={alt}
          className={cn(
            "object-contain",
            showLoading && "opacity-0",
            zoom === "fit" ? "max-h-full max-w-full" : "max-w-none"
          )}
          draggable={false}
          height={1}
          onError={onError}
          onLoad={onLoad}
          src={src}
          style={{
            height: "auto",
            width: "auto",
            ...(zoom === "fit" ? {} : { zoom }),
          }}
          width={1}
        />
      </section>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-3 pt-2 pb-4">
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: stop empty-click dismiss on toolbar */}
        <div
          aria-label={labels.controlsLabel}
          className="pointer-events-auto flex items-center gap-1 rounded-full bg-secondary p-1 shadow-sm"
          data-slot="image-preview-controls"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          role="toolbar"
        >
          <Button
            aria-label={labels.zoomOut}
            disabled={zoom !== "fit" && zoom <= MIN_ZOOM}
            onClick={() => adjustZoom(-ZOOM_STEP)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ZoomOut data-icon />
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
            {/*
              Content preview host sits at z-[100]; default menu portals
              use z-50 and would render underneath.
            */}
            <DropdownMenuContent
              align="center"
              className="z-[110] min-w-44"
              side="top"
            >
              <DropdownMenuRadioGroup
                onValueChange={(value) =>
                  setZoom(value === "fit" ? "fit" : Number(value))
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
            disabled={zoom !== "fit" && zoom >= MAX_ZOOM}
            onClick={() => adjustZoom(ZOOM_STEP)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <ZoomIn data-icon />
          </Button>
        </div>
      </div>
    </div>
  );
}
