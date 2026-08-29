import {
  anchoredScrollAfterZoom,
  ImagePreviewCanvas,
  measureContainScale,
} from "@pier/ui/image-preview/canvas.tsx";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("zooms with stepped wheel and smooth ctrl+wheel pinch", async () => {
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

    fireEvent.wheel(viewport, { deltaY: -40 });
    expect(screen.getByText("125%")).toBeVisible();
    // Trackpad pinch (ctrl+wheel) is smooth: 1.25 × e^(-0.4) ≈ 0.84.
    fireEvent.wheel(viewport, { ctrlKey: true, deltaY: 40 });
    expect(screen.getByText("84%")).toBeVisible();
    // Plain (or meta) wheel keeps the multiplicative step.
    fireEvent.wheel(viewport, { metaKey: true, deltaY: -40 });
    expect(screen.getByText("105%")).toBeVisible();
  });

  it("renders a copy-image button that invokes onCopyImage after decode", async () => {
    const onCopyImage = vi.fn(async () => undefined);
    render(
      <ImagePreviewCanvas
        alt="shot"
        labels={{ ...labels, copyImage: "Copy image" }}
        onCopyImage={onCopyImage}
        src="data:image/png;base64,xx"
        status="ready"
      />
    );
    expect(screen.queryByRole("button", { name: "Copy image" })).toBeNull();
    fireEvent.load(screen.getByRole("img", { name: "shot" }));
    const copyButton = screen.getByRole("button", { name: "Copy image" });
    fireEvent.click(copyButton);
    await waitFor(() => {
      expect(onCopyImage).toHaveBeenCalledTimes(1);
    });
  });

  it("marks ticketed preview URLs CORS-anonymous so canvas copy is not tainted", () => {
    render(
      <ImagePreviewCanvas
        alt="shot"
        labels={labels}
        src="pier-file-preview://file/ticket-test"
        status="ready"
      />
    );
    const image = screen.getByRole("img", { name: "shot" });
    expect(image).toHaveAttribute("crossorigin", "anonymous");
    expect(image.outerHTML.indexOf("crossorigin")).toBeLessThan(
      image.outerHTML.indexOf(" src=")
    );
  });

  it("does not set crossorigin on data URLs", () => {
    render(
      <ImagePreviewCanvas
        alt="shot"
        labels={labels}
        src="data:image/png;base64,xx"
        status="ready"
      />
    );
    expect(screen.getByRole("img", { name: "shot" })).not.toHaveAttribute(
      "crossorigin"
    );
  });

  it("omits the copy-image button when onCopyImage is not provided", () => {
    render(
      <ImagePreviewCanvas
        alt="shot"
        labels={{ ...labels, copyImage: "Copy image" }}
        src="data:image/png;base64,xx"
        status="ready"
      />
    );
    expect(screen.queryByRole("button", { name: "Copy image" })).toBeNull();
  });

  it("does not pulse a skeleton once a preview src is on the canvas", () => {
    render(
      <ImagePreviewCanvas
        alt="shot"
        labels={labels}
        src="data:image/png;base64,xx"
        status="loading"
      />
    );
    expect(document.querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(screen.getByRole("img", { name: "shot" })).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Image viewer" })
    ).toHaveAttribute("aria-busy", "true");
  });

  it("keeps the live image painted while a replacement src decodes", () => {
    const view = render(
      <ImagePreviewCanvas
        alt="shot"
        labels={labels}
        src="data:image/png;base64,aa"
        status="ready"
      />
    );
    const live = screen.getByRole("img", { name: "shot" });
    fireEvent.load(live);
    expect(live).toHaveAttribute("src", "data:image/png;base64,aa");

    view.rerender(
      <ImagePreviewCanvas
        alt="shot"
        labels={labels}
        src="data:image/png;base64,bb"
        status="ready"
      />
    );
    expect(screen.getByRole("img", { name: "shot" })).toHaveAttribute(
      "src",
      "data:image/png;base64,aa"
    );
    const pending = document.querySelector(
      '[data-slot="image-preview-pending"]'
    );
    expect(pending).not.toBeNull();
    expect(pending).toHaveAttribute("src", "data:image/png;base64,bb");
    fireEvent.load(pending!);
    expect(screen.getByRole("img", { name: "shot" })).toHaveAttribute(
      "src",
      "data:image/png;base64,bb"
    );
    expect(
      document.querySelector('[data-slot="image-preview-pending"]')
    ).toBeNull();
  });

  it("keeps the live image and reports pending error when the replacement fails", () => {
    const onError = vi.fn();
    const onPendingError = vi.fn();
    const view = render(
      <ImagePreviewCanvas
        alt="shot"
        labels={labels}
        onError={onError}
        onPendingError={onPendingError}
        src="data:image/png;base64,aa"
        status="ready"
      />
    );
    fireEvent.load(screen.getByRole("img", { name: "shot" }));
    view.rerender(
      <ImagePreviewCanvas
        alt="shot"
        labels={labels}
        onError={onError}
        onPendingError={onPendingError}
        src="data:image/png;base64,bb"
        status="ready"
      />
    );
    const pending = document.querySelector(
      '[data-slot="image-preview-pending"]'
    );
    expect(pending).not.toBeNull();
    fireEvent.error(pending!);
    expect(onPendingError).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    expect(screen.getByRole("img", { name: "shot" })).toHaveAttribute(
      "src",
      "data:image/png;base64,aa"
    );
  });
});
