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

interface PreviewLease {
  generation: number;
  src: string;
  ticket: string;
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
  const livePreviewRef = useRef<PreviewLease | null>(null);
  const pendingPreviewRef = useRef<PreviewLease | null>(null);
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

  const releaseLease = useCallback(
    (lease: PreviewLease | null) => {
      if (!lease) {
        return;
      }
      context.filePreviews.release(lease.ticket).catch(() => undefined);
    },
    [context]
  );

  useEffect(() => {
    requestGenerationRef.current += 1;
    const requestGeneration = requestGenerationRef.current;
    if (!(previewMime && previewRevision && diskPath && diskRoot)) {
      const live = livePreviewRef.current;
      const pending = pendingPreviewRef.current;
      livePreviewRef.current = null;
      pendingPreviewRef.current = null;
      setSrc("");
      setLoadState("error");
      releaseLease(live);
      releaseLease(pending);
      return;
    }
    if (pendingPreviewRef.current && !livePreviewRef.current) {
      livePreviewRef.current = pendingPreviewRef.current;
      pendingPreviewRef.current = null;
    }
    if (!livePreviewRef.current?.src) {
      setLoadState("loading");
    }
    let cancelled = false;
    context.filePreviews
      .issue({
        mime: previewMime,
        path: diskPath,
        revision: previewRevision,
        root: diskRoot,
      })
      .then((result) => {
        if (requestGenerationRef.current !== requestGeneration) {
          if (result.issued) {
            context.filePreviews.release(result.ticket).catch(() => undefined);
          }
          return;
        }
        if (!result.issued) {
          if (cancelled) {
            return;
          }
          if (livePreviewRef.current) {
            pendingPreviewRef.current = null;
            return;
          }
          pendingPreviewRef.current = null;
          livePreviewRef.current = null;
          setSrc("");
          setLoadState("error");
          return;
        }
        if (cancelled) {
          context.filePreviews.release(result.ticket).catch(() => undefined);
          return;
        }
        pendingPreviewRef.current = {
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
        if (livePreviewRef.current) {
          pendingPreviewRef.current = null;
          return;
        }
        pendingPreviewRef.current = null;
        livePreviewRef.current = null;
        setSrc("");
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [context, diskPath, diskRoot, previewMime, previewRevision, releaseLease]);

  useEffect(
    () => () => {
      releaseLease(livePreviewRef.current);
      releaseLease(pendingPreviewRef.current);
      livePreviewRef.current = null;
      pendingPreviewRef.current = null;
    },
    [releaseLease]
  );

  const handleImageLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const eventUrl = event.currentTarget.getAttribute("src");
      const pending = pendingPreviewRef.current;
      const live = livePreviewRef.current;
      if (pending && pending.src === eventUrl) {
        if (live && live.ticket !== pending.ticket) {
          releaseLease(live);
        }
        livePreviewRef.current = pending;
        pendingPreviewRef.current = null;
        setLoadState("ready");
        return;
      }
      if (live && live.src === eventUrl) {
        setLoadState("ready");
      }
    },
    [releaseLease]
  );

  const handlePendingError = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const eventUrl = event.currentTarget.getAttribute("src");
      const pending = pendingPreviewRef.current;
      if (!(pending && pending.src === eventUrl)) {
        return;
      }
      pendingPreviewRef.current = null;
      releaseLease(pending);
      const live = livePreviewRef.current;
      setSrc(live?.src ?? "");
    },
    [releaseLease]
  );

  const handleImageError = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const eventUrl = event.currentTarget.getAttribute("src");
      const live = livePreviewRef.current;
      if (pendingPreviewRef.current) {
        return;
      }
      if (!(live && live.src === eventUrl)) {
        return;
      }
      if (live.generation !== requestGenerationRef.current) {
        return;
      }
      livePreviewRef.current = null;
      setLoadState("error");
      setSrc("");
      releaseLease(live);
    },
    [releaseLease]
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
      chrome="board"
      className="min-h-0 w-full flex-1 bg-background"
      labels={labels}
      loading={loadState === "loading"}
      onError={handleImageError}
      onLoad={handleImageLoad}
      onPendingError={handlePendingError}
      src={src || null}
      status={loadState}
    />
  );
}
