import { Button } from "@pier/ui/button.tsx";
import {
  ImagePreviewCanvas,
  type ImagePreviewCanvasLabels,
} from "@pier/ui/image-preview/canvas.tsx";
import { NodeGraph } from "@pier/ui/node-graph.tsx";
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
import { acquireTerminalSurfaceSuppression } from "@/panel-kits/terminal/layout-coordinator.ts";
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
const PREVIEW_KEYBINDING_SCOPE = "overlay:content-preview" as const;
/** Host chrome and nested menus close first; preview is a content stage, not the top modal. */
const PREVIEW_ESC_YIELD_SELECTOR = [
  '[data-slot="dialog-content"][data-state="open"]',
  '[data-slot="alert-dialog-content"][data-state="open"]',
  '[data-slot="dropdown-menu-content"][data-state="open"]',
  '[data-slot="select-content"][data-state="open"]',
  '[data-slot="popover-content"][data-state="open"]',
  '[data-slot="context-menu-content"][data-state="open"]',
].join(",");

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

function NodeGraphPreviewBody({
  payload,
}: {
  payload: Extract<ContentPreviewPayload, { type: "node-graph" }>;
}) {
  const labels = useImagePreviewLabels();
  const stageControlLabels = useMemo(
    () => ({
      actualSize: labels.actualSize,
      controlsLabel: labels.controlsLabel,
      fit: labels.fit,
      zoomIn: labels.zoomIn,
      zoomLevel: labels.zoomLevel,
      zoomOut: labels.zoomOut,
    }),
    [labels]
  );

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col bg-background">
      <NodeGraph
        aria-label={payload["aria-label"]}
        direction={payload.direction}
        edges={payload.edges}
        expandable={false}
        nodes={payload.nodes}
        presentation="stage"
        stageControlLabels={stageControlLabels}
      />
    </div>
  );
}

function PreviewBody({ payload }: { payload: ContentPreviewPayload }) {
  if (payload.type === "image") {
    return <ImagePreviewBody alt={payload.alt ?? ""} source={payload.source} />;
  }
  if (payload.type === "node-graph") {
    return <NodeGraphPreviewBody payload={payload} />;
  }
  return null;
}

/**
 * Fullscreen content preview host (images + node graphs).
 *
 * Covers the workspace and titlebar (z-40, below host dialogs). Native Ghostty
 * is suppressed while open; EventRouter is hole-punched for the full viewport.
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
    useKeybindingScope.getState().pushBlockingScope(PREVIEW_KEYBINDING_SCOPE);
    queueMicrotask(() => {
      rootRef.current?.focus();
    });
    return () => {
      useKeybindingScope.getState().popBlockingScope(PREVIEW_KEYBINDING_SCOPE);
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
      if (document.querySelector(PREVIEW_ESC_YIELD_SELECTOR)) {
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
      className="app-no-drag fixed inset-0 z-40 bg-background outline-none"
      data-testid="content-preview"
      ref={rootRef}
      role="dialog"
      tabIndex={-1}
    >
      {/*
        pt-14 reserves the floating title / close band so images, mermaid, and
        node graphs never layout under the chrome (header is still painted on
        top for legibility over pan/zoom edges).
      */}
      <div
        className="absolute inset-0 z-0 flex flex-col pt-14"
        data-testid="content-preview-stage"
      >
        <PreviewBody payload={payload} />
      </div>
      {/*
        Chrome sits above the zoom/pan stage (DOM order + z-index). The preview
        root stays no-drag so pan/zoom does not move the window. The reserved
        title band is the drag handle; close opts out so the click is not
        swallowed, and also stops pointer propagation so canvas pan cannot
        steal it.
      */}
      <div
        className="app-drag absolute inset-x-0 top-0 z-50 flex h-14 items-start justify-center px-14 py-3"
        data-testid="content-preview-header"
      >
        <div className="min-w-0 max-w-full select-none truncate text-center text-foreground text-sm">
          {title}
        </div>
        <div className="app-no-drag pointer-events-auto absolute top-2 right-2">
          <Button
            aria-label={t("dialog.close")}
            className="app-no-drag border-border bg-background shadow-sm hover:bg-muted hover:text-foreground"
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
