import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@pier/ui/alert-dialog.tsx";
import { Dialog, DialogContent, DialogTitle } from "@pier/ui/dialog.tsx";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentPreviewHost } from "@/components/common/content-preview-host.tsx";
import { initI18n } from "@/i18n/index.ts";
import { DEFAULT_KEYMAP } from "@/lib/keybindings/defaults.ts";
import { parseChord } from "@/lib/keybindings/parse.ts";
import { keybindingRegistry } from "@/lib/keybindings/registry.ts";
import { resetTerminalSurfaceSuppressionForTests } from "@/panel-kits/terminal/layout-coordinator.ts";
import {
  closeContentPreview,
  openContentPreview,
  openHtmlWorldPreview,
  openImagePreview,
  openMermaidPreview,
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

afterEach(async () => {
  cleanup();
  closeContentPreview();
  // Any UI-driven close queues history.back(), and jsdom delivers its
  // unwind popstate asynchronously (~ms). Drain it here so a stray
  // popstate can never land inside the NEXT test's freshly mounted host.
  await new Promise((resolve) => {
    setTimeout(resolve, 20);
  });
  resetTerminalSurfaceSuppressionForTests();
  useKeybindingScope.setState({ overlayStack: [] });
  Reflect.deleteProperty(window, "pier");
  // Synthetic-back tests dispatch popstate without traversal; drop any
  // leftover preview marker so tests stay isolated.
  window.history.replaceState(null, "");
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
    expect(useKeybindingScope.getState().overlayStack).toEqual([
      "overlay:content-preview",
    ]);
    expect(root.className).toContain("z-40");
    expect(root.className).not.toContain("z-[100]");
    expect(useTerminalStore.getState().suppressTerminals).toBe(true);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("content-preview")).not.toBeInTheDocument();
    expect(useKeybindingScope.getState().overlayStack).toEqual([]);
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
    expect(header.className).toContain("app-drag");
    expect(header.className).toContain("h-14");
    expect(header.className).toContain("justify-center");
    expect(header.className).toContain("z-50");
    expect(header.className).not.toContain("pointer-events-none");
    expect(header).toHaveTextContent("preview.png");
    const stage = screen.getByTestId("content-preview-stage");
    expect(stage.className).toContain("inset-0");
    // Title/close band — media must not layout under floating chrome.
    expect(stage.className).toContain("pt-14");
    const controls = stage.querySelector(
      '[data-slot="image-preview-controls"]'
    );
    expect(controls).not.toBeNull();
    expect(controls?.parentElement?.className).toContain("absolute");
    expect(controls?.parentElement?.className).toContain("bottom-0");
    fireEvent.keyDown(screen.getByRole("button", { name: /zoom level/i }), {
      key: "Enter",
    });
    await screen.findByRole("menu");
    const zoomMenu = document.querySelector(
      '[data-slot="dropdown-menu-content"]'
    );
    expect(zoomMenu).not.toBeNull();
    expect(zoomMenu?.className).toContain("z-50");
    expect(zoomMenu?.className).not.toContain("z-[110]");
    const close = screen.getByTestId("content-preview-close");
    expect(close).toHaveAttribute("data-variant", "outline");
    expect(close.className).toContain("app-no-drag");
    expect(close.parentElement?.className).toContain("app-no-drag");
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

  it("renders Mermaid stage without card border and with image zoom strip", async () => {
    render(<ContentPreviewHost />);
    openMermaidPreview({
      "aria-label": "任务 DAG",
      edges: [{ source: "a", target: "b" }],
      nodes: [
        { id: "a", title: "A" },
        { id: "b", title: "B" },
      ],
      title: "任务 DAG",
    });

    await screen.findByTestId("content-preview");
    expect(screen.getByText("任务 DAG")).toBeInTheDocument();
    const stage = document.querySelector('[data-slot="mermaid-stage"]');
    expect(stage).toBeTruthy();
    expect(stage).not.toHaveClass("border");
    expect(stage).not.toHaveClass("rounded-lg");
    expect(
      document.querySelector('[data-slot="image-preview-controls"]')
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /zoom in/i })).toBeTruthy();
  });

  it("renders html-world stage with image zoom strip", async () => {
    render(<ContentPreviewHost />);
    openHtmlWorldPreview({
      "aria-label": "设计稿",
      render: () => <div data-testid="html-world-child">board</div>,
      title: "设计稿",
    });

    await screen.findByTestId("content-preview");
    expect(screen.getByText("设计稿")).toBeInTheDocument();
    expect(screen.getByTestId("html-world-child")).toBeInTheDocument();
    expect(
      document.querySelector('[data-slot="html-world-viewport"]')
    ).toBeTruthy();
    expect(
      document.querySelector('[data-slot="image-preview-controls"]')
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /zoom in/i })).toBeTruthy();
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

  it("Esc yields to a real host Dialog and AlertDialog", async () => {
    const { rerender } = render(
      <>
        <ContentPreviewHost />
        <Dialog open>
          <DialogContent>
            <DialogTitle>Host dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </>
    );
    openImagePreview({
      source: { kind: "url", src: "data:image/png;base64,xx" },
      title: "preview",
    });
    await screen.findByTestId("content-preview");
    expect(
      document.querySelector('[data-slot="dialog-content"][data-state="open"]')
    ).not.toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("content-preview")).toBeInTheDocument();

    rerender(
      <>
        <ContentPreviewHost />
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogTitle>Host alert</AlertDialogTitle>
            <AlertDialogDescription>Details</AlertDialogDescription>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
    expect(
      document.querySelector(
        '[data-slot="alert-dialog-content"][data-state="open"]'
      )
    ).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("content-preview")).toBeInTheDocument();

    rerender(<ContentPreviewHost />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("content-preview")).not.toBeInTheDocument();
  });

  it("keeps settings and command palette chords while blocking workspace zoom", async () => {
    keybindingRegistry.registerDefaults(DEFAULT_KEYMAP);
    render(<ContentPreviewHost />);
    openImagePreview({
      source: { kind: "url", src: "data:image/png;base64,xx" },
      title: "preview",
    });
    await screen.findByTestId("content-preview");

    const scope = {
      activePanelComponent: null,
      overlayStack: useKeybindingScope.getState().overlayStack,
    };
    expect(
      keybindingRegistry.resolve(parseChord("Mod+Comma", false), scope)
    ).toBe("pier.settings.open");
    expect(
      keybindingRegistry.resolve(parseChord("Mod+Shift+KeyP", false), scope)
    ).toBe("pier.commandPalette.toggle");
    expect(
      keybindingRegistry.resolve(parseChord("Mod+Equal", false), scope)
    ).toBeNull();
    expect(
      keybindingRegistry.resolve(parseChord("Mod+KeyW", false), scope)
    ).toBeNull();
  });

  it("mounts below host chrome in AppShell so Settings and the palette paint on top", () => {
    const appShell = readFileSync(
      join(process.cwd(), "src/renderer/components/common/app-shell.tsx"),
      "utf8"
    );
    const preview = appShell.indexOf("<ContentPreviewHost");
    const palette = appShell.indexOf("<CommandPalette");
    const settings = appShell.indexOf("<SettingsDialog");
    const dialogs = appShell.indexOf("<AppDialogHost");
    const contentDialogs = appShell.indexOf("<AppContentDialogHost");
    expect(preview).toBeGreaterThan(-1);
    expect(preview).toBeLessThan(palette);
    expect(preview).toBeLessThan(settings);
    expect(preview).toBeLessThan(dialogs);
    expect(preview).toBeLessThan(contentDialogs);
  });

  it("pushes a history entry on open and closes on user back", async () => {
    render(<ContentPreviewHost />);
    openImagePreview({
      source: { kind: "url", src: "data:image/png;base64,xx" },
      title: "history",
    });
    await screen.findByTestId("content-preview");
    expect(window.history.state).toHaveProperty("pierContentPreview");

    // User-driven back while open closes the preview.
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() =>
      expect(screen.queryByTestId("content-preview")).toBeNull()
    );
  });

  it("unwinds its history entry when closed from our own UI", async () => {
    render(<ContentPreviewHost />);
    openImagePreview({
      source: { kind: "url", src: "data:image/png;base64,xx" },
      title: "unwind",
    });
    await screen.findByTestId("content-preview");
    expect(window.history.state).toHaveProperty("pierContentPreview");
    let unwindPopstates = 0;
    const countPopstate = () => {
      unwindPopstates += 1;
    };
    window.addEventListener("popstate", countPopstate);
    fireEvent.click(screen.getByTestId("content-preview-close"));
    await waitFor(() => {
      const state = window.history.state as Record<string, unknown> | null;
      expect(state?.pierContentPreview ?? null).toBeNull();
    });
    // The queued back() must actually traverse (its popstate lands within
    // a tick) and the bridge must swallow it — the preview stays closed.
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    window.removeEventListener("popstate", countPopstate);
    expect(unwindPopstates).toBe(1);
    expect(window.history.state).toBeNull();
    expect(screen.queryByTestId("content-preview")).toBeNull();
  });
});
