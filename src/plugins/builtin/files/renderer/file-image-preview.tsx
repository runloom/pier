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
import { Skeleton } from "@pier/ui/skeleton.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@pier/ui/tooltip.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { ChevronDown, ImageOff, ZoomIn, ZoomOut } from "lucide-react";
import {
  type KeyboardEvent,
  type SyntheticEvent,
  useCallback,
  useEffect,
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
  context,
  document,
  t,
}: {
  context: Pick<RendererPluginContext, "filePreviews">;
  document: FilesDocument;
  t: FilesTranslate;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const activePreviewRef = useRef<{
    generation: number;
    src: string;
    ticket: string;
  } | null>(null);
  const requestGenerationRef = useRef(0);
  const [renderGeneration, setRenderGeneration] = useState(0);
  const [src, setSrc] = useState("");
  const [loadState, setLoadState] = useState<"error" | "loading" | "ready">(
    "loading"
  );
  const source = document.source;
  const preview = document.preview;
  useEffect(() => {
    requestGenerationRef.current += 1;
    const requestGeneration = requestGenerationRef.current;
    if (!(preview && source.kind === "disk")) {
      const abandonedTicket = activePreviewRef.current?.ticket;
      activePreviewRef.current = null;
      setFailedSrc(null);
      setSrc("");
      setLoadState("error");
      if (abandonedTicket) {
        context.filePreviews.release(abandonedTicket).catch(() => undefined);
      }
      return;
    }
    setLoadState("loading");
    setFailedSrc(null);
    let cancelled = false;
    const previousTicket = activePreviewRef.current?.ticket;
    context.filePreviews
      .issue(
        {
          mime: preview.mime,
          path: source.path,
          revision: preview.revision,
          root: source.root,
        },
        previousTicket
      )
      .then((result) => {
        if (requestGenerationRef.current !== requestGeneration) {
          if (result.issued) {
            context.filePreviews.release(result.ticket).catch(() => undefined);
          }
          return;
        }
        if (!result.issued) {
          if (!cancelled) {
            const abandonedTicket = activePreviewRef.current?.ticket;
            activePreviewRef.current = null;
            setSrc("");
            setLoadState("error");
            if (abandonedTicket) {
              context.filePreviews
                .release(abandonedTicket)
                .catch(() => undefined);
            }
          }
          return;
        }
        if (cancelled) {
          context.filePreviews.release(result.ticket).catch(() => undefined);
          return;
        }
        activePreviewRef.current = {
          generation: requestGeneration,
          src: result.url,
          ticket: result.ticket,
        };
        setFailedSrc(null);
        setRenderGeneration(requestGeneration);
        setSrc(result.url);
      })
      .catch(() => {
        if (cancelled || requestGenerationRef.current !== requestGeneration) {
          return;
        }
        const abandonedTicket = activePreviewRef.current?.ticket;
        activePreviewRef.current = null;
        setSrc("");
        setLoadState("error");
        if (abandonedTicket) {
          context.filePreviews.release(abandonedTicket).catch(() => undefined);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [context, preview, source]);

  useEffect(
    () => () => {
      const ticket = activePreviewRef.current?.ticket;
      if (ticket) {
        context.filePreviews.release(ticket).catch(() => undefined);
        activePreviewRef.current = null;
      }
    },
    [context]
  );

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

  const previewForImageEvent = useCallback((element: HTMLImageElement) => {
    const eventGeneration = Number(element.dataset.previewGeneration);
    const eventUrl = element.getAttribute("src");
    const activePreview = activePreviewRef.current;
    if (
      !eventUrl ||
      activePreview?.generation !== eventGeneration ||
      activePreview.src !== eventUrl ||
      requestGenerationRef.current !== eventGeneration
    ) {
      return null;
    }
    return activePreview;
  }, []);

  const handleImageError = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const failedUrl = event.currentTarget.getAttribute("src");
      const activePreview = previewForImageEvent(event.currentTarget);
      if (!(failedUrl && activePreview)) {
        return;
      }
      activePreviewRef.current = null;
      setLoadState("error");
      setFailedSrc(failedUrl);
      context.filePreviews.release(activePreview.ticket).catch(() => undefined);
    },
    [context, previewForImageEvent]
  );

  const handleImageLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      if (!previewForImageEvent(event.currentTarget)) {
        return;
      }
      setFailedSrc(null);
      setLoadState("ready");
    },
    [previewForImageEvent]
  );

  const loading = loadState === "loading";
  const loadingLabel = t("filePanel.image.loading", "Loading image");
  const loadingIndicator = loading ? (
    <div
      className="absolute inset-3 flex items-center justify-center"
      role="status"
    >
      <span className="sr-only">{loadingLabel}</span>
      <Skeleton className="h-2/3 w-2/3 max-w-2xl" />
    </div>
  ) : null;

  if (preview && loading && !src) {
    return (
      <section
        aria-busy="true"
        aria-label={t("filePanel.image.viewerLabel", "Image preview")}
        className="relative flex min-h-0 flex-1 items-center justify-center bg-muted/20 p-3"
      >
        {loadingIndicator}
      </section>
    );
  }

  if (!(preview && src) || loadState === "error" || failedSrc === src) {
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
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: the focusable image canvas exposes documented keyboard and double-click zoom controls */}
      <section
        aria-busy={loading}
        aria-label={t("filePanel.image.viewerLabel", "Image preview")}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/20 p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset"
        onDoubleClick={toggleZoom}
        onKeyDown={handleKeyDown}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the image canvas accepts documented zoom shortcuts when focused
        tabIndex={0}
      >
        {loadingIndicator}
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: image load failures are scoped to the exact preview URL */}
        <img
          alt={document.name}
          className={cn(
            "object-contain",
            loading && "opacity-0",
            zoom === "fit" ? "max-h-full max-w-full" : "max-w-none"
          )}
          data-preview-generation={renderGeneration}
          draggable={false}
          height={1}
          key={`${renderGeneration}:${src}`}
          onError={handleImageError}
          onLoad={handleImageLoad}
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
          hidden={loading}
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
