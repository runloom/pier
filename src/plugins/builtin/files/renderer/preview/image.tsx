import {
  ImagePreviewCanvas,
  type ImagePreviewCanvasLabels,
} from "@pier/ui/image-preview/canvas.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FilesDocument } from "../document/types.ts";
import type { FilesTranslate } from "../i18n.ts";

export function FileImagePreview({
  context,
  document,
  t,
}: {
  context: Pick<RendererPluginContext, "filePreviews">;
  document: FilesDocument;
  t: FilesTranslate;
}) {
  const activePreviewRef = useRef<{
    generation: number;
    src: string;
    ticket: string;
  } | null>(null);
  const requestGenerationRef = useRef(0);
  const [src, setSrc] = useState("");
  const [loadState, setLoadState] = useState<"error" | "loading" | "ready">(
    "loading"
  );
  const source = document.source;
  const preview = document.preview;
  const previewMime = preview?.mime;
  const previewRevision = preview?.revision;
  const diskPath = source.kind === "disk" ? source.path : null;
  const diskRoot = source.kind === "disk" ? source.root : null;
  useEffect(() => {
    requestGenerationRef.current += 1;
    const requestGeneration = requestGenerationRef.current;
    if (!(previewMime && previewRevision && diskPath && diskRoot)) {
      const abandonedTicket = activePreviewRef.current?.ticket;
      activePreviewRef.current = null;
      setSrc("");
      setLoadState("error");
      if (abandonedTicket) {
        context.filePreviews.release(abandonedTicket).catch(() => undefined);
      }
      return;
    }
    setLoadState("loading");
    let cancelled = false;
    const previousTicket = activePreviewRef.current?.ticket;
    context.filePreviews
      .issue(
        {
          mime: previewMime,
          path: diskPath,
          revision: previewRevision,
          root: diskRoot,
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
  }, [context, diskPath, diskRoot, previewMime, previewRevision]);

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

  const previewForImageEvent = useCallback((element: HTMLImageElement) => {
    const eventUrl = element.getAttribute("src");
    const activePreview = activePreviewRef.current;
    if (
      !eventUrl ||
      activePreview?.src !== eventUrl ||
      requestGenerationRef.current !== activePreview.generation
    ) {
      return null;
    }
    return activePreview;
  }, []);

  const handleImageError = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const activePreview = previewForImageEvent(event.currentTarget);
      if (!activePreview) {
        return;
      }
      activePreviewRef.current = null;
      setLoadState("error");
      setSrc("");
      context.filePreviews.release(activePreview.ticket).catch(() => undefined);
    },
    [context, previewForImageEvent]
  );

  const handleImageLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      if (!previewForImageEvent(event.currentTarget)) {
        return;
      }
      setLoadState("ready");
    },
    [previewForImageEvent]
  );

  const labels = useMemo<ImagePreviewCanvasLabels>(
    () => ({
      actualSize: t("filePanel.image.actualSize", "Actual size"),
      controlsLabel: t("filePanel.image.controlsLabel", "Image controls"),
      fit: t("filePanel.image.fit", "Fit to window"),
      loadFailedDescription: t(
        "filePanel.image.loadFailed.description",
        "The image could not be loaded or changed after it was opened."
      ),
      loadFailedTitle: t(
        "filePanel.image.loadFailed.title",
        "Unable to display image"
      ),
      loading: t("filePanel.image.loading", "Loading image"),
      viewerLabel: t("filePanel.image.viewerLabel", "Image preview"),
      zoomIn: t("filePanel.image.zoomIn", "Zoom in"),
      zoomLevel: t("filePanel.image.zoomLevel", "Zoom level"),
      zoomOut: t("filePanel.image.zoomOut", "Zoom out"),
    }),
    [t]
  );

  return (
    <ImagePreviewCanvas
      alt={document.name}
      className="min-h-0 w-full flex-1 bg-background"
      labels={labels}
      loading={loadState === "loading"}
      onError={handleImageError}
      onLoad={handleImageLoad}
      src={src || null}
      status={loadState}
    />
  );
}
