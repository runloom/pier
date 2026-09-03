import { Alert, AlertDescription } from "@pier/ui/alert.tsx";
import { MediaFullscreenButton } from "@pier/ui/image-preview/media-fullscreen-button.tsx";
import { isPlainSurfaceClick } from "@pier/ui/media/surface-open.ts";
import { Skeleton } from "@pier/ui/skeleton.tsx";
import { cn } from "@pier/ui/utils.ts";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  applySvgDisplaySize,
  computeNaturalCappedSize,
  contentBoxWidthPx,
  parseSvgIntrinsicSize,
} from "./diagram-viewport.ts";
import {
  MARKDOWN_DIAGRAM_MAX_HEIGHT_CLASS,
  useMarkdownPreviewPrefsStore,
} from "./preview-preferences.ts";
import { forwardWheelToMarkdownPreview } from "./scroll-handoff.ts";

export function MarkdownDiagram({
  charts,
  colorMode,
  contentPreview,
  errorLabel,
  label,
  openFullscreenLabel,
  previewTitle,
  source,
}: {
  charts: RendererPluginContext["charts"];
  /**
   * Resolved preview color mode (fixed reading paper wins over app chrome).
   * The fullscreen overlay pins the same mode so chrome matches the paper.
   */
  colorMode: "dark" | "light";
  contentPreview:
    | Pick<RendererPluginContext["contentPreview"], "openMermaid">
    | undefined;
  errorLabel: string;
  label: string;
  openFullscreenLabel: string;
  previewTitle: string;
  source: string;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; svg: string }
  >({ status: "loading" });
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  /** Keep last successful SVG while re-rendering so the diagram does not flash empty. */
  const lastReadySvgRef = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [shellEl, setShellEl] = useState<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const blockHeightLimit = useMarkdownPreviewPrefsStore(
    (state) => state.blockHeightLimit
  );
  const heightCapped = blockHeightLimit === "capped";

  const shellRef = useCallback((node: HTMLDivElement | null) => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    setShellEl(node);
    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }
    const update = () => {
      const width = contentBoxWidthPx(node);
      if (width > 0) {
        setContainerWidth(width);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    resizeObserverRef.current = observer;
  }, []);

  useEffect(
    () => () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
    },
    []
  );

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    charts
      .renderMermaid(source)
      .then((result) => {
        if (!active) return;
        if (result.ok) {
          lastReadySvgRef.current = result.svg;
          setState({ status: "ready", svg: result.svg });
          return;
        }
        setState({ status: "error" });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });
    return () => {
      active = false;
    };
  }, [charts, source]);

  let displaySvg: string | null = null;
  if (state.status === "ready") {
    displaySvg = state.svg;
  } else if (state.status === "loading") {
    displaySvg = lastReadySvgRef.current;
  }

  useEffect(() => {
    const root = rootRef.current;
    if (!(root && displaySvg)) return;
    const svg = parseSafeSvg(displaySvg);
    if (!svg) {
      if (state.status === "ready") {
        setState({ status: "error" });
      }
      return;
    }
    const intrinsic =
      parseSvgIntrinsicSize(displaySvg) ??
      readLiveIntrinsicSize(svg) ??
      ({ height: 240, width: 320 } as const);
    let slotWidth = containerWidth;
    if (!(slotWidth > 0) && shellEl) {
      slotWidth = contentBoxWidthPx(shellEl);
    }
    if (!(slotWidth > 0)) {
      slotWidth = intrinsic.width;
    }
    const display = computeNaturalCappedSize(intrinsic, slotWidth, 1);
    applySvgDisplaySize(svg, display);
    root.replaceChildren(svg);
    return () => root.replaceChildren();
  }, [displaySvg, containerWidth, shellEl, state.status]);

  const openPreview = () => {
    if (!(contentPreview && displaySvg)) return;
    contentPreview.openMermaid({
      "aria-label": label,
      colorMode,
      source,
      title: previewTitle,
    });
  };

  if (state.status === "error" && !displaySvg) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{errorLabel}</AlertDescription>
      </Alert>
    );
  }

  if (state.status === "loading" && !displaySvg) {
    return <Skeleton className="h-48 w-full rounded-md" />;
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: whole-card pointer shortcut; keyboard path is the visible fullscreen button
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: whole-card pointer shortcut; keyboard path is the visible fullscreen button
    // biome-ignore lint/a11y/useKeyWithClickEvents: whole-card pointer shortcut; keyboard path is the visible fullscreen button
    <div
      className={cn(
        "group relative overflow-auto rounded-md border p-3",
        contentPreview && "cursor-zoom-in",
        heightCapped && MARKDOWN_DIAGRAM_MAX_HEIGHT_CLASS
      )}
      data-scrollbar={heightCapped ? "overlay" : undefined}
      data-slot="markdown-diagram"
      onClick={
        contentPreview
          ? (event) => {
              // Parity with canvas mermaid cards: plain surface click opens
              // fullscreen; interactive children and text selections opt out.
              if (!isPlainSurfaceClick(event.target)) {
                return;
              }
              openPreview();
            }
          : undefined
      }
      onWheel={heightCapped ? forwardWheelToMarkdownPreview : undefined}
      ref={shellRef}
    >
      <div
        aria-busy={state.status === "loading"}
        aria-label={label}
        className={cn(
          // Natural-capped: size is set in px on the SVG; do not force width 100%.
          "flex min-w-0 justify-center [&>svg]:block",
          state.status === "loading" && "opacity-70"
        )}
        ref={rootRef}
        role="img"
      />
      {contentPreview && displaySvg ? (
        <MediaFullscreenButton
          label={openFullscreenLabel}
          onClick={openPreview}
        />
      ) : null}
    </div>
  );
}

function readLiveIntrinsicSize(
  svg: SVGElement
): { height: number; width: number } | null {
  const svgEl = svg as SVGSVGElement;
  const viewBox = svgEl.viewBox?.baseVal;
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    return { height: viewBox.height, width: viewBox.width };
  }
  const width = Number(svg.getAttribute("width"));
  const height = Number(svg.getAttribute("height"));
  if (width > 0 && height > 0) {
    return { height, width };
  }
  return null;
}

function parseSafeSvg(source: string): SVGElement | null {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const svg = document.documentElement;
  if (svg.localName !== "svg" || document.querySelector("parsererror"))
    return null;
  // Official Mermaid uses sanitized XHTML labels in foreignObject. The host
  // renderer already rejects active attributes and non-local URLs.
  for (const forbidden of svg.querySelectorAll(
    "script, iframe, object, embed"
  )) {
    forbidden.remove();
  }
  for (const element of [svg, ...svg.querySelectorAll("*")]) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
      } else if (
        (name === "href" || name === "xlink:href") &&
        !attribute.value.startsWith("#")
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return svg as unknown as SVGElement;
}
