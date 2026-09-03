import { Button } from "@pier/ui/button.tsx";
import { ImagePreviewPortalContainerContext } from "@pier/ui/image-preview/portal-scope.ts";
import { HtmlWorldCanvas } from "@pier/ui/image-preview/world-canvas.tsx";
import { Mermaid } from "@pier/ui/mermaid.tsx";
import { X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useT } from "@/i18n/use-t.ts";
import { acquireTerminalSurfaceSuppression } from "@/panel-kits/terminal/layout-coordinator.ts";
import {
  type ContentPreviewPayload,
  closeContentPreview,
  useContentPreviewStore,
} from "@/stores/content-preview.store.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import {
  registerTerminalFullscreenWebOverlay,
  requestTerminalWebFocus,
} from "@/stores/terminal-input-routing-slice.ts";
import {
  ImagePreviewBody,
  useImagePreviewLabels,
} from "./content-preview-image.tsx";

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

function MermaidPreviewBody({
  payload,
}: {
  payload: Extract<ContentPreviewPayload, { type: "mermaid" }>;
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
      <Mermaid
        aria-label={payload["aria-label"]}
        direction={payload.direction}
        edges={payload.edges}
        expandable={false}
        nodes={payload.nodes}
        presentation="stage"
        stageControlLabels={stageControlLabels}
        {...(payload.source ? { source: payload.source } : {})}
      />
    </div>
  );
}

function HtmlWorldPreviewBody({
  payload,
}: {
  payload: Extract<ContentPreviewPayload, { type: "html-world" }>;
}) {
  const labels = useImagePreviewLabels();
  return (
    <HtmlWorldCanvas
      className="min-h-0 w-full flex-1 bg-background"
      labels={labels}
      onEmptyClick={closeContentPreview}
      presentation="stage"
      viewerLabel={payload["aria-label"]}
    >
      {payload.render()}
    </HtmlWorldCanvas>
  );
}

function PreviewBody({ payload }: { payload: ContentPreviewPayload }) {
  if (payload.type === "image") {
    return (
      <ImagePreviewBody
        alt={payload.alt ?? ""}
        source={payload.source}
        {...(payload.placeholderSrc
          ? { placeholderSrc: payload.placeholderSrc }
          : {})}
      />
    );
  }
  if (payload.type === "mermaid") {
    return <MermaidPreviewBody payload={payload} />;
  }
  return <HtmlWorldPreviewBody payload={payload} />;
}

const PREVIEW_HISTORY_FLAG = "pierContentPreview" as const;

/**
 * Back-button / history semantics for the fullscreen preview: opening pushes
 * one entry, closing from our own UI unwinds it, and a user-initiated back
 * while open closes the preview instead of leaving the app page.
 */
function useContentPreviewHistoryBridge(open: boolean): void {
  const pushedRef = useRef(false);
  const suppressPopRef = useRef(false);

  useEffect(() => {
    if (!open) {
      if (pushedRef.current) {
        pushedRef.current = false;
        // Our own close: strip the marker synchronously so history.state
        // reads clean immediately, then consume the unwind popstate —
        // jsdom delivers it asynchronously (~ms) after back(), same as
        // browsers, so suppression must already be armed.
        history.replaceState(null, "");
        suppressPopRef.current = true;
        history.back();
      }
      return;
    }
    if (!pushedRef.current) {
      history.pushState({ [PREVIEW_HISTORY_FLAG]: true }, "");
      pushedRef.current = true;
    }
    const onPopState = () => {
      if (suppressPopRef.current) {
        suppressPopRef.current = false;
        return;
      }
      // User-driven navigation: the pushed entry is already gone.
      pushedRef.current = false;
      closeContentPreview();
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      // Unmounting while open intentionally leaves the pushed entry in
      // history: unwinding here would race StrictMode's open-remount
      // re-push (back() during a pending push lands ahead of the cursor).
      // Safe only because ContentPreviewHost mounts once for the app
      // lifetime; if it ever becomes conditionally mounted, unwind
      // explicitly on unmount instead.
    };
  }, [open]);
}

/**
 * Fullscreen content preview host (images, node graphs, HTML worlds).
 *
 * Covers the workspace and titlebar (z-40, below host dialogs). Native Ghostty
 * is suppressed while open; EventRouter is hole-punched for the full viewport.
 */

export function ContentPreviewHost() {
  const t = useT();
  const open = useContentPreviewStore((state) => state.open);
  useContentPreviewHistoryBridge(open);
  const title = useContentPreviewStore((state) => state.title);
  const payload = useContentPreviewStore((state) => state.payload);
  const rootRef = useRef<HTMLDivElement>(null);
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  // Stable identity: an inline ref would detach/attach on every host render,
  // churning the portal-container context (null → node) and double-rendering
  // consumers.
  const handleRootRef = useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node;
    // Publish as the portal container so floating chrome (zoom preset menu)
    // stays inside the color-mode token scope.
    setRootEl(node);
  }, []);

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

  // Image payloads may pin a fixed color mode (e.g. markdown reading paper);
  // the token scope on this root recolors backdrop, header chrome, and the
  // zoom controls in one pass. text-foreground matters: ghost controls only
  // set hover colors and otherwise inherit currentColor — without it the
  // subtree keeps the app theme's foreground over the flipped background.
  const colorMode =
    payload.type === "image" || payload.type === "mermaid"
      ? payload.colorMode
      : undefined;

  return (
    <div
      aria-label={title || t("dialog.contentPreview.title")}
      aria-modal="true"
      className="app-no-drag fixed inset-0 z-40 bg-background text-foreground outline-none"
      data-color-mode={colorMode}
      data-slot="content-preview"
      data-testid="content-preview"
      ref={handleRootRef}
      role="dialog"
      tabIndex={-1}
    >
      <ImagePreviewPortalContainerContext.Provider value={rootEl}>
        {/*
        Paper / grid fill the overlay. An opaque title bar covers the top so
        the filename cannot sit on the diagram. Fit insets still keep the
        default camera out from under the bar and the zoom pill.
      */}
        <div
          className="absolute inset-0 z-0 flex flex-col"
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
          className="app-drag absolute inset-x-0 top-0 z-50 flex h-14 items-center justify-center bg-background px-14"
          data-testid="content-preview-header"
        >
          <div className="min-w-0 max-w-full select-none truncate text-center text-foreground text-sm">
            {title}
          </div>
          <div className="app-no-drag pointer-events-auto absolute inset-y-0 right-2 flex items-center">
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
      </ImagePreviewPortalContainerContext.Provider>
    </div>
  );
}

/** @deprecated Use ContentPreviewHost. */
export const ImageLightboxHost = ContentPreviewHost;
