import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  clampPdfPageNumber,
  clampPdfZoom,
  PDF_LINK_OVERLAY_Z_INDEX,
  PDF_MAX_ZOOM,
  PDF_MIN_ZOOM,
  pdfPageRenderSize,
} from "@plugins/builtin/files/renderer/preview/pdf/layout.ts";
import { describe, expect, it } from "vitest";

describe("pdfPageRenderSize", () => {
  it("fits the page width to the container at zoom 1", () => {
    const size = pdfPageRenderSize({
      containerWidth: 800,
      devicePixelRatio: 1,
      pageHeight: 800,
      pageWidth: 600,
      zoom: 1,
    });

    expect(size.scale).toBeCloseTo(800 / 600);
    expect(size.cssWidth).toBeCloseTo(800);
    expect(size.cssHeight).toBeCloseTo(800 * (800 / 600));
    expect(size.pixelWidth).toBe(Math.round(size.cssWidth));
    expect(size.pixelHeight).toBe(Math.round(size.cssHeight));
  });

  it("clamps only the user zoom, not the fit scale", () => {
    expect(clampPdfZoom(0.1)).toBe(PDF_MIN_ZOOM);
    expect(clampPdfZoom(9)).toBe(PDF_MAX_ZOOM);
    const size = pdfPageRenderSize({
      containerWidth: 60,
      devicePixelRatio: 1,
      pageHeight: 100,
      pageWidth: 100,
      zoom: 10,
    });
    expect(size.scale).toBeCloseTo(1.8);
  });

  it("fits a wide page to the container instead of clamping the fit scale", () => {
    const size = pdfPageRenderSize({
      containerWidth: 100,
      devicePixelRatio: 1,
      pageHeight: 1000,
      pageWidth: 1000,
      zoom: 1,
    });
    expect(size.scale).toBeCloseTo(0.1);
    expect(size.cssWidth).toBeCloseTo(100);
  });

  it("lets a small page fill a wide container", () => {
    const size = pdfPageRenderSize({
      containerWidth: 800,
      devicePixelRatio: 1,
      pageHeight: 100,
      pageWidth: 100,
      zoom: 1,
    });
    expect(size.scale).toBeCloseTo(8);
    expect(size.cssWidth).toBeCloseTo(800);
  });

  it("uses the page width when the container is not measured yet", () => {
    const size = pdfPageRenderSize({
      containerWidth: 0,
      devicePixelRatio: 1,
      pageHeight: 200,
      pageWidth: 100,
      zoom: 1,
    });
    expect(size.cssWidth).toBe(100);
    expect(size.cssHeight).toBe(200);
  });

  it("caps the device pixel ratio at 2", () => {
    const size = pdfPageRenderSize({
      containerWidth: 100,
      devicePixelRatio: 4,
      pageHeight: 100,
      pageWidth: 100,
      zoom: 1,
    });
    expect(size.pixelWidth).toBe(200);
    expect(size.pixelHeight).toBe(200);
  });

  it("caps a huge canvas side at 16384 pixels and keeps the aspect ratio", () => {
    const size = pdfPageRenderSize({
      containerWidth: 10_000,
      devicePixelRatio: 2,
      pageHeight: 20_000,
      pageWidth: 10_000,
      zoom: 3,
    });
    expect(size.pixelHeight).toBe(16_384);
    expect(size.pixelWidth).toBe(8192);
  });
});

describe("clampPdfPageNumber", () => {
  it("keeps the page inside the replacement document", () => {
    expect(clampPdfPageNumber(5, 2)).toBe(2);
    expect(clampPdfPageNumber(0, 3)).toBe(1);
    expect(clampPdfPageNumber(2, 0)).toBe(1);
    expect(clampPdfPageNumber(Number.NaN, 4)).toBe(1);
  });
});

describe("pdf link overlays", () => {
  it("paint above the selectable text layer", () => {
    const css = readFileSync(
      join(
        process.cwd(),
        "src/plugins/builtin/files/renderer/preview/pdf/pdf-text-layer.css"
      ),
      "utf8"
    );
    const textLayerZIndex = /\.textLayer\s*\{[^}]*?z-index:\s*(\d+)/u.exec(
      css
    )?.[1];

    expect(textLayerZIndex).toBeDefined();
    expect(PDF_LINK_OVERLAY_Z_INDEX).toBeGreaterThan(
      Number(textLayerZIndex ?? 0)
    );
  });
});
