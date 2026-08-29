import {
  ImagePreviewCanvas,
  type ImagePreviewCanvasLabels,
} from "@pier/ui/image-preview/canvas.tsx";
import {
  type SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useT } from "@/i18n/use-t.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import {
  type ContentPreviewImageSource,
  closeContentPreview,
} from "@/stores/content-preview.store.ts";

export function useImagePreviewLabels(): ImagePreviewCanvasLabels {
  const t = useT();
  return useMemo(
    () => ({
      actualSize: t("dialog.imagePreview.actualSize"),
      controlsLabel: t("dialog.imagePreview.controlsLabel"),
      copyImage: t("dialog.imagePreview.copyImage"),
      fit: t("dialog.imagePreview.fit"),
      loadFailedDescription: t("dialog.imagePreview.loadFailedDescription"),
      loadFailedTitle: t("dialog.imagePreview.loadFailedTitle"),
      loading: t("dialog.imagePreview.loading"),
      viewerLabel: t("dialog.imagePreview.viewerLabel"),
      zoomIn: t("dialog.imagePreview.zoomIn"),
      zoomLevel: t("dialog.imagePreview.zoomLevel"),
      zoomOut: t("dialog.imagePreview.zoomOut"),
    }),
    [t]
  );
}

function canWriteImageClipboard(): boolean {
  return (
    typeof window.ClipboardItem !== "undefined" &&
    typeof navigator.clipboard?.write === "function"
  );
}

function imageIsCopyable(image: HTMLImageElement): boolean {
  return image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
}

async function rasterizeHtmlImageToPng(image: HTMLImageElement): Promise<Blob> {
  if (typeof image.decode === "function") {
    await image.decode();
  }
  if (!imageIsCopyable(image)) {
    throw new Error("image is not decoded");
  }
  const { promise, resolve, reject } = Promise.withResolvers<Blob>();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    reject(new Error("Canvas 2D context unavailable"));
    return promise;
  }
  ctx.drawImage(image, 0, 0);
  canvas.toBlob((png) => {
    if (png) {
      resolve(png);
    } else {
      reject(new Error("Canvas toBlob failed"));
    }
  }, "image/png");
  return promise;
}

function initialSrc(
  source: ContentPreviewImageSource,
  placeholderSrc: string | undefined
): string | null {
  if (source.kind === "url") {
    return source.src;
  }
  return placeholderSrc ?? null;
}

export function ImagePreviewBody({
  alt,
  placeholderSrc,
  source,
}: {
  alt: string;
  placeholderSrc?: string | undefined;
  source: ContentPreviewImageSource;
}) {
  const labels = useImagePreviewLabels();
  const t = useT();
  const paintedSrc = initialSrc(source, placeholderSrc);
  const [src, setSrc] = useState<string | null>(paintedSrc);
  const [status, setStatus] = useState<"error" | "loading" | "ready">(() =>
    paintedSrc ? "ready" : "loading"
  );
  const liveRef = useRef<{ ticket: string; url: string } | null>(null);
  const pendingRef = useRef<{ ticket: string; url: string } | null>(null);
  const placeholderRef = useRef(placeholderSrc ?? null);
  placeholderRef.current = placeholderSrc ?? null;
  const srcRef = useRef(src);
  srcRef.current = src;
  const locator = source.kind === "url" ? source.src : source.path;
  const kind = source.kind;

  const releaseTicket = useCallback((ticket: string | null) => {
    if (!ticket) {
      return;
    }
    window.pier.mediaPreviews
      .releaseAbsolute({ ticket })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (kind === "url") {
      setSrc(locator);
      return;
    }
    let cancelled = false;
    setStatus((current) => (current === "ready" ? current : "loading"));
    window.pier.mediaPreviews
      .issueAbsolute({
        absolutePath: locator,
      })
      .then((result) => {
        if (cancelled) {
          if (result.issued) {
            releaseTicket(result.ticket);
          }
          return;
        }
        if (!result.issued) {
          if (srcRef.current || placeholderRef.current) {
            pendingRef.current = null;
            return;
          }
          pendingRef.current = null;
          liveRef.current = null;
          setSrc(null);
          setStatus("error");
          return;
        }
        pendingRef.current = { ticket: result.ticket, url: result.url };
        setSrc(result.url);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        if (srcRef.current || placeholderRef.current) {
          pendingRef.current = null;
          return;
        }
        pendingRef.current = null;
        liveRef.current = null;
        setSrc(null);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [kind, locator, releaseTicket]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: release leases when the preview locator changes
  useEffect(
    () => () => {
      releaseTicket(liveRef.current?.ticket ?? null);
      releaseTicket(pendingRef.current?.ticket ?? null);
      liveRef.current = null;
      pendingRef.current = null;
    },
    [kind, locator, releaseTicket]
  );

  const handleImageLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const eventUrl = event.currentTarget.getAttribute("src");
      const pending = pendingRef.current;
      if (pending && eventUrl === pending.url) {
        const live = liveRef.current;
        if (live && live.ticket !== pending.ticket) {
          releaseTicket(live.ticket);
        }
        liveRef.current = pending;
        pendingRef.current = null;
      }
      setStatus("ready");
    },
    [releaseTicket]
  );

  const handlePendingError = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    releaseTicket(pending?.ticket ?? null);
    const live = liveRef.current;
    if (live) {
      setSrc(live.url);
      setStatus("ready");
      return;
    }
    const fallback = placeholderRef.current;
    if (fallback) {
      setSrc(fallback);
      setStatus("ready");
      return;
    }
    setSrc(null);
    setStatus("error");
  }, [releaseTicket]);

  const handleError = useCallback(
    (_event: SyntheticEvent<HTMLImageElement>) => {
      if (pendingRef.current) {
        return;
      }
      const live = liveRef.current;
      liveRef.current = null;
      setStatus("error");
      setSrc(null);
      releaseTicket(live?.ticket ?? null);
    },
    [releaseTicket]
  );

  const handleCopyImage = useCallback(
    async (image: HTMLImageElement) => {
      if (!canWriteImageClipboard()) {
        return;
      }
      if (!imageIsCopyable(image)) {
        showAppAlert({
          title: t("dialog.imagePreview.copyImageFailed"),
          body: t("dialog.imagePreview.copyImageNotReady"),
        });
        return;
      }
      try {
        const blob = await rasterizeHtmlImageToPng(image);
        const item = new ClipboardItem({ "image/png": blob });
        await navigator.clipboard.write([item]);
        toast.success(t("dialog.imagePreview.imageCopied"));
      } catch (error) {
        const notReady =
          error instanceof Error && error.message === "image is not decoded";
        let body = String(error);
        if (notReady) {
          body = t("dialog.imagePreview.copyImageNotReady");
        } else if (error instanceof Error) {
          body = error.message;
        }
        showAppAlert({
          title: t("dialog.imagePreview.copyImageFailed"),
          body,
        });
      }
    },
    [t]
  );

  return (
    <ImagePreviewCanvas
      alt={alt}
      className="min-h-0 w-full flex-1 bg-background"
      labels={labels}
      loading={status === "loading"}
      {...(canWriteImageClipboard() ? { onCopyImage: handleCopyImage } : {})}
      onEmptyClick={closeContentPreview}
      onError={handleError}
      onLoad={handleImageLoad}
      onPendingError={handlePendingError}
      src={src}
      status={status}
    />
  );
}
