import type { PageViewport, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import type { FilesTranslate } from "../../i18n.ts";
import { PDF_LINK_OVERLAY_Z_INDEX, pdfPageRenderSize } from "./layout.ts";
import { pdfLinkTargets, resolvePdfPageIndex } from "./links.ts";

interface PdfOverlayLink {
  height: number;
  kind: "external" | "internal";
  left: number;
  pageIndex?: number;
  top: number;
  url?: string;
  width: number;
}

function applyViewportTransform(
  viewport: PageViewport,
  x: number,
  y: number
): [number, number] {
  const transform = viewport.transform;
  const a = transform[0] ?? 1;
  const b = transform[1] ?? 0;
  const c = transform[2] ?? 0;
  const d = transform[3] ?? 1;
  const e = transform[4] ?? 0;
  const f = transform[5] ?? 0;
  return [a * x + c * y + e, b * x + d * y + f];
}

function overlayGeometry(
  rect: readonly number[],
  viewport: PageViewport
): { height: number; left: number; top: number; width: number } | null {
  if (rect.length < 4) {
    return null;
  }
  const [x1, y1] = applyViewportTransform(viewport, rect[0] ?? 0, rect[1] ?? 0);
  const [x2, y2] = applyViewportTransform(viewport, rect[2] ?? 0, rect[3] ?? 0);
  return {
    height: Math.abs(y2 - y1),
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
  };
}

export function PdfPage(props: {
  fileName: string;
  onExternalLink: (url: string) => void;
  onNavigatePage: (pageIndex: number) => void;
  onRenderError: () => void;
  pageNumber: number;
  pdf: PDFDocumentProxy;
  t: FilesTranslate;
  zoom: number;
}) {
  const {
    fileName,
    onExternalLink,
    onNavigatePage,
    onRenderError,
    pageNumber,
    pdf,
    t,
    zoom,
  } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [links, setLinks] = useState<readonly PdfOverlayLink[]>([]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    setContainerWidth(element.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width > 0) {
        setContainerWidth(width);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let textLayer: TextLayer | null = null;

    const render = async () => {
      setLinks([]);
      const page = await pdf.getPage(pageNumber);
      if (cancelled) {
        return;
      }
      const baseViewport = page.getViewport({ scale: 1 });
      const size = pdfPageRenderSize({
        containerWidth,
        devicePixelRatio: window.devicePixelRatio,
        pageHeight: baseViewport.height,
        pageWidth: baseViewport.width,
        zoom,
      });
      const viewport = page.getViewport({ scale: size.scale });
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!(canvas && context)) {
        return;
      }
      canvas.width = size.pixelWidth;
      canvas.height = size.pixelHeight;
      canvas.style.width = `${size.cssWidth}px`;
      canvas.style.height = `${size.cssHeight}px`;
      renderTask = page.render({
        canvas,
        transform: [
          size.pixelWidth / viewport.width,
          0,
          0,
          size.pixelHeight / viewport.height,
          0,
          0,
        ],
        viewport,
      });
      await renderTask.promise;
      if (cancelled) {
        return;
      }

      const textContainer = textRef.current;
      if (textContainer) {
        // Await first: a stale effect must not clear the container the newer
        // zoom generation is already filling.
        const textContent = await page.getTextContent();
        if (cancelled) {
          return;
        }
        textContainer.replaceChildren();
        textContainer.style.setProperty(
          "--total-scale-factor",
          String(viewport.scale)
        );
        textLayer = new TextLayer({
          container: textContainer,
          textContentSource: textContent,
          viewport,
        });
        await textLayer.render();
      }
      if (cancelled) {
        return;
      }

      const annotations = await page.getAnnotations();
      if (cancelled) {
        return;
      }
      const targets = pdfLinkTargets(
        annotations.map((annotation) => ({
          dest: annotation.dest,
          rect: annotation.rect,
          subtype: annotation.subtype,
          url: annotation.url,
        }))
      );
      const items: PdfOverlayLink[] = [];
      for (const target of targets) {
        const geometry = overlayGeometry(target.rect, viewport);
        if (!geometry) {
          continue;
        }
        if (target.kind === "external") {
          items.push({ ...geometry, kind: "external", url: target.url });
          continue;
        }
        const pageIndex = await resolvePdfPageIndex(pdf, target.dest);
        if (pageIndex !== null) {
          items.push({ ...geometry, kind: "internal", pageIndex });
        }
      }
      if (!cancelled) {
        setLinks(items);
      }
    };

    render().catch(() => {
      if (!cancelled) {
        onRenderError();
      }
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [containerWidth, onRenderError, pageNumber, pdf, zoom]);

  return (
    <div
      // Observed width must be the scroll viewport, not the canvas wrapper:
      // a shrink-to-fit root feeds the rendered canvas width back into the
      // fit scale and compounds every zoom step.
      className="relative w-full"
      data-slot="document-preview-pdf"
      ref={containerRef}
    >
      <div className="relative mx-auto w-fit">
        <canvas
          aria-label={t(
            "filePanel.documentPreview.pdf.pageDescription",
            "{fileName} — page {page} of {total}",
            { fileName, page: pageNumber, total: pdf.numPages }
          )}
          className="block"
          data-slot="document-preview-pdf-canvas"
          ref={canvasRef}
          role="img"
        />
        <div className="textLayer" ref={textRef} />
        {links.map((link) => (
          <button
            aria-label={
              link.kind === "external"
                ? t("filePanel.documentPreview.externalLink.label", "Open link")
                : t(
                    "filePanel.documentPreview.pdf.goToPage",
                    "Go to page {page}",
                    { page: (link.pageIndex ?? 0) + 1 }
                  )
            }
            className="absolute cursor-pointer rounded-sm bg-transparent p-0 focus-visible:ring-2 focus-visible:ring-ring"
            key={`${link.kind}-${link.left}-${link.top}-${link.url ?? link.pageIndex ?? ""}`}
            onClick={() => {
              if (link.kind === "external" && link.url) {
                onExternalLink(link.url);
              } else if (
                link.kind === "internal" &&
                link.pageIndex !== undefined
              ) {
                onNavigatePage(link.pageIndex);
              }
            }}
            style={{
              height: link.height,
              left: link.left,
              top: link.top,
              width: link.width,
              zIndex: PDF_LINK_OVERLAY_Z_INDEX,
            }}
            type="button"
          />
        ))}
      </div>
      <span className="sr-only">
        {t("filePanel.documentPreview.pdf.canvasLabel", "PDF page")}
      </span>
    </div>
  );
}
