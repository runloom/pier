import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentPreviewHost } from "@/components/common/content-preview-host.tsx";
import { initI18n } from "@/i18n/index.ts";
import { resetTerminalSurfaceSuppressionForTests } from "@/panel-kits/terminal/terminal-layout-coordinator.ts";
import {
  closeContentPreview,
  openContentPreview,
  openImagePreview,
} from "@/stores/content-preview.store.ts";
import { useKeybindingScope } from "@/stores/keybinding-scope.store.ts";
import { useTerminalStore } from "@/stores/terminal.store.ts";

const registerFullscreen = vi.fn((_id: string) => ({
  dispose: vi.fn(),
  flush: vi.fn(),
}));
const requestWebFocus = vi.fn((_id: string) => vi.fn());

vi.mock("@/stores/terminal-input-routing-slice.ts", () => ({
  registerTerminalFullscreenWebOverlay: (id: string) => registerFullscreen(id),
  requestTerminalWebFocus: (id: string) => requestWebFocus(id),
}));

beforeEach(async () => {
  await initI18n();
  registerFullscreen.mockClear();
  requestWebFocus.mockClear();
  closeContentPreview();
  resetTerminalSurfaceSuppressionForTests();
  useKeybindingScope.setState({ overlayStack: [] });
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: {
      mediaPreviews: {
        issueAbsolute: vi.fn(async () => ({
          expiresAt: Date.now() + 60_000,
          issued: true,
          ticket: "ticket-test",
          url: "pier-file-preview://file/ticket-test",
        })),
        releaseAbsolute: vi.fn(async () => true),
      },
    },
  });
});

afterEach(() => {
  cleanup();
  closeContentPreview();
  resetTerminalSurfaceSuppressionForTests();
  useKeybindingScope.setState({ overlayStack: [] });
  Reflect.deleteProperty(window, "pier");
});

describe("ContentPreviewHost", () => {
  it("claims fullscreen overlay, suppresses native surfaces, closes on Esc", async () => {
    render(<ContentPreviewHost />);
    openContentPreview({
      payload: {
        type: "image",
        alt: "shot.png",
        source: { kind: "absolutePath", path: "/tmp/shot.png" },
      },
      title: "shot.png",
    });

    const root = await screen.findByTestId("content-preview");
    expect(root.className).toContain("bg-background");
    expect(registerFullscreen).toHaveBeenCalledWith("content-preview");
    expect(requestWebFocus).toHaveBeenCalledWith("content-preview");
    expect(useKeybindingScope.getState().overlayStack).toContain(
      "overlay:content-preview"
    );
    expect(useTerminalStore.getState().suppressTerminals).toBe(true);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("content-preview")).not.toBeInTheDocument();
    expect(useTerminalStore.getState().suppressTerminals).toBe(false);
  });

  it("closes when clicking empty viewport around the media", async () => {
    render(<ContentPreviewHost />);
    openImagePreview({
      source: { kind: "url", src: "data:image/png;base64,xx" },
      title: "preview",
    });

    const viewport = await screen.findByLabelText("Image preview");
    fireEvent.pointerDown(viewport, {
      button: 0,
      clientX: 8,
      clientY: 8,
      pointerId: 1,
    });
    fireEvent.pointerUp(viewport, {
      button: 0,
      clientX: 8,
      clientY: 8,
      pointerId: 1,
    });
    expect(screen.queryByTestId("content-preview")).not.toBeInTheDocument();
  });

  it("does not close when clicking the image", async () => {
    render(<ContentPreviewHost />);
    openImagePreview({
      alt: "preview image",
      source: { kind: "url", src: "data:image/png;base64,xx" },
      title: "preview",
    });

    const image = await screen.findByAltText("preview image");
    fireEvent.pointerDown(image, {
      button: 0,
      clientX: 12,
      clientY: 12,
      pointerId: 2,
    });
    fireEvent.pointerUp(image, {
      button: 0,
      clientX: 12,
      clientY: 12,
      pointerId: 2,
    });
    expect(screen.getByTestId("content-preview")).toBeInTheDocument();
  });

  it("covers the full window with centered title and overlay zoom toolbar", async () => {
    render(<ContentPreviewHost />);
    openImagePreview({
      source: { kind: "url", src: "data:image/png;base64,xx" },
      title: "preview.png",
    });

    const root = await screen.findByTestId("content-preview");
    expect(root.className).toContain("inset-0");
    expect(root.className).toContain("app-no-drag");
    const header = screen.getByTestId("content-preview-header");
    expect(header.className).toContain("justify-center");
    expect(header.className).toContain("z-50");
    expect(header).toHaveTextContent("preview.png");
    const stage = screen.getByTestId("content-preview-stage");
    expect(stage.className).toContain("inset-0");
    const controls = stage.querySelector(
      '[data-slot="image-preview-controls"]'
    );
    expect(controls).not.toBeNull();
    expect(controls?.parentElement?.className).toContain("absolute");
    expect(controls?.parentElement?.className).toContain("bottom-0");
    const close = screen.getByTestId("content-preview-close");
    expect(close).toHaveAttribute("data-variant", "outline");
    expect(header.contains(close)).toBe(true);
  });

  it("closes from the chrome close button without relying on the canvas", async () => {
    render(<ContentPreviewHost />);
    openImagePreview({
      source: { kind: "url", src: "data:image/png;base64,xx" },
      title: "preview",
    });
    await screen.findByTestId("content-preview");
    fireEvent.pointerDown(screen.getByTestId("content-preview-close"));
    fireEvent.click(screen.getByTestId("content-preview-close"));
    expect(screen.queryByTestId("content-preview")).not.toBeInTheDocument();
  });

  it("invokes onClose when the preview closes or is replaced", async () => {
    const onClose = vi.fn();
    const nextOnClose = vi.fn();
    render(<ContentPreviewHost />);
    openImagePreview({
      onClose,
      source: { kind: "url", src: "data:image/png;base64,xx" },
      title: "first",
    });
    await screen.findByTestId("content-preview");
    openImagePreview({
      onClose: nextOnClose,
      source: { kind: "url", src: "data:image/png;base64,yy" },
      title: "second",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(nextOnClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("content-preview-close"));
    expect(nextOnClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("content-preview")).not.toBeInTheDocument();
  });

  it("Esc does not dismiss preview while a dropdown menu is open", async () => {
    render(<ContentPreviewHost />);
    openImagePreview({
      source: { kind: "url", src: "data:image/png;base64,xx" },
      title: "preview",
    });
    await screen.findByTestId("content-preview");

    const openMenu = document.createElement("div");
    openMenu.setAttribute("data-slot", "dropdown-menu-content");
    openMenu.setAttribute("data-state", "open");
    openMenu.setAttribute("role", "menu");
    document.body.appendChild(openMenu);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("content-preview")).toBeInTheDocument();

    openMenu.remove();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("content-preview")).not.toBeInTheDocument();
  });
});
