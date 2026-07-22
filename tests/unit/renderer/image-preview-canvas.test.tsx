import {
  anchoredScrollAfterZoom,
  ImagePreviewCanvas,
  measureContainScale,
} from "@pier/ui/image-preview-canvas.tsx";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const labels = {
  actualSize: "Actual size",
  controlsLabel: "Zoom controls",
  fit: "Fit to window",
  loadFailedDescription: "Could not load",
  loadFailedTitle: "Failed",
  loading: "Loading",
  viewerLabel: "Image viewer",
  zoomIn: "Zoom in",
  zoomLevel: "Zoom level",
  zoomOut: "Zoom out",
};

async function zoomToActualSize(): Promise<void> {
  fireEvent.keyDown(
    screen.getByRole("button", { name: "Zoom level: Fit to window" }),
    { key: "Enter" }
  );
  fireEvent.click(await screen.findByRole("menuitemradio", { name: /100%/u }));
}

describe("image preview zoom anchoring helpers", () => {
  it("measures contain scale without upscaling", () => {
    expect(
      measureContainScale({
        naturalHeight: 200,
        naturalWidth: 400,
        viewportHeight: 200,
        viewportWidth: 200,
      })
    ).toBe(0.44);
    expect(
      measureContainScale({
        naturalHeight: 50,
        naturalWidth: 50,
        viewportHeight: 400,
        viewportWidth: 400,
      })
    ).toBe(1);
  });

  it("keeps the viewport center stable across zoom changes", () => {
    expect(
      anchoredScrollAfterZoom({
        clientHeight: 200,
        clientWidth: 200,
        newZoom: 2,
        oldZoom: 1,
        scrollLeft: 100,
        scrollTop: 50,
      })
    ).toEqual({ scrollLeft: 300, scrollTop: 200 });
  });
});

describe("ImagePreviewCanvas", () => {
  it("uses plus/minus controls with multiplicative zoom steps", async () => {
    render(
      <ImagePreviewCanvas
        alt="shot"
        labels={labels}
        src="data:image/png;base64,xx"
        status="ready"
      />
    );

    await zoomToActualSize();
    expect(screen.getByText("100%")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("125%")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByText("100%")).toBeVisible();
  });

  it("clamps multiplicative zoom between 10% and 800%", async () => {
    render(
      <ImagePreviewCanvas
        alt="shot"
        labels={labels}
        src="data:image/png;base64,xx"
        status="ready"
      />
    );

    await zoomToActualSize();

    const zoomOut = screen.getByRole("button", { name: "Zoom out" });
    for (let index = 0; index < 20; index += 1) fireEvent.click(zoomOut);
    expect(screen.getByText("10%")).toBeVisible();
    expect(zoomOut).toBeDisabled();

    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    for (let index = 0; index < 40; index += 1) fireEvent.click(zoomIn);
    expect(screen.getByText("800%")).toBeVisible();
    expect(zoomIn).toBeDisabled();
  });

  it("hides scrollbars and uses grab cursor when zoomed for drag-pan", async () => {
    render(
      <ImagePreviewCanvas
        alt="shot"
        labels={labels}
        src="data:image/png;base64,xx"
        status="ready"
      />
    );

    const viewport = screen.getByRole("region", { name: "Image viewer" });
    expect(viewport).toHaveAttribute("data-scrollbar", "none");
    expect(viewport.className).not.toContain("cursor-grab");

    await zoomToActualSize();
    expect(viewport.className).toContain("cursor-grab");
    expect(viewport.className).not.toContain("cursor-grabbing");

    fireEvent.pointerDown(viewport, {
      button: 0,
      clientX: 40,
      clientY: 40,
      pointerId: 1,
    });
    expect(viewport.className).toContain("cursor-grabbing");
    fireEvent.pointerUp(viewport, { button: 0, pointerId: 1 });
    expect(viewport.className).toContain("cursor-grab");
  });

  it("pans via pointer drag when zoomed", async () => {
    render(
      <ImagePreviewCanvas
        alt="shot"
        labels={labels}
        src="data:image/png;base64,xx"
        status="ready"
      />
    );
    await zoomToActualSize();

    const viewport = screen.getByRole("region", { name: "Image viewer" });
    Object.defineProperty(viewport, "scrollLeft", {
      configurable: true,
      value: 20,
      writable: true,
    });
    Object.defineProperty(viewport, "scrollTop", {
      configurable: true,
      value: 30,
      writable: true,
    });

    fireEvent.pointerDown(viewport, {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 7,
    });
    fireEvent.pointerMove(viewport, {
      clientX: 80,
      clientY: 70,
      pointerId: 7,
    });

    expect(viewport.scrollLeft).toBe(40);
    expect(viewport.scrollTop).toBe(60);
  });

  it("dismisses on empty click but not after a drag", () => {
    const onEmptyClick = vi.fn();
    render(
      <ImagePreviewCanvas
        alt="shot"
        labels={labels}
        onEmptyClick={onEmptyClick}
        src="data:image/png;base64,xx"
        status="ready"
      />
    );
    const viewport = screen.getByRole("region", { name: "Image viewer" });

    fireEvent.pointerDown(viewport, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerId: 2,
    });
    fireEvent.pointerUp(viewport, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerId: 2,
    });
    expect(onEmptyClick).toHaveBeenCalledOnce();

    onEmptyClick.mockClear();
    fireEvent.pointerDown(viewport, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerId: 3,
    });
    fireEvent.pointerMove(viewport, {
      clientX: 30,
      clientY: 10,
      pointerId: 3,
    });
    fireEvent.pointerUp(viewport, {
      button: 0,
      clientX: 30,
      clientY: 10,
      pointerId: 3,
    });
    expect(onEmptyClick).not.toHaveBeenCalled();
  });

  it("pans with arrow keys when zoomed", async () => {
    render(
      <ImagePreviewCanvas
        alt="shot"
        labels={labels}
        src="data:image/png;base64,xx"
        status="ready"
      />
    );
    await zoomToActualSize();

    const viewport = screen.getByRole("region", { name: "Image viewer" });
    Object.defineProperty(viewport, "scrollLeft", {
      configurable: true,
      value: 100,
      writable: true,
    });
    Object.defineProperty(viewport, "scrollTop", {
      configurable: true,
      value: 100,
      writable: true,
    });

    fireEvent.keyDown(viewport, { key: "ArrowLeft" });
    expect(viewport.scrollLeft).toBe(52);
    fireEvent.keyDown(viewport, { key: "ArrowDown" });
    expect(viewport.scrollTop).toBe(148);
  });

  it("zooms with ctrl+wheel", async () => {
    render(
      <ImagePreviewCanvas
        alt="shot"
        labels={labels}
        src="data:image/png;base64,xx"
        status="ready"
      />
    );
    await zoomToActualSize();
    const viewport = screen.getByRole("region", { name: "Image viewer" });

    fireEvent.wheel(viewport, { ctrlKey: true, deltaY: -40 });
    expect(screen.getByText("125%")).toBeVisible();
    fireEvent.wheel(viewport, { metaKey: true, deltaY: 40 });
    expect(screen.getByText("100%")).toBeVisible();
  });
});
