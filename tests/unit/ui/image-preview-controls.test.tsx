import { ImagePreviewControls } from "@pier/ui/image-preview/controls.tsx";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const cameraLabels = {
  actualSize: "Actual size",
  controlsLabel: "Zoom controls",
  fit: "Fit to window",
  zoomIn: "Zoom in",
  zoomLevel: "Zoom level",
  zoomOut: "Zoom out",
};

describe("ImagePreviewControls", () => {
  it("shows Fit on the camera trigger and a rounded pill", () => {
    render(
      <ImagePreviewControls
        effectiveZoom={1}
        labels={cameraLabels}
        onZoomChange={vi.fn()}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        zoom="fit"
      />
    );
    expect(
      screen.getByRole("button", { name: "Zoom level: Fit to window" })
    ).toBeTruthy();
    expect(
      screen.getByRole("toolbar", { name: "Zoom controls" }).className
    ).toContain("rounded-full");
  });

  it("uses an opaque pill without backdrop-filter over the Ghostty hole", () => {
    render(
      <ImagePreviewControls
        effectiveZoom={1}
        includeFit={false}
        labels={{
          actualSize: "Reset text size",
          controlsLabel: "Text size",
          zoomIn: "Increase text size",
          zoomLevel: "Text size",
          zoomOut: "Decrease text size",
        }}
        onZoomChange={vi.fn()}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        zoom={1}
      />
    );
    const pill = screen.getByRole("toolbar", { name: "Text size" }).className;
    expect(pill).not.toMatch(/backdrop-blur|backdrop-filter/u);
    expect(pill).toContain("bg-background");
    expect(pill).not.toMatch(/bg-background\/\d+/u);
  });

  it("uses percent labels and the same pill when Fit is omitted", () => {
    render(
      <ImagePreviewControls
        effectiveZoom={1}
        includeFit={false}
        labels={{
          actualSize: "Reset text size",
          controlsLabel: "Text size",
          zoomIn: "Increase text size",
          zoomLevel: "Text size",
          zoomOut: "Decrease text size",
        }}
        maxZoom={2}
        minZoom={0.75}
        onZoomChange={vi.fn()}
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        presets={[0.75, 1, 2]}
        zoom={1}
      />
    );
    expect(
      screen.getByRole("toolbar", { name: "Text size" }).className
    ).toContain("rounded-full");
    expect(
      screen.getByRole("button", { name: "Text size: 100%" })
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Fit to window/u })).toBeNull();
  });
});
