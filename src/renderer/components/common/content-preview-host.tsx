import { Button } from "@pier/ui/button.tsx";
import {
  ImagePreviewCanvas,
  type ImagePreviewCanvasLabels,
} from "@pier/ui/image-preview-canvas.tsx";
import { X } from "lucide-react";
import {
  type SyntheticEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useT } from "@/i18n/use-t.ts";
import { acquireTerminalSurfaceSuppression } from "@/panel-kits/terminal/terminal-layout-coordinator.ts";
import {
  type ContentPreviewImageSource,
  type ContentPreviewPayload,
  closeContentPreview,
  useContentPreviewStore,
} from "@/stores/content-preview.store.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import {
  registerTerminalFullscreenWebOverlay,
  requestTerminalWebFocus,
} from "@/stores/terminal-input-routing-slice.ts";

const PREVIEW_OVERLAY_ID = "content-preview";
const PREVIEW_SCOPE_ID = "overlay:content-preview";

function useImagePreviewLabels(): ImagePreviewCanvasLabels {
  const t = useT();
  return useMemo(
    () => ({
      actualSize: t("dialog.imagePreview.actualSize"),
      controlsLabel: t("dialog.imagePreview.controlsLabel"),
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

function ImagePreviewBody({
  alt,
  source,
}: {
  alt: string;
  source: ContentPreviewImageSource;
}) {
  const labels = useImagePreviewLabels();
  const [src, setSrc] = useState<string | null>(
    source.kind === "url" ? source.src : null
  );
  const [status, setStatus] = useState<"error" | "loading" | "ready">(
    "loading"
  );
  const ticketRef = useRef<string | null>(null);

  useEffect(() => {
    if (source.kind === "url") {
      setSrc(source.src);
      setStatus("loading");
      return;
    }
    let cancelled = false;
    const previousTicket = ticketRef.current;
    setStatus("loading");
    setSrc(null);
    window.pier.mediaPreviews
      .issueAbsolute({
        absolutePath: source.path,
        ...(previousTicket ? { previousTicket } : {}),
      })
      .then((result) => {
        if (cancelled) {
          if (result.issued) {
            window.pier.mediaPreviews
              .releaseAbsolute({ ticket: result.ticket })
              .catch(() => undefined);
          }
          return;
        }
        if (!result.issued) {
          ticketRef.current = null;
          setSrc(null);
          setStatus("error");
          return;
        }
        ticketRef.current = result.ticket;
        setSrc(result.url);
        setStatus("loading");
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        ticketRef.current = null;
        setSrc(null);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  useEffect(
    () => () => {
      const ticket = ticketRef.current;
      if (ticket) {
        window.pier.mediaPreviews
          .releaseAbsolute({ ticket })
          .catch(() => undefined);
        ticketRef.current = null;
      }
    },
    []
  );

  const handleError = (_event: SyntheticEvent<HTMLImageElement>) => {
    const ticket = ticketRef.current;
    ticketRef.current = null;
    setStatus("error");
    setSrc(null);
    if (ticket) {
      window.pier.mediaPreviews
        .releaseAbsolute({ ticket })
        .catch(() => undefined);
    }
  };

  return (
    <ImagePreviewCanvas
      alt={alt}
      className="min-h-0 w-full flex-1 bg-background"
      labels={labels}
      loading={status === "loading"}
      onEmptyClick={closeContentPreview}
      onError={handleError}
      onLoad={() => setStatus("ready")}
      src={src}
      status={status}
    />
  );
}

function PreviewBody({ payload }: { payload: ContentPreviewPayload }) {
  if (payload.type === "image") {
    return <ImagePreviewBody alt={payload.alt ?? ""} source={payload.source} />;
  }
  return null;
}

/**
 * Fullscreen content preview host (images now; diagrams/flowcharts later).
 *
 * Opaque full-window stage covering the titlebar. Native Ghostty is suppressed
 * while open; EventRouter is hole-punched for the full viewport.
 */
export function ContentPreviewHost() {
  const t = useT();
  const open = useContentPreviewStore((state) => state.open);
  const title = useContentPreviewStore((state) => state.title);
  const payload = useContentPreviewStore((state) => state.payload);
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const overlay = registerTerminalFullscreenWebOverlay(PREVIEW_OVERLAY_ID);
    const releaseFocus = requestTerminalWebFocus(PREVIEW_OVERLAY_ID);
    const releaseSurface =
      acquireTerminalSurfaceSuppression(PREVIEW_OVERLAY_ID);
    useKeybindingScope.getState().pushBlockingScope(PREVIEW_SCOPE_ID);
    queueMicrotask(() => {
      rootRef.current?.focus();
    });
    return () => {
      useKeybindingScope.getState().popBlockingScope(PREVIEW_SCOPE_ID);
      releaseSurface();
      releaseFocus();
      overlay.dispose();
    };
  }, [open]);

  // Capture-phase Esc so close works even when focus sits on the image canvas
  // or another descendant. Nested floating menus (zoom dropdown) dismiss first.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (
        document.querySelector(
          '[data-slot="dropdown-menu-content"][data-state="open"], [data-slot="select-content"][data-state="open"], [data-slot="popover-content"][data-state="open"], [data-slot="context-menu-content"][data-state="open"]'
        )
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      closeContentPreview();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  if (!(open && payload)) {
    return null;
  }

  return (
    <div
      aria-label={title || t("dialog.contentPreview.title")}
      aria-modal="true"
      className="app-no-drag fixed inset-0 z-[100] bg-background outline-none"
      data-testid="content-preview"
      ref={rootRef}
      role="dialog"
      tabIndex={-1}
    >
      <div
        className="absolute inset-0 z-0 flex flex-col"
        data-testid="content-preview-stage"
      >
        <PreviewBody payload={payload} />
      </div>
      {/*
        Chrome sits above the zoom/pan stage (DOM order + z-index). The whole
        preview opts out of Electron titlebar drag; the close control also
        stops pointer propagation so canvas pan capture cannot steal the click.
      */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-50 flex items-center justify-center px-14 py-3"
        data-testid="content-preview-header"
      >
        <div className="min-w-0 max-w-full truncate text-center text-foreground text-sm">
          {title}
        </div>
        <div className="pointer-events-auto absolute top-2 right-2">
          <Button
            aria-label={t("dialog.close")}
            className="border-border bg-background shadow-sm hover:bg-muted hover:text-foreground"
            data-testid="content-preview-close"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              closeContentPreview();
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <X data-icon />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** @deprecated Use ContentPreviewHost. */
export const ImageLightboxHost = ContentPreviewHost;
