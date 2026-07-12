import { Button } from "@pier/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@pier/ui/dropdown-menu.tsx";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@pier/ui/empty.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import { createFilePreviewUrl } from "@shared/file-preview-url.ts";
import { ChevronDown, ImageOff, ZoomIn, ZoomOut } from "lucide-react";
import {
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FilesDocument } from "./files-document-types.ts";
import type { FilesTranslate } from "./files-i18n.ts";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.1;
const PRESET_ZOOM_LEVELS = [0.25, 0.5, 1, 2, 4] as const;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value.toFixed(1))));
}

export function FileImagePreview({
  document,
  t,
}: {
  document: FilesDocument;
  t: FilesTranslate;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const canvasRef = useRef<HTMLElement>(null);
  const source = document.source;
  const preview = document.preview;
  const src = useMemo(() => {
    if (!(preview && source.kind === "disk")) {
      return "";
    }
    return createFilePreviewUrl({
      path: source.path,
      revision: preview.revision,
      root: source.root,
    });
  }, [preview, source]);

  const adjustZoom = useCallback((delta: number) => {
    setZoom((current) => clampZoom((current === "fit" ? 1 : current) + delta));
  }, []);
  const toggleZoom = useCallback(() => {
    setZoom((current) => (current === "fit" ? 1 : "fit"));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const handleDoubleClick = () => toggleZoom();
    const handleKeyDown = (event: KeyboardEvent) => {
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
    };
    canvas.addEventListener("dblclick", handleDoubleClick);
    canvas.addEventListener("keydown", handleKeyDown);
    return () => {
      canvas.removeEventListener("dblclick", handleDoubleClick);
      canvas.removeEventListener("keydown", handleKeyDown);
    };
  }, [adjustZoom, toggleZoom]);

  const handleImageError = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const failedUrl = event.currentTarget.getAttribute("src");
      if (failedUrl) {
        setFailedSrc(failedUrl);
      }
    },
    []
  );

  if (!(preview && src) || failedSrc === src) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ImageOff />
          </EmptyMedia>
          <EmptyTitle>
            {t("filePanel.image.loadFailed.title", "Unable to display image")}
          </EmptyTitle>
          <EmptyDescription>
            {t(
              "filePanel.image.loadFailed.description",
              "The image could not be loaded or changed after it was opened."
            )}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const zoomLabel =
    zoom === "fit"
      ? t("filePanel.image.fit", "Fit to window")
      : `${Math.round(zoom * 100)}%`;

  return (
    <div className="relative flex min-h-0 flex-1 bg-background">
      <section
        aria-label={t("filePanel.image.viewerLabel", "Image preview")}
        className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/20 p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset"
        ref={canvasRef}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the image canvas accepts documented zoom shortcuts when focused
        tabIndex={0}
      >
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: image load failures are scoped to the exact preview URL */}
        <img
          alt={document.name}
          className={cn(
            "object-contain",
            zoom === "fit" ? "max-h-full max-w-full" : "max-w-none"
          )}
          draggable={false}
          height={1}
          key={src}
          onError={handleImageError}
          src={src}
          style={{
            height: "auto",
            width: "auto",
            ...(zoom === "fit" ? {} : { zoom }),
          }}
          width={1}
        />
      </section>
      <TooltipProvider delayDuration={300}>
        <div
          aria-label={t("filePanel.image.controlsLabel", "Image controls")}
          className="absolute right-3 bottom-3 z-10 flex items-center gap-1"
          data-slot="file-image-controls"
          role="toolbar"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t("filePanel.image.zoomOut", "Zoom out")}
                disabled={zoom !== "fit" && zoom <= MIN_ZOOM}
                onClick={() => adjustZoom(-ZOOM_STEP)}
                size="icon-sm"
                type="button"
                variant="secondary"
              >
                <ZoomOut data-icon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t("filePanel.image.zoomOut", "Zoom out")}
            </TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={`${t("filePanel.image.zoomLevel", "Zoom level")}: ${zoomLabel}`}
                size="sm"
                type="button"
                variant="secondary"
              >
                <span className="min-w-10 font-mono tabular-nums">
                  {zoomLabel}
                </span>
                <ChevronDown data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44" side="top">
              <DropdownMenuRadioGroup
                onValueChange={(value) =>
                  setZoom(value === "fit" ? "fit" : Number(value))
                }
                value={zoom === "fit" ? "fit" : String(zoom)}
              >
                <DropdownMenuRadioItem value="fit">
                  {t("filePanel.image.fit", "Fit to window")}
                </DropdownMenuRadioItem>
                {PRESET_ZOOM_LEVELS.map((level) => (
                  <DropdownMenuRadioItem key={level} value={String(level)}>
                    {level * 100}%
                    {level === 1 ? (
                      <DropdownMenuShortcut className="pr-6">
                        {t("filePanel.image.actualSize", "Actual size")}
                      </DropdownMenuShortcut>
                    ) : null}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t("filePanel.image.zoomIn", "Zoom in")}
                disabled={zoom !== "fit" && zoom >= MAX_ZOOM}
                onClick={() => adjustZoom(ZOOM_STEP)}
                size="icon-sm"
                type="button"
                variant="secondary"
              >
                <ZoomIn data-icon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t("filePanel.image.zoomIn", "Zoom in")}
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  );
}
