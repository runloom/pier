import { TerminalOverlayContext } from "@pier/ui/use-terminal-overlay.tsx";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { getLastTerminalHostSnapshot } from "@/lib/workspace/terminal-host-state-reconciler.ts";
import { SettingsDialog } from "@/pages/settings/settings-dialog.tsx";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import {
  registerTerminalElementWebOverlay,
  resetTerminalInputRoutingForTests,
} from "@/stores/terminal-input-routing-slice.ts";

const BACKDROP_FILTER_CLASS = /backdrop-blur|backdrop-filter/;
const terminalOverlayRegistry = {
  registerElement: registerTerminalElementWebOverlay,
};

function renderWithTerminalOverlay(children: ReactNode) {
  return render(
    <TerminalOverlayContext.Provider value={terminalOverlayRegistry}>
      {children}
    </TerminalOverlayContext.Provider>
  );
}

describe("SettingsDialog input routing", () => {
  beforeAll(async () => {
    await initI18n();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetTerminalInputRoutingForTests();
    useSettingsDialogStore.setState({ isOpen: false });
  });

  it("keeps the default settings backdrop without hiding native terminal surfaces", () => {
    const applyHostSnapshot = vi.fn();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 720,
      height: 696,
      left: 0,
      right: 1280,
      toJSON: () => ({}),
      top: 24,
      width: 1280,
      x: 0,
      y: 24,
    });
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        disconnect = vi.fn();
        observe = vi.fn();
        unobserve = vi.fn();
      }
    );
    vi.stubGlobal("matchMedia", () => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        onWindowLayoutPulse: vi.fn(() => vi.fn()),
        terminal: { applyHostSnapshot },
      },
    });
    useSettingsDialogStore.setState({ isOpen: true });

    renderWithTerminalOverlay(<SettingsDialog />);

    const overlay = document.querySelector('[data-slot="dialog-overlay"]');

    expect(overlay).toBeInstanceOf(HTMLElement);
    expect(overlay?.className).toContain("bg-overlay-scrim");
    expect(overlay?.className).toContain("top-[var(--app-titlebar-height)]");
    expect(overlay?.className).not.toContain("inset-0");
    expect(overlay?.className).not.toContain("bg-black/30");
    expect(overlay?.className).not.toMatch(BACKDROP_FILTER_CLASS);
    expect(getLastTerminalHostSnapshot()).toEqual(
      expect.objectContaining({
        basePanel: { kind: "web" },
        webOverlayRects: expect.arrayContaining([
          expect.objectContaining({
            id: expect.stringMatching(/^terminal-overlay:/),
          }),
        ]),
        webRequestCount: 1,
      })
    );
    expect(applyHostSnapshot).toHaveBeenCalled();
  });

  it("does not autofocus the first settings navigation item on open", () => {
    vi.stubGlobal("matchMedia", () => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: { terminal: { applyHostSnapshot: vi.fn() } },
    });
    useSettingsDialogStore.setState({ isOpen: true });

    render(<SettingsDialog />);

    const content = document.querySelector('[data-slot="dialog-content"]');
    const appearanceNav = screen.getByRole("button", { name: "Appearance" });

    expect(content).toBeInstanceOf(HTMLElement);
    expect(content).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).toBe(content);
    expect(document.activeElement).not.toBe(appearanceNav);
    expect(appearanceNav).toHaveAttribute("aria-current", "page");
  });

  it("opens when main requests the settings dialog", async () => {
    let openRequest: (() => void) | undefined;
    vi.stubGlobal("matchMedia", () => ({
      addEventListener: vi.fn(),
      matches: false,
      removeEventListener: vi.fn(),
    }));
    Object.defineProperty(window, "pier", {
      configurable: true,
      value: {
        settings: {
          onOpenRequest: vi.fn((cb: () => void) => {
            openRequest = cb;
            return vi.fn();
          }),
        },
        terminal: { applyHostSnapshot: vi.fn() },
      },
    });

    render(<SettingsDialog />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => {
      openRequest?.();
    });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
